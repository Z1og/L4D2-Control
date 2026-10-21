const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { pipeline } = require('stream/promises');
const { Transform } = require('stream');
const yauzl = require('yauzl');
const gameMaps = require('./content sources');

const terminal = new Set(['completed', 'failed', 'cancelled']);
const maxBytes = 2 * 1024 ** 3;
async function hash(file, signal) {
  const digest = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(file), digest, { signal });
  return digest.digest('hex');
}
function quote(value) { return `'${String(value).replace(/'/g, `'\\''`)}'`; }
function folderBytes(folder) {
  let bytes = 0;
  if (!fs.existsSync(folder)) return 0;
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) bytes += folderBytes(file);
    else if (entry.isFile()) bytes += fs.statSync(file).size;
  }
  return bytes;
}
function vpkFiles(folder) {
  const files = [];
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.isSymbolicLink()) throw new Error('下载内容包含符号链接');
    if (entry.isDirectory()) files.push(...vpkFiles(file));
    else if (entry.isFile() && /\.vpk$/i.test(entry.name)) files.push(file);
  }
  return files;
}
function validateVpk(file) {
  const size = fs.statSync(file).size;
  if (size < 12 || size > maxBytes) throw new Error('VPK 文件大小无效');
  const fd = fs.openSync(file, 'r'), header = Buffer.alloc(28);
  try { fs.readSync(fd, header, 0, 28, 0); } finally { fs.closeSync(fd); }
  const version = header.readUInt32LE(4), treeSize = header.readUInt32LE(8);
  const headerSize = version === 1 ? 12 : 28;
  if (header.readUInt32LE(0) !== 0x55aa1234 || ![1, 2].includes(version) || treeSize === 0 || treeSize > 32 * 1024 ** 2 || treeSize + headerSize > size) throw new Error('VPK 文件头或目录无效（暂不支持分卷包）');
  const tree = Buffer.alloc(treeSize), treeFd = fs.openSync(file, 'r');
  try { fs.readSync(treeFd, tree, 0, treeSize, headerSize); } finally { fs.closeSync(treeFd); }
  let position = 0, entries = 0;
  const string = () => { const end = tree.indexOf(0, position); if (end < 0) throw new Error('VPK 目录损坏'); const result = tree.subarray(position, end).toString('utf8'); position = end + 1; return result; };
  for (let extension = string(); extension; extension = string()) {
    for (let directory = string(); directory; directory = string()) {
      for (let name = string(); name; name = string()) {
        if (position + 18 > tree.length) throw new Error('VPK 目录不完整');
        const preload = tree.readUInt16LE(position + 4), archive = tree.readUInt16LE(position + 6), offset = tree.readUInt32LE(position + 8), length = tree.readUInt32LE(position + 12);
        if (tree.readUInt16LE(position + 16) !== 0xffff || archive !== 0x7fff && length > 0) throw new Error('暂不支持分卷 VPK，请选择完整地图包');
        const dataEnd = version === 2 ? headerSize + treeSize + header.readUInt32LE(12) : size;
        if (length && headerSize + treeSize + offset + length > dataEnd || dataEnd > size || position + 18 + preload > tree.length) throw new Error('VPK 数据超出文件边界');
        if (/\.(exe|dll|so|sh|bat|cmd)$/i.test(`${name}.${extension}`) || /(^|[\\/])\.\.([\\/]|$)/.test(directory)) throw new Error('VPK 包含不支持的文件');
        position += 18 + preload; entries++;
      }
    }
  }
  if (!entries) throw new Error('VPK 中没有可安装内容');
  return size;
}
async function unpackZip(file, folder, signal) {
  const zip = await new Promise((resolve, reject) => yauzl.open(file, { lazyEntries: true, autoClose: true, validateEntrySizes: true }, (error, result) => error ? reject(error) : resolve(result)));
  return new Promise((resolve, reject) => {
    let count = 0, total = 0, settled = false;
    const fail = error => { if (settled) return; settled = true; zip.close(); signal.removeEventListener('abort', abort); reject(error); };
    const abort = () => fail(new Error('下载已取消'));
    signal.addEventListener('abort', abort, { once: true });
    zip.on('error', fail);
    zip.on('end', () => { if (!settled) { settled = true; signal.removeEventListener('abort', abort); resolve(); } });
    zip.on('entry', entry => {
      (async () => {
        signal.throwIfAborted();
        const parts = entry.fileName.replace(/\\/g, '/').split('/');
        const type = (entry.externalFileAttributes >>> 16) & 0xf000;
        if (++count > 4096 || parts.some(part => part === '..') || /^[\\/]|^[A-Za-z]:/.test(entry.fileName) || type === 0xa000 || entry.generalPurposeBitFlag & 1) throw new Error('压缩包包含不支持的路径、链接或加密文件');
        total += entry.uncompressedSize;
        if (total > maxBytes * 2 || entry.uncompressedSize > maxBytes) throw new Error('压缩包解压大小超出限制');
        if (!/\.vpk$/i.test(entry.fileName)) { zip.readEntry(); return; }
        const destination = path.join(folder, String(count) + ' ' + path.basename(entry.fileName));
        const stream = await new Promise((res, rej) => zip.openReadStream(entry, (error, result) => error ? rej(error) : res(result)));
        await pipeline(stream, fs.createWriteStream(destination, { flags: 'wx', mode: 0o600 }), { signal });
        zip.readEntry();
      })().catch(fail);
    });
    if (signal.aborted) abort(); else zip.readEntry();
  });
}
function createManager({ addonDir, steamcmdPath, workshopProxy, localMode, stateDir = process.env.DOWNLOAD_STATE_DIR || path.join(os.homedir(), '.local', 'state', 'dead-air-panel', 'downloads'), gameMapsSource = gameMaps, steamSource, pluginStoreSource, pluginInstaller, steamTransferLimit = maxBytes, platform = process.platform }) {
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const store = path.join(stateDir, 'jobs.json');
  let jobs = [], active = null;
  try { jobs = JSON.parse(fs.readFileSync(store, 'utf8')); if (!Array.isArray(jobs)) jobs = []; } catch (error) { if (error.code !== 'ENOENT') throw new Error('下载任务记录无法读取'); }
  const save = () => { const temp = `${store}.part`; fs.writeFileSync(temp, JSON.stringify(jobs), { mode: 0o600 }); fs.renameSync(temp, store); };
  const normalizeTitle = value => String(value || '').slice(0, 160).replace(/\s+/g, ' ').trim();
  const mismatchMessage = '项目名称与 Steam 官方编号不一致，请重新搜索后安装，不要重试旧任务';
  const mismatched = job => job.source === 'steam-workshop' && (job.errorCode === 'STEAM_IDENTITY_MISMATCH' || /项目名称与 Steam 官方编号不一致/.test(job.error || ''));
  function markMismatch(job) {
    for (const previous of jobs) if (previous.source === job.source && previous.itemId === job.itemId && normalizeTitle(previous.title) === normalizeTitle(job.title) && previous.status === 'failed') {
      previous.errorCode = 'STEAM_IDENTITY_MISMATCH'; previous.retryable = false; previous.error = mismatchMessage;
    }
  }
  for (const job of jobs) if (!terminal.has(job.status)) { job.status = 'failed'; job.error = '面板服务重启中断了任务，请重试；若中断于安装阶段，请先检查已安装文件'; job.updatedAt = new Date().toISOString(); }
  for (const job of jobs.filter(mismatched)) markMismatch(job);
  save();
  function update(job, fields) { Object.assign(job, fields, { updatedAt: new Date().toISOString() }); save(); }
  function list() { return jobs.filter(job => !job.dismissedAt).map(job => ({ ...job })); }
  async function workshop(job, stage, signal) {
    if (steamSource) {
      update(job, { status: 'connecting', phase: '读取 Steam 官方文件' });
      const item = await steamSource.details(job.itemId, signal, job.title);
      if (job.title !== `steam-workshop ${job.itemId}` && normalizeTitle(job.title) !== normalizeTitle(item.title)) throw Object.assign(new Error(mismatchMessage), { code: 'STEAM_IDENTITY_MISMATCH' });
      update(job, { title: item.title.slice(0, 160) || job.title });
      if (item.fileUrl) {
        if (item.bytes > steamTransferLimit) throw new Error('Steam 下载文件超过 2 GiB 限制');
        const response = await steamSource.download(item.fileUrl, signal);
        const length = Number(response.headers['content-length']);
        if (Number.isFinite(length) && length > steamTransferLimit) { response.destroy(); throw new Error('Steam 下载文件超过 2 GiB 限制'); }
        const total = item.bytes || (length > 0 ? length : null);
        update(job, { status: 'downloading', phase: 'Steam 官方文件下载', totalBytes: total });
        let received = 0, last = 0;
        const meter = new Transform({ transform(chunk, encoding, callback) {
          received += chunk.length;
          if (received > steamTransferLimit) return callback(new Error('Steam 下载文件超过 2 GiB 限制'));
          if (Date.now() - last > 500) { last = Date.now(); update(job, { receivedBytes: received }); }
          callback(null, chunk);
        } });
        const file = path.join(stage, `content-${job.itemId}.vpk`);
        await pipeline(response, meter, fs.createWriteStream(file, { flags: 'wx', mode: 0o600 }), { signal });
        if (total && received !== total || length > 0 && received !== length) throw new Error('Steam 下载文件不完整');
        update(job, { receivedBytes: received });
        return [file];
      }
    }
    update(job, { status: 'downloading', phase: 'SteamCMD 下载', totalBytes: null });
    let prefix = '';
    if (workshopProxy) {
      const port = workshopProxy.match(/^socks5h:\/\/127\.0\.0\.1:(\d+)$/)?.[1];
      if (!port) throw new Error('创意工坊代理配置无效');
      const config = path.join(stage, 'proxy.conf');
      fs.writeFileSync(config, `strict_chain\nproxy_dns\ntcp_read_time_out 15000\ntcp_connect_time_out 8000\n[ProxyList]\nsocks5 127.0.0.1 ${port}\n`, { mode: 0o600 });
      prefix = `proxychains_bin="$(command -v proxychains4 || command -v proxychains)"; "$proxychains_bin" -q -f ${quote(config)} `;
    }
    const script = `${prefix}${quote(steamcmdPath)} +force_install_dir ${quote(stage)} +login anonymous +workshop_download_item 550 ${quote(job.itemId)} +quit`;
    let log = '', transferError = null, stopTransfer = null;
    const content = path.join(stage, 'steamapps', 'workshop', 'content', '550', job.itemId);
    const measure = () => folderBytes(content) + folderBytes(path.join(stage, 'steamapps', 'workshop', 'downloads', '550', job.itemId));
    const timer = setInterval(() => {
      try {
        const receivedBytes = measure();
        update(job, { receivedBytes });
        if (receivedBytes > steamTransferLimit) { transferError = new Error('Steam 下载文件超过 2 GiB 限制'); stopTransfer?.(); }
      } catch { /* Wait for the next sample while Steam renames files. */ }
    }, 1000);
    try {
      await new Promise((resolve, reject) => {
        const child = spawn('/bin/bash', ['-lc', script], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
        const stop = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already exited. */ } };
        stopTransfer = stop;
        const collect = data => { log = (log + data.toString()).slice(-8192); };
        child.stdout.on('data', collect); child.stderr.on('data', collect);
        signal.addEventListener('abort', stop, { once: true });
        child.on('error', error => { signal.removeEventListener('abort', stop); reject(error); });
        child.on('close', code => { signal.removeEventListener('abort', stop); transferError ? reject(transferError) : signal.aborted ? reject(new Error('任务已取消或超时')) : code === 0 ? resolve() : reject(new Error(`SteamCMD 下载失败（退出 ${code}）：${log.slice(-1200).trim()}`)); });
        if (signal.aborted) stop();
      });
    } finally { clearInterval(timer); }
    if (!fs.existsSync(content)) throw new Error('Steam 未返回可安装内容，项目可能不支持匿名下载');
    if (measure() > steamTransferLimit) throw new Error('Steam 下载文件超过 2 GiB 限制');
    update(job, { receivedBytes: folderBytes(content) });
    return vpkFiles(content);
  }
  async function gamemaps(job, stage, signal) {
    update(job, { phase: '连接 GameMaps', status: 'connecting' });
    const response = await gameMapsSource.download(job.itemId, signal, progress => {
      if (!signal.aborted) update(job, { status: 'downloading', phase: 'GameMaps 官方文件下载', ...progress });
    });
    const length = Number(response.headers['content-length']);
    if (Number.isFinite(length) && length > maxBytes) { response.destroy(); throw new Error('下载文件超过 2 GiB 限制'); }
    update(job, { status: response.browserDownloaded ? 'validating' : 'downloading', phase: response.browserDownloaded ? '校验下载包' : '下载文件', totalBytes: length > 0 ? length : null });
    const file = path.join(stage, 'package.bin'); let received = 0, last = 0;
    const meter = new Transform({ transform(chunk, encoding, callback) {
      received += chunk.length;
      if (received > maxBytes) return callback(new Error('下载文件超过 2 GiB 限制'));
      if (!response.browserDownloaded && Date.now() - last > 500) { last = Date.now(); update(job, { receivedBytes: received }); }
      callback(null, chunk);
    } });
    await pipeline(response, meter, fs.createWriteStream(file, { flags: 'wx', mode: 0o600 }), { signal });
    if (length > 0 && received !== length) throw new Error('下载文件不完整');
    update(job, { receivedBytes: received, phase: '校验下载包', status: 'validating' });
    const magic = Buffer.alloc(4), fd = fs.openSync(file, 'r');
    try { fs.readSync(fd, magic, 0, 4, 0); } finally { fs.closeSync(fd); }
    if (magic.readUInt32LE(0) === 0x55aa1234) { const vpk = path.join(stage, `content-${job.itemId}.vpk`); fs.renameSync(file, vpk); return [vpk]; }
    if (magic.readUInt16LE(0) !== 0x4b50) throw new Error('GameMaps 返回的不是 ZIP 或 VPK 文件');
    const folder = path.join(stage, 'unpacked'); fs.mkdirSync(folder);
    await unpackZip(file, folder, signal); return vpkFiles(folder);
  }
  async function installPluginStore(job, stage, signal) {
    if (!pluginStoreSource || typeof pluginStoreSource.fileFor !== 'function' || typeof pluginInstaller !== 'function') throw new Error('插件商店下载暂不可用');
    update(job, { status: 'connecting', phase: '读取服务器插件缓存' });
    const { item, file } = await pluginStoreSource.fileFor(job.itemId, signal);
    signal.throwIfAborted();
    const info = fs.lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== item.size) throw new Error('插件缓存文件状态异常');
    let name = path.basename(item.fileName)
      .replace(/\.smx$/i, '')
      .replace(/[^A-Za-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 118);
    if (!name) name = `plugin-${item.id.slice(0, 12)}`;
    name += '.smx';
    update(job, { title: item.group, status: 'installing', phase: '导入插件（默认停用）', receivedBytes: info.size, totalBytes: info.size });
    const result = await pluginInstaller(name, fs.createReadStream(file));
    update(job, { title: item.group, status: 'completed', phase: '已导入（默认停用）', receivedBytes: info.size, totalBytes: info.size,
      installedFiles: result.files || [name], alreadyInstalled: false, requiresRestart: false, error: null });
  }
  async function execute(job, signal) {
    const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'dead-air-download-')); fs.chmodSync(stage, 0o700);
    const created = [], temporary = [];
    try {
      if (job.source === 'plugin-store') { await installPluginStore(job, stage, signal); return; }
      const files = await (job.source === 'gamemaps' ? gamemaps(job, stage, signal) : workshop(job, stage, signal));
      signal.throwIfAborted(); update(job, { status: 'validating', phase: '校验 VPK' });
      if (!files.length || files.length > 128) throw new Error('下载包中没有 VPK 或文件数量超过限制');
      let total = 0;
      const plan = [];
      for (const file of files) {
        total += validateVpk(file);
        if (total > maxBytes * 2) throw new Error('VPK 总大小超过限制');
        const name = path.basename(file).replace(/^\d+ /, '').replace(/[^A-Za-z0-9 .-]/g, '-').slice(0, 140);
        plan.push({ file, name: `${job.source === 'gamemaps' ? 'gamemaps' : 'workshop'}-${job.itemId}-${name}`, digest: await hash(file, signal) });
      }
      if (new Set(plan.map(item => item.name.toLowerCase())).size !== plan.length) throw new Error('下载包中文件名重复');
      fs.mkdirSync(addonDir, { recursive: true });
      for (const item of plan) {
        item.destination = path.join(addonDir, item.name);
        if (fs.existsSync(item.destination)) {
          if (!fs.lstatSync(item.destination).isFile() || await hash(item.destination, signal) !== item.digest) throw new Error(`已存在不同内容的文件：${item.name}`);
          item.existing = true;
        }
      }
      signal.throwIfAborted(); update(job, { status: 'installing', phase: '安装到服务器' });
      for (const item of plan.filter(item => !item.existing)) {
        signal.throwIfAborted();
        const temp = path.join(addonDir, `.${job.id}-${temporary.length}.part`); temporary.push(temp);
        fs.copyFileSync(item.file, temp, fs.constants.COPYFILE_EXCL); fs.chmodSync(temp, 0o644);
        fs.linkSync(temp, item.destination); created.push(item.destination); fs.unlinkSync(temp);
      }
      update(job, { status: 'completed', phase: '安装完成', installedFiles: plan.map(item => item.name), alreadyInstalled: created.length === 0, requiresRestart: true, error: null });
    } catch (error) {
      for (const file of created) fs.rmSync(file, { force: true });
      throw error;
    } finally {
      for (const file of temporary) fs.rmSync(file, { force: true });
      fs.rmSync(stage, { recursive: true, force: true });
    }
  }
  function pump() {
    if (active) return;
    const job = jobs.find(item => item.status === 'queued'); if (!job) return;
    const controller = new AbortController(); active = { job, controller };
    const timeout = setTimeout(() => controller.abort(new Error('下载超过 20 分钟，请重试')), 20 * 60 * 1000);
    active.promise = execute(job, controller.signal).catch(error => {
      const cancelled = job.status === 'cancelled';
      update(job, { status: cancelled ? 'cancelled' : 'failed', phase: cancelled ? '已取消' : '下载失败', error: controller.signal.reason?.message || error.message, errorCode: cancelled ? null : error.code || null, retryable: cancelled || error.code !== 'STEAM_IDENTITY_MISMATCH' });
      if (!cancelled && mismatched(job)) { markMismatch(job); save(); }
    }).finally(() => { clearTimeout(timeout); active = null; pump(); });
  }
  function start(source, itemId, title = '') {
    if (!localMode || platform === 'win32') throw new Error('下载任务需要在 Linux 游戏服务器上运行面板');
    if (!['steam-workshop', 'gamemaps', 'plugin-store'].includes(source) || typeof itemId !== 'string' || (source === 'plugin-store' ? !/^[a-f0-9]{40}$/.test(itemId) : !/^\d{1,20}$/.test(itemId))) throw new Error('invalid download source or id');
    if (source === 'plugin-store' && (!pluginStoreSource || !pluginStoreSource.get(itemId))) throw new Error('插件商店项目不存在，请刷新目录后重试');
    if (jobs.some(job => mismatched(job) && job.source === source && job.itemId === itemId && normalizeTitle(job.title) === normalizeTitle(title))) throw Object.assign(new Error(mismatchMessage), { code: 'STEAM_IDENTITY_MISMATCH' });
    const existing = jobs.find(item => item.source === source && item.itemId === itemId && !terminal.has(item.status)); if (existing) return { ...existing };
    if (jobs.filter(item => !terminal.has(item.status)).length >= 10) throw new Error('下载队列已满，请等待现有任务完成');
    const now = new Date().toISOString();
    const job = { id: crypto.randomUUID(), source, itemId, title: String(title).slice(0, 160) || `${source} ${itemId}`, status: 'queued', phase: '等待下载', receivedBytes: 0, totalBytes: null, createdAt: now, updatedAt: now, error: null };
    jobs = [...jobs.filter(item => !terminal.has(item.status)), ...jobs.filter(item => terminal.has(item.status)).slice(-39), job]; save();
    setImmediate(pump); return { ...job };
  }
  function cancel(id) {
    const job = jobs.find(item => item.id === id); if (!job) throw new Error('invalid download job');
    if (!terminal.has(job.status)) { update(job, { status: 'cancelled', phase: '已取消' }); if (active?.job === job) active.controller.abort(new Error('用户取消了下载')); }
    return { ...job };
  }
  function dismiss(id) {
    const job = jobs.find(item => item.id === id);
    if (!job) throw new Error('invalid download job');
    if (!terminal.has(job.status) || active?.job === job) throw new Error('invalid download job: 请等待任务结束后移除记录');
    update(job, { dismissedAt: new Date().toISOString() });
    return { ok: true };
  }
  async function remove(id) {
    const job = jobs.find(item => item.id === id);
    if (!job) throw new Error('invalid download job');
    const operation = active?.job === job ? active.promise : null;
    cancel(id);
    if (operation) await operation;
    jobs = jobs.filter(item => item !== job); save();
    return { ok: true, installedFilesKept: true };
  }
  return { list, start, cancel, dismiss, remove };
}
module.exports = { createManager, validateVpk, unpackZip };
