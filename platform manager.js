// L4D2-Control project identity: l4d2-control-bf312edc896c79baad5c | SPDX-License-Identifier: LicenseRef-L4D2-Control-NonCommercial-1.0
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { gunzipSync } = require('node:zlib');
const { pluginInventory } = require('./inventory');
const { officialCatalog } = require('./platform versions');

const COMPONENTS = [
  { id: 'metamod', name: 'MetaMod:Source', description: '底层插件加载器，SourceMod、L4DToolZ 和 Stripper 的前置组件。', caution: '更新后需重启游戏进程；请使用匹配 Source 1 / L4D2 的版本。', requires: [], probes: ['addons/metamod/bin/server.so', 'addons/metamod/bin/server_i486.so'], home: 'https://www.metamodsource.net/' },
  { id: 'sourcemod', name: 'SourceMod', description: '运行 SMX 插件，提供管理员权限、菜单与扩展接口。', caution: '保留已有配置和 SMX；插件、扩展与 gamedata 可能有版本兼容要求。', requires: ['metamod'], probes: ['addons/sourcemod/bin/sourcemod.2.l4d2.so'], home: 'https://www.sourcemod.net/' },
  { id: 'l4dtoolz', name: 'L4DToolZ', description: '解除游戏人数限制，扩展多人房间的底层能力。', caution: '人数、Bot 与大厅规则仍需在“游戏模式”中配置；避免同时安装多个同类人数扩展。', requires: ['metamod'], probes: ['addons/l4dtoolz/l4dtoolz_mm.so', 'addons/l4dtoolz/l4dtoolz_mm_i486.so'], home: 'https://github.com/accelerator74/l4dtoolz' },
  { id: 'stripper', name: 'Stripper:Source', description: '按配置增加、删除或调整地图实体，常用于地图修复。', caution: '实体规则可能改变地图流程；保留现有 maps 和 global_filters 配置，并核对所选构建要求的 MetaMod 版本。', requires: ['metamod'], probes: ['addons/stripper/bin/stripper_mm_i486.so'], home: 'https://github.com/alliedmodders/stripper-source' }
];
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const LIMIT = 96 * 1024 * 1024;
function archivePath(value) {
  const name = value.replace(/^(\.\/)+/, '').replace(/\/$/, '');
  if (!name || name.length > 240 || /[\\\x00-\x1f:]/.test(name) || name.startsWith('/') || name.split('/').some(part => !part || part === '..' || part === '.')) throw fail('压缩包包含无效路径');
  return name;
}
// Parse the bounded archive ourselves: tar extraction must never follow archive links.
function unpackArchive(compressed) {
  const raw = gunzipSync(compressed, { maxOutputLength: 256 * 1024 * 1024 });
  const files = new Map(); let count = 0, offset = 0, ended = false;
  for (; offset + 512 <= raw.length;) {
    const head = raw.subarray(offset, offset + 512);
    if (head.every(byte => byte === 0)) { ended = true; break; }
    if (++count > 12000) throw fail('压缩包条目过多');
    const text = (start, length) => head.subarray(start, start + length).toString('utf8').replace(/\0.*$/s, '');
    const octal = (start, length) => { const s = text(start, length).trim(); if (!/^[0-7]+$/.test(s)) throw fail('压缩包数字字段无效'); return parseInt(s, 8); };
    let sum = 0; for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : head[i];
    if (sum !== octal(148, 8)) throw fail('压缩包头校验失败');
    const name = archivePath((text(345, 155) ? text(345, 155) + '/' : '') + text(0, 100));
    const size = octal(124, 12), type = text(156, 1);
    if (!['', '0', '5'].includes(type)) throw fail('压缩包包含链接或不支持的条目');
    if (size > LIMIT || offset + 512 + size > raw.length || type === '5' && size) throw fail('压缩包内容不完整或过大');
    if (type !== '5') {
      if (files.has(name)) throw fail('压缩包存在重复文件');
      files.set(name, Buffer.from(raw.subarray(offset + 512, offset + 512 + size)));
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  if (!ended || !files.size) throw fail('压缩包为空或结尾不完整');
  return files;
}
function allowedFile(id, name) {
  if (id === 'metamod') return ['addons/metamod/bin/server.so', 'addons/metamod/bin/server_i486.so', 'addons/metamod/bin/metamod.2.l4d2.so', 'addons/metamod.vdf', 'addons/metamod/metaplugins.ini'].includes(name);
  if (id === 'sourcemod') return name === 'addons/metamod/sourcemod.vdf' || /^(addons\/sourcemod\/(bin|extensions|gamedata|translations|configs|plugins)\/|cfg\/sourcemod\/)/.test(name) && !/\/(x64|linux64)\//.test(name);
  if (id === 'l4dtoolz') return /^addons\/l4dtoolz\/[^/]+\.so$/.test(name) || name === 'addons/metamod/l4dtoolz.vdf';
  return ['addons/metamod/stripper.vdf', 'addons/stripper/bin/stripper_mm_i486.so', 'addons/stripper/bin/stripper.2.l4d2.so', 'addons/stripper/global_filters.cfg'].includes(name) || /^addons\/stripper\/maps\/[^/]+\.cfg$/.test(name);
}
function preserveFile(id, name) {
  return name.endsWith('.vdf') || name.endsWith('.ini') || id === 'stripper' && name.endsWith('.cfg') || /^(addons\/sourcemod\/(configs|plugins)\/|cfg\/sourcemod\/)/.test(name);
}
function elf32(data) { return data.length > 20 && data.subarray(0, 4).equals(Buffer.from([127, 69, 76, 70])) && data[4] === 1 && data[5] === 1 && data.readUInt16LE(18) === 3; }
async function unpackPackage(data, file = '') {
  if (!file.endsWith('.zip')) return unpackArchive(data);
  const yauzl = require('yauzl');
  return new Promise((resolve, reject) => yauzl.fromBuffer(data, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
    if (error) return reject(error);
    const files = new Map(); let count = 0, total = 0, settled = false;
    const stop = error => { if (settled) return; settled = true; zip.close(); reject(error); };
    zip.on('error', stop);
    zip.on('entry', entry => {
      try {
        const name = archivePath(entry.fileName), type = (entry.externalFileAttributes >>> 16) & 0o170000;
        if (++count > 12000 || (total += entry.uncompressedSize) > 256 * 1024 * 1024 || entry.uncompressedSize > LIMIT || entry.generalPurposeBitFlag & 1 || ![0, 0o100000, 0o040000].includes(type)) throw fail('ZIP 包包含链接、加密或过大条目');
        if (entry.fileName.endsWith('/')) { zip.readEntry(); return; }
        if (files.has(name)) throw fail('压缩包存在重复文件');
        zip.openReadStream(entry, (error, stream) => {
          if (error) return stop(error);
          const chunks = []; let size = 0;
          stream.on('error', stop); stream.on('data', chunk => { size += chunk.length; if (size > entry.uncompressedSize || size > LIMIT) { stream.destroy(); stop(fail('ZIP 条目大小无效')); } else chunks.push(chunk); });
          stream.on('end', () => { if (settled) return; if (size !== entry.uncompressedSize) return stop(fail('ZIP 条目不完整')); files.set(name, Buffer.concat(chunks)); zip.readEntry(); });
        });
      } catch (error) { stop(error); }
    });
    zip.on('end', () => { if (settled) return; settled = true; files.size ? resolve(files) : reject(fail('压缩包为空')); });
    zip.readEntry();
  }));
}

function parseRuntime(output) {
  const text = String(output).replace(/\x1b\[[0-9;]*m/g, '');
  const mm = text.match(/^\s*Metamod:Source\s+version\s+([0-9][^\s]*)/im);
  const sm = text.match(/^\s*SourceMod\s+Version:\s*([^\s]+)/im);
  const metaLine = pattern => text.split('\n').find(line => /^\s*\[\s*\d+\]/.test(line) && pattern.test(line));
  const result = {};
  for (const [id, match] of [['metamod', mm], ['sourcemod', sm]]) result[id] = { status: match ? 'running' : 'unknown', version: match?.[1] || null };
  for (const [id, pattern] of [['l4dtoolz', /L4DToolZ/i], ['stripper', /Stripper/i]]) {
    const line = metaLine(pattern), failed = line && /<FAILED>|<ERROR>|<NOFILE>/i.test(line);
    result[id] = { status: failed ? 'error' : line && /\([^()]+\)/.test(line) ? 'running' : 'unknown', version: !failed && line?.match(/\(([^()]+)\)/)?.[1] || null };
  }
  return result;
}
async function limitedResponse(response, limit) {
  if (!response.ok) throw fail(`官方源请求失败（HTTP ${response.status}）`, 502);
  if (Number(response.headers.get('content-length')) > limit) throw fail('官方文件超过大小限制', 502);
  const chunks = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.length; if (size > limit) { await response.body.cancel?.().catch(() => {}); throw fail('官方文件超过大小限制', 502); } chunks.push(Buffer.from(chunk)); }
  return Buffer.concat(chunks);
}
async function officialRelease(id, fetchImpl = fetch) {
  const read = async url => (await limitedResponse(await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(30000), headers: { 'user-agent': 'L4D2-Control', accept: 'application/json, text/plain' } }), 2 * 1024 * 1024)).toString('utf8');
  if (['metamod', 'sourcemod'].includes(id)) {
    const base = id === 'metamod' ? 'https://mms.alliedmods.net/mmsdrop/1.12/' : 'https://sm.alliedmods.net/smdrop/1.12/';
    const prefix = id === 'metamod' ? 'mmsource' : 'sourcemod';
    const file = (await read(base + prefix + '-latest-linux')).trim();
    const match = file.match(new RegExp('^' + prefix + '-(1\\.12\\.0-git\\d+)-linux\\.tar\\.gz$'));
    if (!match) throw fail('官方版本索引格式不匹配', 502);
    return { version: match[1], url: base + file, file };
  }
  const repo = id === 'l4dtoolz' ? 'accelerator74/l4dtoolz' : 'alliedmodders/stripper-source';
  const release = JSON.parse(await read(`https://api.github.com/repos/${repo}/releases/latest`));
  const match = id === 'l4dtoolz' ? /^l4dtoolz-l4d2-linux-[a-f0-9]+\.tar\.gz$/ : /^stripper-[\w.-]+-mms1\.12-linux\.tar\.gz$/;
  const assets = (release.assets || []).filter(asset => match.test(asset.name));
  if (assets.length !== 1 || release.draft || release.prerelease || !/^[\w.-]{1,80}$/.test(release.tag_name)) throw fail('官方稳定版本没有匹配 L4D2 Linux 的安装包', 502);
  const asset = assets[0], url = `https://github.com/${repo}/releases/download/${release.tag_name}/${asset.name}`;
  if (asset.browser_download_url.toLowerCase() !== url.toLowerCase() || asset.size > LIMIT) throw fail('官方资源地址或大小无效', 502);
  return { version: release.tag_name.replace(/^v/, ''), url: asset.browser_download_url, file: asset.name, sha256: /^sha256:[a-f0-9]{64}$/.test(asset.digest || '') ? asset.digest.slice(7) : null };
}

function createPlatforms({ serverRoot, pluginPath = path.join(serverRoot, 'left4dead2/addons/sourcemod/plugins'), capture, exclusive = action => action(), fetchImpl = fetch, releaseResolver, catalogResolver = releaseResolver ? async id => { const release = await releaseResolver(id); return { latest: release, versions: [release], warnings: [] }; } : id => officialCatalog(id, fetchImpl), system = process.platform, stateDir = path.join(os.homedir(), '.local/state/dead-air-panel/platforms'), fault = () => {} }) {
  const game = path.resolve(serverRoot, 'left4dead2');
  let busy = false, pendingStatus, last = null, releases = new Map();
  async function safeFile(base, relative, create = false) {
    const pieces = archivePath(relative).split('/'); let current = path.resolve(base);
    const baseStat = await fs.lstat(current);
    if (!baseStat.isDirectory() || baseStat.isSymbolicLink() || await fs.realpath(current) !== current) throw fail('目录包含符号链接或路径异常');
    for (let i = 0; i < pieces.length; i++) {
      current = path.join(current, pieces[i]); let stat;
      try { stat = await fs.lstat(current); } catch (error) { if (error.code !== 'ENOENT') throw error; if (i < pieces.length - 1 && create) { await fs.mkdir(current); stat = await fs.lstat(current); } }
      if (stat && (stat.isSymbolicLink() || (i < pieces.length - 1 ? !stat.isDirectory() : !stat.isFile()))) throw fail('目标包含符号链接或非常规文件');
      if (!stat && !create && i < pieces.length - 1) return current + path.sep + pieces.slice(i + 1).join(path.sep);
    }
    return current;
  }
  async function privateState() {
    await fs.mkdir(stateDir, { recursive: true, mode: 0o700 });
    if (await fs.realpath(stateDir) !== path.resolve(stateDir) || (await fs.lstat(stateDir)).isSymbolicLink()) throw fail('平台状态目录不可使用符号链接');
  }
  async function readState(id) {
    await privateState(); const file = await safeFile(stateDir, id + '.json');
    try { if ((await fs.stat(file)).size > 256 * 1024 * 1024) throw fail('平台状态文件过大'); return JSON.parse(await fs.readFile(file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
  }
  async function atomic(base, name, data, mode = 0o644) {
    const target = await safeFile(base, name, true), temp = target + '.' + crypto.randomUUID() + '.tmp';
    try { await fs.writeFile(temp, data, { flag: 'wx', mode }); await fs.rename(temp, target); } finally { await fs.rm(temp, { force: true }); }
  }
  const saveState = (id, data) => atomic(stateDir, id + '.json', JSON.stringify(data), 0o600);
  async function restore(changes) {
    for (const change of [...changes].reverse()) {
      if (change.before === null) await fs.rm(await safeFile(game, change.name), { force: true });
      else await atomic(game, change.name, Buffer.from(change.before, 'base64'), change.mode);
    }
  }
  async function recover(id, saved) {
    if (saved.pending) { await restore(saved.pending.changes); delete saved.pending; await saveState(id, saved); }
    return saved;
  }
  async function installed(component) {
    for (const probe of component.probes) { try { const file = await safeFile(game, probe); if ((await fs.stat(file)).isFile()) return true; } catch (error) { if (error.code !== 'ENOENT') throw error; } }
    return false;
  }
  function dependencies(disk) {
    return { platforms: { metamod: [], sourcemod: ['metamod'], l4dtoolz: ['metamod'], stripper: ['metamod'] }, plugins: disk.filter(plugin => /^left4dhooks(?:[ _-].*)?$/i.test(plugin.id)).map(plugin => ({ ...plugin, requires: ['sourcemod'], managedIn: 'plugins' })) };
  }
  async function snapshot() {
    if (busy) return { ...(last || { components: [], dependencies: dependencies(pluginInventory(pluginPath)) }), busy: true };
    if (pendingStatus) return pendingStatus;
    pendingStatus = (async () => {
      let runtime = parseRuntime(''), runtimeError = '';
      try { runtime = parseRuntime(await capture(['meta version', 'meta list', 'sm version'])); } catch { runtimeError = '未取得本次游戏控制台响应；磁盘安装状态不代表已运行。'; }
      const components = [];
      for (const component of COMPONENTS) {
        const saved = await recover(component.id, await readState(component.id));
        const present = await installed(component);
        let verified = !!saved.receipt;
        for (const [name, digest] of Object.entries(saved.receipt?.probes || {})) { try { if (hash(await fs.readFile(await safeFile(game, name))) !== digest) verified = false; } catch { verified = false; } }
        const normalizeVersion = value => String(value || '').replace(/-git|-dev\+/g, '.').replace(/^v/, '');
        const restartRequired = !!saved.receipt?.restartRequired && !(verified && runtime[component.id].status === 'running' && normalizeVersion(runtime[component.id].version) === normalizeVersion(saved.receipt.version));
        const catalog = releases.get(component.id)?.catalog;
        components.push({ ...component, probes: undefined, installed: present, diskVersion: present && verified ? saved.receipt.version : null, diskReleaseId: verified ? saved.receipt?.releaseId : null, runtime: runtime[component.id], latest: catalog?.latest || null, versions: catalog?.versions || [], catalogWarnings: catalog?.warnings || [], catalogCheckedAt: catalog?.checkedAt || null, canRollback: !!saved.rollback, restartRequired, checkedAt: new Date().toISOString() });
      }
      return last = { components, dependencies: dependencies(pluginInventory(pluginPath)), runtimeError, busy: false, supported: system === 'linux', checkedAt: new Date().toISOString() };
    })().finally(() => { pendingStatus = null; });
    return pendingStatus;
  }
  async function checkUpdates() {
    if (busy) throw fail('平台操作正在执行', 409);
    const errors = {};
    await Promise.all(COMPONENTS.map(async component => { try { const catalog = await catalogResolver(component.id); releases.set(component.id, { catalog, at: Date.now() }); } catch (error) { errors[component.id] = error.message; } }));
    return { ...await snapshot(), updateErrors: errors };
  }
  async function act(payload) {
    const { id, action, confirmed } = payload;
    const component = COMPONENTS.find(item => item.id === id);
    if (!component || !['install', 'update', 'rollback'].includes(action)) throw fail('平台操作无效');
    if (confirmed !== true) throw fail('请先确认平台变更');
    if (system !== 'linux') throw fail('自动安装仅支持 Linux x86 的 L4D2 服务端', 400);
    if (busy) throw fail('已有平台操作正在执行', 409);
    busy = true;
    try {
      // Wait for an in-flight read before opening a transaction.
      if (pendingStatus) await pendingStatus;
      return await exclusive(async () => {
        let saved = await recover(id, await readState(id));
        if (action === 'rollback') {
          if (!saved.rollback) throw fail('没有可回退的版本', 409);
          for (const change of saved.rollback.changes) {
            const file = await safeFile(game, change.name);
            let actual = null; try { actual = hash(await fs.readFile(file)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
            if (actual !== change.after) throw fail('文件已被其他操作更改，未回退：' + change.name, 409);
          }
          // A rollback is itself recoverable if interrupted halfway.
          const undo = [];
          for (const change of saved.rollback.changes) { const file = await safeFile(game, change.name); let before = null, mode = 0o644; try { before = (await fs.readFile(file)).toString('base64'); mode = (await fs.stat(file)).mode & 0o777; } catch (error) { if (error.code !== 'ENOENT') throw error; } undo.push({ name: change.name, before, mode }); }
          const prior = saved.rollback.prior;
          saved.pending = { changes: undo }; await saveState(id, saved);
          try { await restore(saved.rollback.changes); await saveState(id, { receipt: prior ? { ...prior, restartRequired: true } : null }); }
          catch (error) { await recover(id, saved); throw error; }
          last = null; return { ok: true, message: '已回退磁盘文件，请重启游戏进程后检查运行状态。', restartRequired: true };
        }
        const present = await installed(component);
        if ((action === 'install' && present) || (action === 'update' && !present)) throw fail('安装状态已变化，请刷新后重试', 409);
        for (const required of component.requires) if (!await installed(COMPONENTS.find(item => item.id === required))) throw fail('请先安装 ' + required, 409);
        const cached = releases.get(id);
        const catalog = cached && Date.now() - cached.at < 10 * 60000 ? cached.catalog : await catalogResolver(id);
        const release = payload.releaseId ? catalog.versions.find(item => item.id === payload.releaseId) : catalog.versions.filter(item => item.version === payload.version).length === 1 ? catalog.versions.find(item => item.version === payload.version) : null;
        if (!release || !payload.version || payload.version !== release.version) throw fail('官方版本已变化或所选版本无效，请重新获取版本并确认', 409);
        const requiredMeta = id === 'stripper' && release.file?.match(/-mms(1\.\d+)-/);
        if (requiredMeta) {
          const meta = await readState('metamod'); let diskVersion = meta.receipt?.version;
          for (const [name, digest] of Object.entries(meta.receipt?.probes || {})) { try { if (hash(await fs.readFile(await safeFile(game, name))) !== digest) diskVersion = null; } catch { diskVersion = null; } }
          let runtimeVersion = null; if (!diskVersion) { try { runtimeVersion = parseRuntime(await capture(['meta version'])).metamod.version; } catch {} }
          const known = (diskVersion || runtimeVersion || '').match(/^(1\.\d+)\./)?.[1];
          if (known && known !== requiredMeta[1]) throw fail(`所选 Stripper 构建需要 MetaMod ${requiredMeta[1]}，当前为 ${known}；请先处理依赖版本`, 409);
        }
        const url = new URL(release.url);
        if (url.protocol !== 'https:' || !['mms.alliedmods.net', 'sm.alliedmods.net', 'github.com'].includes(url.hostname)) throw fail('平台下载源无效');
        const response = await fetchImpl(release.url, { signal: AbortSignal.timeout(120000), redirect: url.hostname === 'github.com' ? 'follow' : 'error', headers: { 'user-agent': 'L4D2-Control' } });
        if (response.url && !['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com', 'mms.alliedmods.net', 'sm.alliedmods.net'].includes(new URL(response.url).hostname)) throw fail('平台下载重定向地址无效', 502);
        const archive = await limitedResponse(response, LIMIT);
        if (release.sha256 && hash(archive) !== release.sha256) throw fail('官方安装包 SHA-256 校验失败', 502);
        const files = await unpackPackage(archive, release.file);
        const selected = [...files].filter(([name]) => allowedFile(id, name));
        if (!component.probes.some(probe => files.has(probe) && elf32(files.get(probe)))) throw fail('安装包缺少适配 L4D2 x86 的 ELF 主组件');
        for (const [name, data] of selected) if (name.endsWith('.so') && !elf32(data)) throw fail('安装包包含不匹配的二进制：' + name);
        const changes = []; let preserved = 0;
        for (const [name, data] of selected) {
          const file = await safeFile(game, name, true); let before = null, mode = 0o644;
          try { const stat = await fs.stat(file); if (stat.size > LIMIT) throw fail('现有文件过大'); before = await fs.readFile(file); mode = stat.mode & 0o777; } catch (error) { if (error.code !== 'ENOENT') throw error; }
          if (before && preserveFile(id, name)) { preserved++; continue; }
          if (before && hash(before) === hash(data)) continue;
          changes.push({ name, before: before ? before.toString('base64') : null, mode, after: hash(data) });
        }
        // Remove only obsolete managed binaries and alternate entry binaries, with rollback bytes.
        const obsolete = new Set([...(saved.receipt?.managedFiles || []), ...component.probes]);
        for (const name of obsolete) {
          if (files.has(name) || !allowedFile(id, name) || !name.endsWith('.so')) continue;
          const file = await safeFile(game, name);
          try { const stat = await fs.stat(file); if (stat.size > LIMIT) throw fail('现有文件过大'); const before = await fs.readFile(file); changes.push({ name, before: before.toString('base64'), mode: stat.mode & 0o777, after: null }); }
          catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
        if (!changes.length) return { ok: true, message: '选定版本的文件已存在；保留已有配置与插件。', restartRequired: !!saved.receipt?.restartRequired };
        saved.pending = { changes }; await saveState(id, saved);
        try {
          for (const [index, change] of changes.entries()) { await fault(index, change.name); if (change.after === null) await fs.rm(await safeFile(game, change.name)); else await atomic(game, change.name, files.get(change.name), change.mode); }
          const probes = {};
          for (const probe of component.probes) if (files.has(probe)) probes[probe] = hash(files.get(probe));
          await saveState(id, { receipt: { version: release.version, releaseId: release.id || null, managedFiles: selected.map(([name]) => name), installedAt: new Date().toISOString(), archiveSha256: hash(archive), probes, restartRequired: true }, rollback: { prior: saved.receipt || null, changes } });
        } catch (error) { await recover(id, saved); throw error; }
        last = null; return { ok: true, changedFiles: changes.length, preservedFiles: preserved, restartRequired: true, message: `已写入 ${changes.length} 个文件，保留 ${preserved} 个现有配置或插件；请重启游戏进程后检查。` };
      });
    } finally { busy = false; }
  }
  return { snapshot, checkUpdates, act, dependencies };
}
module.exports = { createPlatforms, COMPONENTS, parseRuntime, unpackArchive, unpackPackage, allowedFile, officialRelease, officialCatalog };
