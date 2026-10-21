const fs = require('fs');
const path = require('path');
const { Transform } = require('stream');
const { mapInventory } = require('./inventory');

const PROJECT_URL = 'https://github.com/OpenListTeam/OpenList';
const DEFAULT_MAPS_PATH = '/l4d2-maps';

function invalid(message) {
  throw Object.assign(new Error(message), { status: 400 });
}

function normalizeBaseUrl(value, label) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || value.length > 512) invalid(`${label} 无效`);
  let parsed;
  try { parsed = new URL(value); } catch { invalid(`${label} 必须是 HTTP(S) 地址`); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) invalid(`${label} 必须是无凭据的 HTTPS 地址`);
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
}

function normalizePath(value) {
  if (value === undefined || value === null || value === '') return DEFAULT_MAPS_PATH;
  if (typeof value !== 'string' || value.length > 256 || !value.startsWith('/') || /[\\\0\r\n]/.test(value)) invalid('OPENLIST_MAPS_PATH 无效');
  const parts = value.split('/').filter(Boolean);
  if (!parts.length || parts.some(part => {
    let decoded;
    try { decoded = decodeURIComponent(part); } catch { return true; }
    return decoded === '.' || decoded === '..' || /[\/\\\0-\x1f]/.test(decoded);
  })) invalid('OPENLIST_MAPS_PATH 不得为空或包含相对路径');
  return '/' + parts.join('/');
}

function parseConfig(env = process.env) {
  const url = normalizeBaseUrl(env.OPENLIST_URL, 'OPENLIST_URL');
  const token = typeof env.OPENLIST_SHARE_TOKEN === 'string' ? env.OPENLIST_SHARE_TOKEN.trim() : '';
  if (token.length > 4096 || /[\r\n]/.test(token)) invalid('OPENLIST_SHARE_TOKEN 无效');
  const upload = env.OPENLIST_UPLOAD === true || env.OPENLIST_UPLOAD === 'true' || env.OPENLIST_UPLOAD === '1';
  return { enabled: Boolean(url && token), url, token, upload, projectUrl: PROJECT_URL, mapsPath: normalizePath(env.OPENLIST_MAPS_PATH) };
}

function safePackage(name) {
  if (typeof name !== 'string' || name.length > 180 || !/^[^\\/\0\r\n]+\.vpk$/i.test(name)) invalid('地图包名称无效');
  return name;
}

function joinOpenListPath(base, name) {
  return `${base.replace(/\/+$/, '')}/${name}`;
}

function createManager({ serverRoot, addonDir, config = parseConfig(), fetchImpl = globalThis.fetch }) {
  const cachedShares = new Map();
  const uploadStatus = new Map();
  const activeUploads = new Map();

  function statusFor(name, patch = {}) {
    const current = uploadStatus.get(name) || { package: name, status: 'idle', receivedBytes: 0, totalBytes: 0, updatedAt: new Date().toISOString() };
    const next = { ...current, ...patch, package: name, updatedAt: new Date().toISOString() };
    const total = Number(next.totalBytes) || 0;
    const received = Math.max(0, Number(next.receivedBytes) || 0);
    next.receivedBytes = received;
    next.totalBytes = total;
    next.percentage = total ? Math.min(100, Math.floor(received / total * 100)) : null;
    uploadStatus.set(name, next);
    return next;
  }

  function getUploadStatus(packageName) {
    const name = safePackage(packageName);
    return statusFor(name);
  }

  async function remoteMeta(sharePath) {
    const response = await fetchImpl(`${config.url.replace(/\/+$/, '')}/api/fs/get?path=${encodeURIComponent(sharePath)}`, {
      method: 'GET',
      headers: { authorization: config.token },
      signal: AbortSignal.timeout(15000)
    });
    let result;
    try { result = await response.json(); } catch { result = null; }
    if (!response.ok || result?.code !== 200) return null;
    return result.data || null;
  }

  async function uploadMap(name, file, stat, sharePath) {
    if (!config.upload) return { uploaded: false, reused: false };
    if (typeof fetchImpl !== 'function') throw Object.assign(new Error('Node.js fetch 不可用'), { status: 503 });
    const existing = await remoteMeta(sharePath).catch(() => null);
    if (existing) {
      const remoteSize = Number(existing.size);
      if (Number.isFinite(remoteSize) && remoteSize !== stat.size) {
        statusFor(name, { status: 'conflict', receivedBytes: 0, totalBytes: stat.size, error: 'OpenList 已存在同名但大小不同的文件' });
        throw Object.assign(new Error('OpenList 已存在同名但大小不同的文件，请先在 OpenList 中删除或改名'), { status: 409 });
      }
      statusFor(name, { status: 'reused', receivedBytes: stat.size, totalBytes: stat.size, reused: true });
      return { uploaded: false, reused: true };
    }

    statusFor(name, { status: 'uploading', receivedBytes: 0, totalBytes: stat.size, error: '' });
    const source = fs.createReadStream(file);
    let receivedBytes = 0;
    const meter = new Transform({
      transform(chunk, encoding, callback) {
        receivedBytes += chunk.length;
        statusFor(name, { status: 'uploading', receivedBytes, totalBytes: stat.size });
        callback(null, chunk);
      }
    });
    source.on('error', error => meter.destroy(error));
    const body = source.pipe(meter);
    let response;
    try {
      response = await fetchImpl(`${config.url.replace(/\/+$/, '')}/api/fs/put`, {
        method: 'PUT',
        headers: {
          authorization: config.token,
          'file-path': encodeURIComponent(sharePath),
          overwrite: 'false',
          'x-file-size': String(stat.size),
          'content-length': String(stat.size),
          'content-type': 'application/octet-stream'
        },
        body,
        duplex: 'half',
        signal: AbortSignal.timeout(30 * 60 * 1000)
      });
    } catch (error) {
      statusFor(name, { status: 'failed', error: '无法连接 OpenList 或上传被中断' });
      throw Object.assign(new Error('无法连接 OpenList 或上传被中断，请检查云盘存储和网络'), { status: 502, cause: error });
    }
    let result;
    try { result = await response.json(); } catch { result = null; }
    if (!response.ok || result?.code !== 200) {
      statusFor(name, { status: 'failed', error: 'OpenList 拒绝上传' });
      if (response.status === 403) {
        const duplicate = await remoteMeta(sharePath).catch(() => null);
        if (duplicate) {
          const remoteSize = Number(duplicate.size);
          if (!Number.isFinite(remoteSize) || remoteSize === stat.size) {
            statusFor(name, { status: 'reused', receivedBytes: stat.size, totalBytes: stat.size, reused: true });
            return { uploaded: false, reused: true };
          }
        }
      }
      throw Object.assign(new Error('OpenList 未能上传地图，请检查令牌写入权限和云盘存储配置'), { status: response.status >= 400 ? 502 : 400 });
    }
    statusFor(name, { status: 'completed', receivedBytes: stat.size, totalBytes: stat.size, uploaded: true });
    return { uploaded: true, reused: false };
  }

  async function ensureUploaded(name, file, stat, sharePath) {
    if (!config.upload) return { uploaded: false, reused: false };
    if (!activeUploads.has(name)) {
      const promise = uploadMap(name, file, stat, sharePath).finally(() => activeUploads.delete(name));
      activeUploads.set(name, promise);
    }
    return activeUploads.get(name);
  }

  async function shareMap(packageName) {
    if (!config.enabled || !config.url || !config.token) invalid('请配置 OpenList 地址和分享令牌');
    const name = safePackage(packageName);
    const inventory = await mapInventory(serverRoot);
    const group = inventory.campaigns.find(item => item.type === 'custom' && item.package === name);
    if (!group) invalid('只能分享地图列表中的自定义地图包');
    const file = path.join(addonDir, name);
    let stat;
    try { stat = fs.lstatSync(file); } catch (error) { if (error.code === 'ENOENT') invalid('地图包不存在'); throw error; }
    if (!stat.isFile() || stat.isSymbolicLink()) invalid('地图包不是普通文件');
    const sharePath = joinOpenListPath(config.mapsPath, name);
    const cached = cachedShares.get(name);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.result;
    if (typeof fetchImpl !== 'function') throw Object.assign(new Error('Node.js fetch 不可用'), { status: 503 });
    const transfer = await ensureUploaded(name, file, stat, sharePath);
    let response;
    try {
      response = await fetchImpl(`${config.url.replace(/\/+$/, '')}/api/share/create`, {
        method: 'POST',
        headers: { authorization: config.token, 'content-type': 'application/json' },
        body: JSON.stringify({ files: [sharePath], pwd: '', max_accessed: 0, disabled: false, remark: `L4D2 地图：${name}` }),
        signal: AbortSignal.timeout(15000)
      });
    } catch { throw Object.assign(new Error('无法连接 OpenList，请检查地址和网络'), { status: 502 }); }
    let result;
    try { result = await response.json(); }
    catch { throw Object.assign(new Error('OpenList 返回了无法识别的响应'), { status: 502 }); }
    if (!response.ok || result?.code !== 200) throw Object.assign(new Error('OpenList 未能创建分享，请检查令牌权限和地图存储路径'), { status: response.status >= 400 ? 502 : 400 });
    const id = result.data?.id || result.data?.sharing?.id;
    if (typeof id !== 'string' || !/^[\w\p{Script=Han}-]{1,64}$/u.test(id)) throw Object.assign(new Error('OpenList 未返回有效的分享编号'), { status: 502 });
    const openUrl = `${config.url.replace(/\/+$/, '')}/@s/${encodeURIComponent(id)}`;
    const resultValue = {
      ok: true,
      openUrl,
      mapsPath: config.mapsPath,
      shareId: id,
      path: sharePath,
      package: name,
      chapters: group.chapters.length,
      size: stat.size,
      uploaded: transfer.uploaded,
      reused: transfer.reused,
      delivery: config.upload ? 'OpenList 云盘分享；实际下载是否直连取决于该存储的直链/代理设置' : 'OpenList 分享；文件必须已存在于配置的存储路径'
    };
    cachedShares.set(name, { mtimeMs: stat.mtimeMs, size: stat.size, result: resultValue });
    return resultValue;
  }

  return { config, shareMap, getUploadStatus };
}

module.exports = { PROJECT_URL, DEFAULT_MAPS_PATH, parseConfig, createManager, normalizeBaseUrl, normalizePath };
