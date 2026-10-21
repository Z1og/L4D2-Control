const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const zlib = require('zlib');
const VPK = require('valve-vpk').default;
const { validateVpk, unpackZip } = require('./download manager');
const { mapInventory, pluginInventory } = require('./inventory');

const corePlugins = new Set(['admin-flatfile', 'adminmenu', 'basecommands', 'basechat', 'l4d2 control players']);
function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
function safeName(name, expression) {
  if (typeof name !== 'string' || name.length > 180 || /[\\/\x00-\x1f]/.test(name) || name === '.' || name === '..' || !expression.test(name)) fail('文件名或文件类型不支持');
  return name;
}
function directory(folder) {
  fs.mkdirSync(folder, { recursive: true });
  if (fs.realpathSync(folder) !== path.resolve(folder)) fail('内容目录包含符号链接，无法操作');
}
function existingDirectory(folder) {
  const stat = fs.lstatSync(folder);
  if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(folder) !== path.resolve(folder)) fail('内容目录包含符号链接，无法操作');
}
function regular(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) fail('目标不是普通文件');
}
function openRegular(file) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) fail('目标不是普通文件');
    return { fd, stat };
  } catch (error) {
    fs.closeSync(fd);
    throw error;
  }
}
function validateSmx(file) {
  const bytes = fs.readFileSync(file);
  if (bytes.length < 24 || bytes.readUInt32LE(0) !== 0x53504646 || ![0x101, 0x102, 0x107, 0x109, 0x10a, 0x10b, 0x10c, 0x10d].includes(bytes.readUInt16LE(4))) fail('不是有效的 SourceMod SMX 插件');
  const compression = bytes[6], diskSize = bytes.readUInt32LE(7), imageSize = bytes.readUInt32LE(11), sections = bytes[15], stringTable = bytes.readUInt32LE(16), dataOffset = bytes.readUInt32LE(20);
  if (![0, 1].includes(compression) || diskSize !== bytes.length || imageSize < bytes.length || imageSize > 64 * 1024 ** 2 || !sections || 24 + sections * 12 > dataOffset || stringTable < 24 + sections * 12 || stringTable >= dataOffset || dataOffset > bytes.length) fail('SMX 插件文件头或大小无效');
  let image = bytes;
  if (compression) {
    try { image = Buffer.concat([bytes.subarray(0, dataOffset), zlib.inflateSync(bytes.subarray(dataOffset), { maxOutputLength: imageSize - dataOffset })]); }
    catch { fail('SMX 插件压缩数据损坏'); }
  }
  if (image.length !== imageSize) fail('SMX 插件数据不完整');
  for (let i = 0; i < sections; i++) {
    const offset = 24 + i * 12, name = image.readUInt32LE(offset), start = image.readUInt32LE(offset + 4), size = image.readUInt32LE(offset + 8);
    if (stringTable + name >= dataOffset || image.indexOf(0, stringTable + name) >= dataOffset || image.indexOf(0, stringTable + name) < 0 || start < dataOffset || start + size > imageSize) fail('SMX 插件分区损坏');
  }
}
async function hasMaps(file) {
  const vpk = new VPK(file);
  try { await vpk.load(); return vpk.fileList.some(name => /^maps\/[a-z0-9_]+\.bsp$/i.test(name)); }
  finally { vpk.destroy(); if (typeof vpk.fileReader?.fileDef === 'number') fs.closeSync(vpk.fileReader.fileDef); }
}
function createLibrary({ serverRoot, addonDir, pluginPath, currentMap, unloadPlugin, stateDir = process.env.LIBRARY_STATE_DIR || path.join(os.homedir(), '.local', 'state', 'dead-air-panel', 'library') }) {
  let busy = false;
  async function exclusive(action) {
    if (busy) fail('正在处理另一项内容操作，请稍后重试', 409);
    busy = true;
    try { return await action(); } finally { busy = false; }
  }
  async function importFile(kind, name, stream) {
    return exclusive(async () => {
      safeName(name, kind === 'maps' ? /\.(vpk|zip)$/i : /^[a-z0-9_-]{1,128}\.smx$/i);
      if (kind === 'plugins') name = name.replace(/\.smx$/i, '.smx');
      const limit = kind === 'maps' ? 2 * 1024 ** 3 : 64 * 1024 ** 2;
      const length = Number(stream.headers?.['content-length']);
      if (length > limit) fail('文件超过上传大小限制', 413);
      const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'panel-library-')); fs.chmodSync(stage, 0o700);
      const created = [], temporary = [];
      try {
        const upload = path.join(stage, 'upload');
        const handle = await fs.promises.open(upload, 'wx', 0o600);
        let size = 0;
        try {
          for await (const chunk of stream) {
            size += chunk.length;
            if (size > limit) fail('文件超过上传大小限制', 413);
            await handle.writeFile(chunk);
          }
        } finally { await handle.close(); }
        if (!size || Number.isFinite(length) && length > 0 && length !== size) fail('上传文件为空或不完整');
        let plan;
        if (kind === 'plugins') {
          validateSmx(upload);
          directory(pluginPath); directory(path.join(pluginPath, 'disabled'));
          const existing = fs.readdirSync(pluginPath).concat(fs.readdirSync(path.join(pluginPath, 'disabled')));
          if (existing.some(file => file.toLowerCase() === name.toLowerCase())) fail('已存在同名插件，请先删除或更换文件名', 409);
          plan = [{ file: upload, name, destination: path.join(pluginPath, 'disabled', name) }];
        } else {
          directory(addonDir);
          let files = [{ file: upload, name }];
          if (/\.zip$/i.test(name)) {
            const unpacked = path.join(stage, 'unpacked'); fs.mkdirSync(unpacked);
            await unpackZip(upload, unpacked, new AbortController().signal);
            files = fs.readdirSync(unpacked).map(file => ({ file: path.join(unpacked, file), name: file.replace(/^\d+ /, '') }));
          }
          if (!files.length || files.length > 128) fail('压缩包中没有 VPK 或文件数量超过限制');
          const names = new Set(), existing = fs.readdirSync(addonDir).map(file => file.toLowerCase());
          for (const item of files) {
            safeName(item.name, /\.vpk$/i); validateVpk(item.file);
            if (existing.includes(item.name.toLowerCase()) || names.has(item.name.toLowerCase())) fail(`同名地图包已存在：${item.name}`, 409);
            names.add(item.name.toLowerCase());
          }
          if (!(await Promise.all(files.map(item => hasMaps(item.file)))).some(Boolean)) fail('地图包中未找到 BSP 地图，请在内容下载中安装其他模组');
          plan = files.map(item => ({ ...item, destination: path.join(addonDir, item.name) }));
        }
        for (const item of plan) {
          const temp = path.join(path.dirname(item.destination), `.${crypto.randomUUID()}.part`); temporary.push(temp);
          fs.copyFileSync(item.file, temp, fs.constants.COPYFILE_EXCL); fs.chmodSync(temp, 0o644);
          fs.linkSync(temp, item.destination); created.push(item.destination); fs.unlinkSync(temp);
        }
        return { ok: true, files: plan.map(item => item.name), enabled: false, requiresRestart: kind === 'maps' };
      } catch (error) {
        for (const file of created) fs.rmSync(file, { force: true });
        throw error;
      } finally {
        for (const file of temporary) fs.rmSync(file, { force: true });
        fs.rmSync(stage, { recursive: true, force: true });
      }
    });
  }
  function archive(file) {
    regular(file); directory(stateDir);
    const folder = fs.mkdtempSync(path.join(stateDir, 'deleted-')); fs.chmodSync(folder, 0o700);
    const backup = path.join(folder, path.basename(file));
    fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(backup, 0o600);
    fs.unlinkSync(file);
  }
  async function deleteMap(name) {
    return exclusive(async () => {
      safeName(name, /\.vpk$/i); directory(addonDir);
      const groups = (await mapInventory(serverRoot)).campaigns.filter(item => item.type === 'custom' && item.package === name);
      if (!groups.length) fail('只能删除地图列表中的自定义地图包');
      const running = await currentMap();
      if (typeof running !== 'string' || !running) fail('无法确认当前地图，请稍后重试', 409);
      if (groups.some(group => group.chapters.some(chapter => chapter.id === running))) fail('该地图正在运行，请先切换到其他地图再删除', 409);
      archive(path.join(addonDir, name)); return { ok: true, package: name };
    });
  }
  async function deletePlugin(id) {
    return exclusive(async () => {
      safeName(id, /^[a-z0-9_-]{1,128}$/i);
      if (corePlugins.has(id.toLowerCase())) fail('核心管理插件不可删除');
      directory(pluginPath); directory(path.join(pluginPath, 'disabled'));
      const item = pluginInventory(pluginPath).find(plugin => plugin.id === id);
      if (!item) fail('插件不存在', 404);
      const file = path.join(pluginPath, ...(item.enabled ? [] : ['disabled']), `${id}.smx`); regular(file);
      if (item.enabled) await unloadPlugin(id);
      archive(file); return { ok: true, id };
    });
  }
  async function exportFile(kind, identifier) {
    return exclusive(async () => {
      if (kind === 'maps') {
        safeName(identifier, /\.vpk$/i); existingDirectory(addonDir);
        const groups = (await mapInventory(serverRoot)).campaigns.filter(item => item.type === 'custom' && item.package === identifier);
        if (!groups.length) fail('只能导出地图列表中的自定义地图包');
        const file = path.join(addonDir, identifier); regular(file);
        return { ...openRegular(file), name: identifier, contentType: 'application/octet-stream' };
      }
      if (kind === 'plugins') {
        safeName(identifier, /^[a-z0-9_-]{1,128}$/i); existingDirectory(pluginPath);
        const item = pluginInventory(pluginPath).find(plugin => plugin.id === identifier);
        if (!item) fail('插件不存在', 404);
        const folder = item.enabled ? pluginPath : path.join(pluginPath, 'disabled'); existingDirectory(folder);
        const file = path.join(folder, `${identifier}.smx`); regular(file);
        return { ...openRegular(file), name: `${identifier}.smx`, contentType: 'application/octet-stream' };
      }
      fail('不支持的导出类型');
    });
  }
  return { importFile, deleteMap, deletePlugin, exportFile, exclusive };
}
module.exports = { createLibrary, validateSmx, corePlugins };
