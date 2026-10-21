const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const https = require('node:https');
const tls = require('node:tls');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
function uploadFailure(status, data) {
  const message = String(data?.message || '');
  const reasons = [[/timeout|timed out|deadline/i, '网盘响应超时'], [/unexpected EOF|broken pipe|connection reset/i, '上游传输中断'], [/permission|forbidden|denied/i, '上传权限被拒绝'], [/unauthorized|token.*expir|login/i, '服务账号登录已失效'], [/quota|no space|not enough space/i, '网盘空间不足'], [/exist|duplicate/i, '同名文件已存在'], [/too many|rate limit/i, '网盘请求频率受限']];
  const reason = reasons.find(([pattern]) => pattern.test(message))?.[1] || '云盘未接受上传';
  const code = Number.isFinite(Number(data?.code)) ? Number(data.code) : 'unknown';
  const errno = message.match(/(?:errno|error_code)["'\s:=]+(-?\d+)/i)?.[1];
  return fail(`${reason}（HTTP ${status} / OpenList ${code}${errno ? ' / 上游 ' + errno : ''}）`, 502);
}
function safeName(name) {
  if (typeof name !== 'string' || name.length > 240 || /[\\/\x00-\x1f\x7f]/.test(name) || !/\.vpk$/i.test(name) || name === '.' || name === '..') throw fail('地图文件名无效');
  return name;
}
function cloudConfig(env = process.env) {
  const url = String(env.OPENLIST_URL || '').replace(/\/+$/, '');
  if (url) { const u = new URL(url); if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) throw fail('OpenList 必须使用无凭据的 HTTPS 地址'); }
  const mapsPath = env.OPENLIST_MAPS_PATH || '/l4d2-maps';
  const apiPath = env.OPENLIST_API_PATH || mapsPath;
  for (const p of [mapsPath, apiPath]) if (typeof p !== 'string' || !p.startsWith('/') || /[\\\x00-\x1f]/.test(p) || p.split('/').some(s => ['.', '..'].includes(s))) throw fail('OpenList 路径无效');
  const token = String(env.OPENLIST_SHARE_TOKEN || '');
  const username = String(env.OPENLIST_USER || '');
  const password = String(env.OPENLIST_PASSWORD || '');
  const connectAddress = String(env.OPENLIST_CONNECT_ADDRESS || '');
  if (connectAddress && !['127.0.0.1', '::1'].includes(connectAddress)) throw fail('OpenList 本机传输地址必须是回环地址');
  return { url, mapsPath, apiPath, token, username, password, connectAddress, enabled: Boolean(url && (token || username && password)), upload: ['true', '1'].includes(String(env.OPENLIST_UPLOAD)), projectUrl: 'https://github.com/OpenListTeam/OpenList' };
}

// Keep large VPKs streaming; Node fetch's default response-header timeout is too short for cloud uploads.
function uploadRequest(url, { token, remotePath, file, stat, signal, onProgress, connectAddress }) {
  return new Promise((resolve, reject) => {
    let settled = false, received = 0;
    const source = fs.createReadStream(file, { flags: fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0), highWaterMark: 256 * 1024 });
    const meter = new Transform({ transform(chunk, encoding, done) { received += chunk.length; onProgress(received); done(null, chunk); } });
    const origin = new URL(url);
    // Connect to a co-located OpenList over loopback while still validating its original HTTPS identity and CA chain.
    const connection = connectAddress ? { hostname: connectAddress, servername: '', checkServerIdentity: (_host, cert) => tls.checkServerIdentity(origin.hostname, cert) } : {};
    const request = https.request(url, { ...connection, method: 'PUT', signal, headers: { Host: origin.host, Authorization: token, 'File-Path': encodeURIComponent(remotePath), Overwrite: 'false', 'As-Task': 'false', 'Content-Length': stat.size, 'Content-Type': 'application/octet-stream' } }, response => {
      let body = '';
      response.on('data', chunk => { body += chunk; if (body.length > 1024 * 1024) request.destroy(fail('上传响应过大', 502)); });
      response.on('end', () => { if (settled) return; settled = true; source.destroy(); meter.destroy(); try { const data = JSON.parse(body); if (response.statusCode !== 200 || data.code !== 200) return reject(uploadFailure(response.statusCode, data)); resolve(data.data); } catch { reject(fail('云盘上传返回异常（HTTP ' + response.statusCode + '）', 502)); } });
      response.on('error', reject);
    });
    // OpenList may buffer locally before a slow multi-gigabyte cloud transfer.
    // Keep that confirmation window long; the stop action still aborts immediately.
    request.setTimeout(12 * 60 * 60 * 1000, () => request.destroy(fail('云盘上传超时', 504)));
    request.on('error', error => { if (!settled) { settled = true; source.destroy(); meter.destroy(); reject(error.name === 'AbortError' ? error : fail('云盘连接中断，文件未确认为已备份', 502)); } });
    pipeline(source, meter, request).catch(error => request.destroy(error));
  });
}

function createCloudMaps({ addonDir, config = cloudConfig(), stateDir = path.join(os.homedir(), '.local', 'state', 'dead-air-panel', 'cloud maps'), fetchImpl = globalThis.fetch, uploadImpl = uploadRequest, intervalMs = 5 * 60 * 1000, inventory = async () => ({ campaigns: [] }), startEnabled = false }) {
  const stateFile = path.join(stateDir, 'cloud maps state.json');
  let saved = { enabled: startEnabled, files: {}, lastRun: null };
  try { const data = JSON.parse(fs.readFileSync(stateFile, 'utf8')); if (typeof data.enabled === 'boolean' && data.files && typeof data.files === 'object' && !Array.isArray(data.files)) saved = { ...saved, ...data }; } catch (e) { if (e.code !== 'ENOENT') throw fail('云端备份记录无法读取，请先检查状态文件', 500); }
  let timer, operation, abort, loginPromise, jwt = '', jwtUntil = 0, nextRun = null;
  let run = { running: false, phase: 'idle', total: 0, completed: 0, uploaded: 0, skipped: 0, failed: 0, current: null, results: [], error: '', startedAt: null, finishedAt: null };
  function persist() { fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 }); const temp = stateFile + '.' + crypto.randomUUID() + '.tmp'; fs.writeFileSync(temp, JSON.stringify(saved), { mode: 0o600 }); fs.renameSync(temp, stateFile); }
  function publicConfig() { return { enabled: config.enabled, url: config.url, mapsPath: config.mapsPath, upload: config.upload === true, projectUrl: config.projectUrl }; }
  function requireConfig() { if (!config.enabled) throw fail('云端地图尚未配置 OpenList 连接', 503); }
  function cloudPath(name = '') { return (config.apiPath || config.mapsPath).replace(/\/+$/, '') + '/' + name; }
  async function token() {
    if (config.token) return config.token;
    if (jwt && Date.now() < jwtUntil) return jwt;
    if (!loginPromise) loginPromise = (async () => {
      const response = await fetchImpl(config.url + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: config.username, password: config.password }), signal: AbortSignal.timeout(20000), redirect: 'error' });
      const data = await response.json();
      if (!response.ok || data.code !== 200 || typeof data.data?.token !== 'string') throw fail('OpenList 服务账号登录失败', 502);
      jwt = data.data.token; jwtUntil = Date.now() + 60 * 60 * 1000; return jwt;
    })().catch(() => { throw fail('OpenList 服务账号登录失败', 502); }).finally(() => { loginPromise = null; });
    return loginPromise;
  }
  async function api(route, payload, { missing = false, signal } = {}) {
    requireConfig();
    for (let attempt = 0; attempt < 2; attempt++) {
      let response, result;
      try { response = await fetchImpl(config.url + route, { method: 'POST', headers: { authorization: await token(), 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(45000)]) : AbortSignal.timeout(45000), redirect: 'error' }); result = await response.json(); }
      catch (e) { if (e.name === 'AbortError') throw e; throw fail('无法读取云端地图，请检查 OpenList 连接和网盘状态', 502); }
      if ((response.status === 401 || result.code === 401) && !config.token && attempt === 0) { jwt = ''; continue; }
      if (response.ok && result.code === 200) return result.data;
      if (missing && (result.code === 404 || /object not found|file does not exist/i.test(result.message || ''))) return null;
      throw fail('OpenList 请求失败，请检查服务账号权限和地图存储状态', 502);
    }
  }
  async function remoteFiles(refresh = false, signal) {
    const files = []; let page = 1, total = Infinity;
    while (files.length < total && page <= 100) {
      const data = await api('/api/fs/list', { path: cloudPath(), page, per_page: 500, refresh: refresh && page === 1 }, { signal });
      const batch = data?.content || []; if (!Array.isArray(batch)) throw fail('云盘文件列表格式异常', 502);
      files.push(...batch); total = Number.isFinite(Number(data?.total)) ? Number(data.total) : files.length;
      if (!batch.length) break; page++;
    }
    return files;
  }
  async function localFiles() {
    const resolved = await fs.promises.realpath(addonDir);
    if (resolved !== path.resolve(addonDir)) throw fail('服务器地图目录不可使用符号链接');
    let labels = new Map();
    try { const data = await inventory(); for (const c of data.campaigns || []) if (c.package) labels.set(c.package, c.name); } catch { /* filenames remain usable */ }
    const list = [];
    for (const relative of ['', 'workshop']) {
      const folder = path.join(addonDir, relative);
      let entries; try { const st = await fs.promises.lstat(folder); if (!st.isDirectory() || st.isSymbolicLink()) continue; entries = await fs.promises.readdir(folder, { withFileTypes: true }); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
      for (const entry of entries) {
        if (!entry.isFile() || !/\.vpk$/i.test(entry.name)) continue;
        safeName(entry.name);
        const file = path.join(folder, entry.name), stat = await fs.promises.lstat(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0) continue;
        const id = relative ? relative + '/' + entry.name : entry.name;
        list.push({ id, name: entry.name, title: labels.get(entry.name) || entry.name.replace(/\.vpk$/i, ''), size: stat.size, mtimeMs: stat.mtimeMs, file, stat, remoteName: relative ? 'workshop - ' + entry.name : entry.name });
      }
    }
    return list.sort((a, b) => a.size - b.size || a.id.localeCompare(b.id));
  }
  async function listMaps(refresh = false) {
    const [remote, local] = await Promise.all([remoteFiles(refresh), localFiles()]);
    const names = new Map(local.map(item => [saved.files[item.id]?.remoteName || item.remoteName, item]));
    const files = remote.filter(f => !f.is_dir && typeof f.name === 'string' && /\.vpk$/i.test(f.name) && !/[\\/\x00-\x1f]/.test(f.name)).map(f => {
      const match = names.get(f.name), record = match && saved.files[match.id];
      return { name: f.name, title: match?.title || f.name.replace(/\.vpk$/i, ''), size: Number(f.size) || 0, modified: typeof f.modified === 'string' ? f.modified : null, onServer: Boolean(match), verified: Boolean(record && record.size === Number(f.size) && record.mtimeMs === match.mtimeMs), serverId: match?.id || null };
    }).sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'));
    const remoteSizes = new Map(files.map(f => [f.name, f.size]));
    return { files, totalBytes: files.reduce((n, f) => n + f.size, 0), serverFiles: local.map(({ file, stat, ...item }) => ({ ...item, backedUp: Boolean(saved.files[item.id] && saved.files[item.id].size === item.size && saved.files[item.id].mtimeMs === item.mtimeMs && remoteSizes.get(saved.files[item.id].remoteName) === item.size) })), mapsPath: config.mapsPath, checkedAt: new Date().toISOString() };
  }
  function getStatus() { return { ...run, current: run.current && { ...run.current }, results: [...run.results], enabled: saved.enabled, lastRun: saved.lastRun, nextRun, intervalSeconds: intervalMs / 1000 }; }
  function schedule() { clearTimeout(timer); timer = undefined; nextRun = null; if (saved.enabled && config.enabled && config.upload && !run.running) { nextRun = new Date(Date.now() + intervalMs).toISOString(); timer = setTimeout(() => { startBackup(); }, intervalMs); timer.unref?.(); } }
  async function hashFile(file, signal) { const hash = crypto.createHash('sha256'); const stream = fs.createReadStream(file, { flags: fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0), signal }); for await (const chunk of stream) hash.update(chunk); return hash.digest('hex'); }
  async function transfer(item, remote, signal) {
    const record = saved.files[item.id];
    let remoteName = record?.remoteName || item.remoteName, existing = remote.get(remoteName);
    if (record && record.size === item.size && record.mtimeMs === item.mtimeMs && Number(existing?.size) === item.size) return { status: 'skipped', remoteName };
    run.current = { name: item.name, size: item.size, transferred: 0, percentage: 0, stage: 'checking' };
    const digest = await hashFile(item.file, signal);
    if (record?.sha256 === digest && Number(existing?.size) === item.size) { saved.files[item.id] = { ...record, mtimeMs: item.mtimeMs }; persist(); return { status: 'skipped', remoteName }; }
    if (existing) {
      // Never trust equal size as proof of equal bytes. Keep unknown or changed files as separate versions.
      remoteName = item.remoteName.replace(/\.vpk$/i, '') + ' - ' + digest.slice(0, 16) + '.vpk';
      safeName(remoteName); existing = remote.get(remoteName);
      if (existing) throw fail('云端版本名称已存在，未覆盖；请检查备份记录', 409);
    }
    signal.throwIfAborted();
    run.current.stage = 'uploading';
    await uploadImpl(config.url + '/api/fs/put', { token: await token(), remotePath: cloudPath(remoteName), file: item.file, stat: item.stat, signal, connectAddress: config.connectAddress, onProgress: bytes => { if (run.current) { run.current.transferred = Math.min(item.size, bytes); run.current.percentage = Math.min(99, Math.floor(bytes / item.size * 100)); if (bytes >= item.size) run.current.stage = 'confirming'; } } });
    const current = await fs.promises.lstat(item.file);
    if (!current.isFile() || current.isSymbolicLink() || current.size !== item.size || current.mtimeMs !== item.mtimeMs) throw fail('地图在上传期间发生变化，下次将重新检查', 409);
    const confirmed = await api('/api/fs/get', { path: cloudPath(remoteName), refresh: true }, { signal });
    if (Number(confirmed?.size) !== item.size) throw fail('云端文件大小未通过校验，未标记为已备份', 502);
    saved.files[item.id] = { remoteName, size: item.size, mtimeMs: item.mtimeMs, sha256: digest, backedUpAt: new Date().toISOString() };
    persist(); remote.set(remoteName, confirmed);
    run.current.percentage = 100; run.current.stage = 'completed';
    return { status: 'uploaded', remoteName };
  }
  async function executeBackup(signal) {
    try {
      const [items, cloud] = await Promise.all([localFiles(), remoteFiles(true, signal)]);
      const remote = new Map(cloud.map(item => [item.name, item])); run.total = items.length; run.phase = 'uploading';
      for (const item of items) {
        signal.throwIfAborted();
        try { const result = await transfer(item, remote, signal); run[result.status]++; run.results.push({ name: item.name, ...result }); }
        catch (error) { if (signal.aborted) throw error; run.failed++; run.results.push({ name: item.name, status: 'failed', error: error.message }); }
        run.completed++;
      }
      run.phase = run.failed ? 'partial' : 'completed';
    } catch (error) { run.phase = signal.aborted ? 'stopped' : 'failed'; run.error = signal.aborted ? '本轮备份已停止，未完成文件下次重新检查' : error.message; }
    finally { run.running = false; run.finishedAt = new Date().toISOString(); saved.lastRun = { finishedAt: run.finishedAt, phase: run.phase, uploaded: run.uploaded, skipped: run.skipped, failed: run.failed, total: run.total }; try { persist(); } catch { run.error = '备份状态保存失败，请检查服务器磁盘'; run.phase = 'failed'; } operation = null; abort = null; schedule(); }
  }
  function startBackup() { requireConfig(); if (!config.upload) throw fail('服务器尚未启用云端上传', 403); if (operation) return getStatus(); clearTimeout(timer); nextRun = null; abort = new AbortController(); run = { running: true, phase: 'scanning', total: 0, completed: 0, uploaded: 0, skipped: 0, failed: 0, current: null, results: [], error: '', startedAt: new Date().toISOString(), finishedAt: null }; operation = executeBackup(abort.signal); return getStatus(); }
  function setEnabled(enabled) { if (typeof enabled !== 'boolean') throw fail('自动备份开关必须为布尔值'); requireConfig(); if (enabled && !config.upload) throw fail('服务器尚未启用云端上传', 403); saved.enabled = enabled; persist(); if (enabled) startBackup(); else schedule(); return getStatus(); }
  function stopBackup() { saved.enabled = false; persist(); clearTimeout(timer); nextRun = null; abort?.abort(); return getStatus(); }
  async function shareCloud(name) { safeName(name); const files = await remoteFiles(); if (!files.some(f => f.name === name && !f.is_dir)) throw fail('云端地图不存在', 404); const sharePath = config.mapsPath.replace(/\/+$/, '') + '/' + name; const result = await api('/api/share/create', { files: [sharePath], pwd: '', max_accessed: 0, disabled: false, remark: 'L4D2 地图：' + name }); const id = result?.id || result?.sharing?.id; if (typeof id !== 'string' || !/^[\w\p{Script=Han}-]{1,64}$/u.test(id)) throw fail('云端未返回有效的分享编号', 502); return { openUrl: config.url + '/@s/' + encodeURIComponent(id), name }; }
  async function downloadInfo(name, { signal } = {}) {
    safeName(name);
    const files = await remoteFiles(false, signal);
    const listed = files.find(file => file.name === name && !file.is_dir);
    if (!listed) throw fail('云端地图不存在', 404);
    const meta = await api('/api/fs/get', { path: cloudPath(name), refresh: true }, { signal });
    const size = Number(meta?.size);
    if (meta?.is_dir || !Number.isSafeInteger(size) || size <= 0 || size !== Number(listed.size) || typeof meta?.raw_url !== 'string') throw fail('云端文件状态已变化，请刷新列表后重试', 409);
    return { name, size, url: meta.raw_url, provider: meta.provider || '' };
  }
  function close() { clearTimeout(timer); abort?.abort(); }
  async function waitForIdle() { if (operation) await operation; return getStatus(); }
  schedule();
  return { config, publicConfig, listMaps, getStatus, startBackup, setEnabled, stopBackup, shareCloud, downloadInfo, waitForIdle, close };
}
module.exports = { createCloudMaps, cloudConfig, safeName, uploadRequest, uploadFailure };
