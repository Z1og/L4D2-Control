const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPluginStore, gitBlobSha, rawUrl } = require('../plugin store');

function smx() {
  const image = Buffer.alloc(44);
  image.writeUInt32LE(0x53504646); image.writeUInt16LE(0x107, 4);
  image.writeUInt32LE(image.length, 7); image.writeUInt32LE(image.length, 11); image[15] = 1;
  image.writeUInt32LE(36, 16); image.writeUInt32LE(40, 20); image.writeUInt32LE(40, 28); image.writeUInt32LE(4, 32);
  Buffer.from('abc\0').copy(image, 36);
  return image;
}

test('plugin store syncs only compiled enabled SMX files, caches verified bytes and serves filtered pages', async t => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin store test '));
  t.after(() => fs.rmSync(cacheDir, { recursive: true, force: true }));
  const bytes = smx(), repo = 'example/l4d2-store', branch = 'main';
  const filePath = 'plugins/自选-修复/left4dead2/addons/sourcemod/plugins/fix_me.smx';
  const requiredPath = 'plugins/必选-工具/left4dead2/addons/sourcemod/plugins/required.smx';
  const blobSha = gitBlobSha(bytes);
  let treeReads = 0, binaryReads = 0;
  const tree = [
    { type: 'blob', path: filePath, size: bytes.length, sha: blobSha },
    { type: 'blob', path: 'plugins/自选-修复/left4dead2/addons/sourcemod/plugins/disabled/off.smx', size: bytes.length, sha: blobSha },
    { type: 'blob', path: 'plugins/自选-修复/left4dead2/addons/sourcemod/scripting/fix_me.sp', size: bytes.length, sha: blobSha },
    { type: 'blob', path: requiredPath, size: bytes.length, sha: blobSha }
  ];
  const fetchImpl = async (url, options) => {
    assert.equal(options.redirect, 'error');
    if (String(url).startsWith('https://api.github.com/')) { treeReads++; return new Response(JSON.stringify({ sha: 'tree-1', truncated: false, tree }), { status: 200 }); }
    assert.ok([filePath, requiredPath].some(file => url === rawUrl(repo, branch, file)));
    binaryReads++;
    return new Response(bytes, { status: 200, headers: { 'content-length': String(bytes.length) } });
  };
  const store = createPluginStore({ cacheDir, refreshIntervalMs: 60000, fetchImpl, repo, branch });
  t.after(() => store.stop());
  const result = await store.search('fix_me', 'optional', 1);
  assert.equal(result.total, 1);
  assert.equal(result.items[0].fileName, 'fix_me.smx');
  assert.equal(result.items[0].category, '自选插件');
  const id = crypto.createHash('sha1').update(filePath).digest('hex');
  const cached = await store.fileFor(id);
  assert.deepEqual(fs.readFileSync(cached.file), bytes);
  assert.equal(treeReads, 1);
  assert.equal(binaryReads, 1);
  await store.sync(true);
  assert.equal(treeReads, 2);
  assert.equal(binaryReads, 1);
  assert.equal(store.snapshot().syncing, false);
  assert.equal((await store.search('', 'required', 1)).items[0].fileName, 'required.smx');
  assert.equal(store.snapshot().count, 2);
});

test('plugin store refuses a corrupted cached binary before installation', async t => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin store corruption '));
  t.after(() => fs.rmSync(cacheDir, { recursive: true, force: true }));
  const bytes = smx(), filePath = 'plugins/自选-测试/left4dead2/addons/sourcemod/plugins/test.smx';
  let rawCalls = 0;
  const store = createPluginStore({ cacheDir, refreshIntervalMs: 60000, repo: 'example/store', branch: 'main', fetchImpl: async url => {
    if (String(url).startsWith('https://api.github.com/')) return new Response(JSON.stringify({ sha: 'tree', tree: [{ type: 'blob', path: filePath, size: bytes.length, sha: gitBlobSha(bytes) }] }));
    rawCalls++; return new Response(bytes);
  } });
  t.after(() => store.stop());
  const item = (await store.search('', 'all', 1)).items[0];
  const cacheFile = path.join(cacheDir, 'files', gitBlobSha(bytes));
  fs.writeFileSync(cacheFile, Buffer.from('corrupt'));
  await assert.rejects(store.fileFor(item.id), /尚未同步/);
  assert.equal(rawCalls, 1);
});
