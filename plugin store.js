const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPOSITORY = 'LaoYutang/l4d2-plugins-store';
const BRANCH = 'master';
const PAGE_SIZE = 24;
const MAX_PLUGIN_BYTES = 64 * 1024 ** 2;
const MAX_CACHE_BYTES = 512 * 1024 ** 2;
const USER_AGENT = 'L4D2-Control plugin store';

function categoryFor(title) {
  if (/^必选/.test(title)) return { id: 'required', name: '必选组件' };
  if (/^可选/.test(title)) return { id: 'optional-fix', name: '可选修复' };
  if (/^自选/.test(title)) return { id: 'optional', name: '自选插件' };
  if (/平台/.test(title)) return { id: 'platform', name: '平台组件' };
  return { id: 'other', name: '其他插件' };
}

function gitBlobSha(bytes) { return crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'); }
function rawUrl(repo, branch, file) { return `https://raw.githubusercontent.com/${repo}/${encodeURIComponent(branch)}/${file.split('/').map(encodeURIComponent).join('/')}`; }

function createPluginStore({
  cacheDir = process.env.PLUGIN_STORE_CACHE_DIR || path.join(os.homedir(), '.local', 'state', 'dead-air-panel', 'plugin store'),
  refreshIntervalMs = Number(process.env.PLUGIN_STORE_REFRESH_SECONDS || 21600) * 1000,
  fetchImpl = globalThis.fetch,
  repo = REPOSITORY,
  branch = BRANCH,
  autoSync = process.env.PLUGIN_STORE_SYNC_ENABLED !== 'false'
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('Node.js fetch 不可用');
  if (!Number.isFinite(refreshIntervalMs) || refreshIntervalMs < 60000 || refreshIntervalMs > 7 * 86400 * 1000) throw new Error('插件商店同步间隔必须在 1 分钟至 7 天之间');
  fs.mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
  const cacheDirFiles = path.join(cacheDir, 'files'); fs.mkdirSync(cacheDirFiles, { recursive: true, mode: 0o700 });
  const indexFile = path.join(cacheDir, 'index.json');
  let state = { repo, branch, items: [], lastSyncAt: null, treeSha: null, error: null };
  try {
    const saved = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
    if (saved && Array.isArray(saved.items)) state = { ...state, ...saved, repo, branch };
  } catch (error) { if (error.code !== 'ENOENT') state.error = '插件商店缓存无法读取'; }
  let syncing = null;

  function timeoutSignal(signal, timeout = 30000) { return AbortSignal.any([signal, AbortSignal.timeout(timeout)].filter(Boolean)); }
  function cachedPath(entry) { return /^[a-f0-9]{40}$/.test(entry?.sha || '') ? path.join(cacheDirFiles, entry.sha) : null; }
  function persist(next) {
    const temp = `${indexFile}.${crypto.randomBytes(5).toString('hex')}.part`; fs.writeFileSync(temp, JSON.stringify(next), { mode: 0o600 });
    try { fs.renameSync(temp, indexFile); } finally { fs.rmSync(temp, { force: true }); }
  }
  async function readCache(entry) {
    const file = cachedPath(entry); if (!file) return null;
    try { const info = fs.lstatSync(file); if (!info.isFile() || info.isSymbolicLink() || info.size !== entry.size || gitBlobSha(fs.readFileSync(file)) !== entry.sha) return null; return file; } catch { return null; }
  }
  async function fetchBinary(entry, signal) {
    const response = await fetchImpl(rawUrl(repo, branch, entry.path), { headers: { accept: '*/*', 'user-agent': USER_AGENT }, redirect: 'error', signal: timeoutSignal(signal, 120000) });
    if (!response.ok) throw new Error(`插件文件下载失败（GitHub HTTP ${response.status}）`);
    const declared = Number(response.headers?.get?.('content-length')); if (Number.isFinite(declared) && declared > MAX_PLUGIN_BYTES) throw new Error('插件文件超过 64 MiB 限制');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_PLUGIN_BYTES || bytes.length !== entry.size || gitBlobSha(bytes) !== entry.sha) throw new Error('插件文件指纹或大小与 GitHub 目录不一致，已拒绝缓存');
    const file = cachedPath(entry), temp = `${file}.${crypto.randomBytes(5).toString('hex')}.part`;
    fs.writeFileSync(temp, bytes, { flag: 'wx', mode: 0o600 }); try { fs.renameSync(temp, file); } finally { fs.rmSync(temp, { force: true }); }
  }
  function buildItems(tree) {
    const items = [], seen = new Set();
    for (const entry of Array.isArray(tree) ? tree : []) {
      if (entry?.type !== 'blob' || typeof entry.path !== 'string') continue;
      const match = entry.path.match(/^plugins\/([^/]+)\/left4dead2\/addons\/sourcemod\/plugins\/(?!disabled\/)([^/]+\.smx)$/i);
      if (!match || !Number.isSafeInteger(entry.size) || entry.size < 24 || entry.size > MAX_PLUGIN_BYTES || !/^[a-f0-9]{40}$/.test(entry.sha || '')) continue;
      const [, group, fileName] = match, id = crypto.createHash('sha1').update(entry.path).digest('hex');
      if (seen.has(id)) continue; seen.add(id); const category = categoryFor(group);
      items.push({ id, path: entry.path, sha: entry.sha, size: entry.size, group, fileName, category: category.name, categoryId: category.id, repoUrl: `https://github.com/${repo}/tree/${branch}/plugins/${encodeURIComponent(group)}` });
    }
    return items.sort((a, b) => a.category.localeCompare(b.category, 'zh') || a.group.localeCompare(b.group, 'zh') || a.fileName.localeCompare(b.fileName, 'zh'));
  }
  async function mapLimit(items, limit, action) {
    let next = 0; await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (next < items.length) { const index = next++; await action(items[index]); } }));
  }
  async function sync(force = false, signal) {
    const age = state.lastSyncAt ? Date.now() - Date.parse(state.lastSyncAt) : Infinity;
    if (!force && state.items.length && age < refreshIntervalMs) return snapshot();
    if (syncing) return syncing;
    syncing = (async () => {
      try {
        const response = await fetchImpl(`https://api.github.com/repos/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`, { headers: { accept: 'application/vnd.github+json', 'user-agent': USER_AGENT }, redirect: 'error', signal: timeoutSignal(signal, 120000) });
        if (!response.ok) throw new Error(`插件目录同步失败（GitHub HTTP ${response.status}）`);
        const data = await response.json();
        if (data.truncated || !Array.isArray(data.tree) || data.tree.length > 20000) throw new Error('GitHub 插件目录响应不完整或超出大小限制');
        const items = buildItems(data.tree), totalBytes = items.reduce((sum, item) => sum + item.size, 0);
        if (!items.length || items.length > 512 || totalBytes > MAX_CACHE_BYTES) throw new Error('插件仓库当前没有可安装内容，或目录体积超过安全上限');
        const fetched = new Set();
        await mapLimit(items, 5, async item => { if (fetched.has(item.sha)) return; fetched.add(item.sha); if (!(await readCache(item))) await fetchBinary(item, signal); });
        const next = { repo, branch, items, treeSha: data.sha || null, lastSyncAt: new Date().toISOString(), error: null }; persist(next); state = next;
        const activeHashes = new Set(items.map(item => item.sha)); for (const name of fs.readdirSync(cacheDirFiles)) if (/^[a-f0-9]{40}$/.test(name) && !activeHashes.has(name)) fs.rmSync(path.join(cacheDirFiles, name), { force: true });
        return snapshot();
      } catch (error) { state = { ...state, error: error.message || '插件仓库同步失败' }; if (!state.items.length) throw error; return snapshot(); }
      finally { syncing = null; }
    })();
    return syncing;
  }
  async function search(query = '', category = 'all', page = 1, signal) {
    if (!Number.isInteger(page) || page < 1 || page > 100) throw new Error('invalid plugin store page');
    if (!['all', 'required', 'optional-fix', 'optional', 'platform', 'other'].includes(category)) throw new Error('invalid plugin store category');
    await sync(false, signal); const needle = String(query).trim().toLocaleLowerCase();
    const matching = state.items.filter(item => (category === 'all' || item.categoryId === category) && (!needle || `${item.group} ${item.fileName} ${item.category} ${item.path}`.toLocaleLowerCase().includes(needle)));
    const start = (page - 1) * PAGE_SIZE;
    return { items: matching.slice(start, start + PAGE_SIZE).map(item => ({ id: item.id, title: item.group, fileName: item.fileName, category: item.category, categoryId: item.categoryId, size: item.size, repoUrl: item.repoUrl })), page, pageSize: PAGE_SIZE, total: matching.length, hasMore: start + PAGE_SIZE < matching.length, source: 'plugin-store', lastSyncAt: state.lastSyncAt, error: state.error, refreshIntervalSeconds: Math.round(refreshIntervalMs / 1000) };
  }
  function get(id) { return state.items.find(item => item.id === id); }
  async function fileFor(id, signal) {
    await sync(false, signal); const item = get(id); if (!item) throw new Error('插件商店项目不存在，请先刷新目录');
    const file = await readCache(item); if (!file) throw new Error('插件文件尚未同步，请点击刷新列表后重试'); return { item, file };
  }
  function snapshot() { return { repo, branch, sourceUrl: `https://github.com/${repo}/tree/${branch}/plugins`, count: state.items.length, totalBytes: state.items.reduce((sum, item) => sum + item.size, 0), lastSyncAt: state.lastSyncAt, treeSha: state.treeSha, error: state.error, syncing: Boolean(syncing), refreshIntervalSeconds: Math.round(refreshIntervalMs / 1000) }; }
  const timer = autoSync ? setInterval(() => { sync(true).catch(() => {}); }, refreshIntervalMs) : null; timer?.unref?.(); if (autoSync) sync().catch(() => {});
  return { search, sync, snapshot, get, fileFor, stop: () => { if (timer) clearInterval(timer); } };
}

module.exports = { createPluginStore, categoryFor, gitBlobSha, rawUrl };
