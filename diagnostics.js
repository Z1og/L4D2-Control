const fs = require('fs');
const path = require('path');

const LIMITS = { treeBytes: 8 * 1024 * 1024, entries: 100000, paths: 250000, packages: 512, reported: 200, plugins: 256 };
const cleanConsole = text => String(text || '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\r/g, '');
const normalizeArchivePath = value => String(value).replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/{2,}/g, '/').toLowerCase();

// Read only the bounded directory tree. Never load resource data or extract a VPK.
async function vpkPaths(file) {
  const handle = await fs.promises.open(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stat = await handle.stat(), header = Buffer.alloc(28);
    const { bytesRead } = await handle.read(header, 0, 28, 0);
    const version = header.readUInt32LE(4), headerSize = version === 1 ? 12 : 28;
    const size = header.readUInt32LE(8);
    if (!stat.isFile() || bytesRead < headerSize || header.readUInt32LE(0) !== 0x55aa1234 || ![1, 2].includes(version) || !size || size + headerSize > stat.size) throw new Error('VPK 文件头或目录索引不完整');
    if (size > LIMITS.treeBytes) throw new Error('目录索引超过 8 MiB 扫描限制');
    const tree = Buffer.alloc(size);
    if ((await handle.read(tree, 0, size, headerSize)).bytesRead !== size) throw new Error('VPK 目录索引读取不完整');
    let offset = 0, count = 0;
    const entries = new Set();
    function word() {
      const end = tree.indexOf(0, offset);
      if (end < 0 || end - offset > 4096) throw new Error('VPK 路径索引损坏');
      const result = tree.toString('utf8', offset, end); offset = end + 1; return result;
    }
    for (let extension; (extension = word());) {
      for (let folder; (folder = word());) {
        for (let name; (name = word());) {
          if (offset + 18 > size || tree.readUInt16LE(offset + 16) !== 0xffff) throw new Error('VPK 文件条目损坏');
          offset += 18 + tree.readUInt16LE(offset + 4);
          if (offset > size) throw new Error('VPK 预载索引不完整');
          if (++count > LIMITS.entries) throw new Error('单包超过 10 万条路径限制');
          entries.add(normalizeArchivePath(`${folder === ' ' ? '' : folder + '/'}${name}${extension === ' ' ? '' : '.' + extension}`));
        }
      }
    }
    return entries;
  } finally { await handle.close(); }
}

async function scanVpkConflicts(addonDir) {
  const result = { available: true, scope: '扫描 addons 及其 workshop 子目录的 VPK；比较包含 BSP 地图的包。不扫描基础游戏、散装资源或其他目录；未判断包的实际挂载和覆盖顺序。', scannedPackages: 0, ignoredPackages: 0, unreadablePackages: [], conflictCount: 0, conflicts: [], truncated: false, partial: false };
  const files = [];
  async function directory(folder, prefix = '') {
    const stat = await fs.promises.lstat(folder);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('附加包目录不可读取或为符号链接');
    for (const entry of await fs.promises.readdir(folder, { withFileTypes: true })) {
      if (/\.vpk$/i.test(entry.name)) files.push({ name: prefix + entry.name, file: path.join(folder, entry.name), regular: entry.isFile() });
    }
  }
  try { await directory(addonDir); }
  catch { return { ...result, available: false, partial: true, reason: '无法读取服务器附加包目录' }; }
  try { await directory(path.join(addonDir, 'workshop'), 'workshop/'); }
  catch (error) { if (error.code !== 'ENOENT') result.unreadablePackages.push({ name: 'workshop/', reason: '目录不可读取，已跳过' }); }
  files.sort((a, b) => a.name.localeCompare(b.name, 'en'));
  const owners = new Map();
  let processedPaths = 0;
  for (const [index, item] of files.entries()) {
    if (index >= LIMITS.packages || processedPaths >= LIMITS.paths) {
      result.partial = true; result.reason = '已达到扫描资源上限，结果只覆盖已扫描的包'; break;
    }
    if (/_[0-9]{3}\.vpk$/i.test(item.name) && files.some(other => other.name.toLowerCase() === item.name.replace(/_[0-9]{3}\.vpk$/i, '_dir.vpk').toLowerCase())) {
      result.ignoredPackages++; continue;
    }
    try {
      if (!item.regular) throw new Error('不是普通文件，已跳过');
      const entries = await vpkPaths(item.file);
      if (![...entries].some(entry => /^maps\/[^/]+\.bsp$/i.test(entry))) { result.ignoredPackages++; continue; }
      if (processedPaths + entries.size > LIMITS.paths) { result.partial = true; result.reason = '已达到 25 万条路径扫描限制'; break; }
      processedPaths += entries.size;
      for (const entry of entries) {
        if (!owners.has(entry)) owners.set(entry, []);
        owners.get(entry).push(item.name);
      }
      result.scannedPackages++;
    } catch (error) { result.unreadablePackages.push({ name: item.name, reason: error.code ? '文件无法读取' : error.message }); }
    await new Promise(resolve => setImmediate(resolve));
  }
  for (const [entry, packages] of owners) {
    // Each addon has its own metadata; identical names here are expected.
    if (packages.length < 2 || ['addoninfo.txt', 'addonimage.jpg', 'addonimage.vtf'].includes(entry)) continue;
    result.conflictCount++;
    if (result.conflicts.length < LIMITS.reported) result.conflicts.push({ path: entry, packages });
  }
  result.conflicts.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  result.truncated = result.conflictCount > result.conflicts.length;
  result.partial ||= !!result.unreadablePackages.length;
  return result;
}

function parsePluginListing(output) {
  const lines = cleanConsole(output).split('\n').map(line => line.replace(/^\s*\[SM\]\s*/i, ''));
  const start = lines.findLastIndex(line => /\bListing\s+\d+\s+plugins?\s*:|^\s*No plugins loaded\s*$/i.test(line));
  if (start < 0) return { available: false, entries: [], partial: true, declaredCount: null };
  if (/No plugins loaded/i.test(lines[start])) return { available: true, entries: [], partial: false, declaredCount: 0 };
  const declaredCount = Number(lines[start].match(/Listing\s+(\d+)/i)[1]);
  const entries = [];
  for (const line of lines.slice(start + 1)) {
    const match = line.match(/^\s*(?:\[(\d{1,4})\]|(\d{1,4}))\s+(?:<([^>]+)>\s*)?(Disabled:\s*)?(?:"([^"]+)".*|([^"\r\n]+\.smx))\s*$/);
    if (!match || entries.length >= LIMITS.plugins) continue;
    const flag = match[3] || match[4] || '';
    entries.push({ index: Number(match[1] || match[2]), name: match[5] || match[6], state: /failed|error|bad load/i.test(flag) ? 'error' : /paused/i.test(flag) ? 'paused' : flag ? 'unknown' : 'loaded' });
  }
  const unique = new Set(entries.map(entry => entry.index));
  return { available: true, entries, declaredCount, partial: entries.length !== declaredCount || unique.size !== entries.length };
}

function parsePluginInfo(output) {
  const lines = cleanConsole(output).split('\n').map(line => line.replace(/^\s*\[SM\]\s*/i, ''));
  const field = label => lines.find(line => new RegExp(`^\\s*${label}\\s*:`, 'i').test(line))?.replace(/^[^:]+:\s*/, '').trim() || '';
  let filename = field('Filename').replace(/^"|"$/g, '').replace(/\\/g, '/');
  if (!/^[^\x00-\x1f]+\.smx$/i.test(filename) || filename.startsWith('/') || filename.split('/').includes('..')) filename = '';
  const status = field('Status');
  const error = field('Error') || field('Load error');
  const state = error ? 'error' : /^(running|loaded)\b/i.test(status) ? 'loaded' : /^paused\b/i.test(status) ? 'paused' : /^(error|failed|bad load|not running)\b/i.test(status) ? 'error' : 'unknown';
  return { filename, state, detail: error || (state === 'error' ? status : '') };
}

function inspectPluginRuntime(diskPlugins, listing) {
  const source = listing || { available: false, entries: [], partial: true };
  const entries = source.entries || [];
  const identityComplete = source.available && !source.partial && entries.every(entry => entry.filename);
  const plugins = diskPlugins.map(plugin => {
    // SourceMod display names are arbitrary. Only a reported filename establishes identity.
    const file = `${plugin.id}.smx`;
    const matches = entries.filter(entry => entry.filename === file || !plugin.enabled && entry.filename === `disabled/${file}`);
    const match = matches.length === 1 ? matches[0] : null;
    let runtimeStatus = 'unknown';
    if (match) {
      runtimeStatus = match.state;
      if (!plugin.enabled && ['loaded', 'paused'].includes(match.state)) runtimeStatus = 'unexpected-loaded';
    } else if (!matches.length && identityComplete) runtimeStatus = plugin.enabled ? 'not-found' : 'disabled';
    return { id: plugin.id, name: plugin.name, enabled: plugin.enabled, runtimeStatus, runtimeName: match?.name || null, detail: match?.detail || '' };
  });
  const counts = { loaded: 0, error: 0, 'not-found': 0, unknown: 0, disabled: 0, 'unexpected-loaded': 0, paused: 0 };
  for (const plugin of plugins) counts[plugin.runtimeStatus]++;
  return { available: !!source.available, declaredCount: source.declaredCount ?? null, listedCount: entries.length, partial: !identityComplete, reason: source.reason || '', counts, plugins,
    runtimeOnly: entries.filter(entry => !diskPlugins.some(plugin => entry.filename === `${plugin.id}.smx` || !plugin.enabled && entry.filename === `disabled/${plugin.id}.smx`)) };
}

function extractConsoleFrame(output, begin, end) {
  const lines = cleanConsole(output).split('\n');
  // Match echo output, never an echoed command that happens to contain the marker.
  const start = lines.findLastIndex(line => line.trim() === begin);
  const stop = lines.findIndex((line, index) => index > start && line.trim() === end);
  return start < 0 || stop < 0 ? null : lines.slice(start + 1, stop).join('\n');
}

async function collectPluginRuntime(diskPlugins, capture) {
  try {
    const listing = parsePluginListing(await capture(['sm plugins list']));
    if (!listing.available) return inspectPluginRuntime(diskPlugins, { ...listing, reason: '未取得 SourceMod 插件列表，请确认游戏及 SourceMod 正在运行' });
    if (listing.partial) return inspectPluginRuntime(diskPlugins, { ...listing, reason: '插件列表不完整或超过 256 个条目，请检查控制台缓冲区' });
    const initialIdentities = listing.entries.map(({ index, name, state }) => ({ index, name, state }));
    // Bound each console frame to reduce scrollback truncation, then recheck list stability.
    for (let offset = 0; offset < listing.entries.length; offset += 8) {
      const batch = listing.entries.slice(offset, offset + 8);
      const output = await capture(batch.map(entry => `sm plugins info ${entry.index}`));
      const text = cleanConsole(output);
      const starts = [...text.matchAll(/^[ \t]*(?:\[SM\][ \t]*)?Filename\s*:/gim)].map(match => match.index);
      const blocks = starts.map((start, index) => text.slice(start, starts[index + 1] ?? text.length));
      if (blocks.length !== batch.length) { listing.partial = true; continue; }
      for (const [index, block] of blocks.entries()) {
        const info = parsePluginInfo(block), original = batch[index];
        Object.assign(original, info, { state: original.state !== 'loaded' ? original.state : info.state });
      }
    }
    const final = parsePluginListing(await capture(['sm plugins list']));
    if (!final.available || final.partial || JSON.stringify(final.entries) !== JSON.stringify(initialIdentities)) {
      return inspectPluginRuntime(diskPlugins, { available: false, entries: [], partial: true, reason: '检查期间插件列表发生变化或不完整，请重新检查' });
    }
    return inspectPluginRuntime(diskPlugins, listing);
  } catch { return inspectPluginRuntime(diskPlugins, { available: false, entries: [], partial: true, reason: '无法取得本次控制台响应，请确认游戏 screen 会话和面板权限后重试' }); }
}

module.exports = { scanVpkConflicts, parsePluginListing, parsePluginInfo, inspectPluginRuntime, extractConsoleFrame, collectPluginRuntime, normalizeArchivePath };
