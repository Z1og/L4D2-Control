const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseConfig, createManager } = require('../openlist manager');

function vpk(id = 'share_map') {
  const entry = Buffer.alloc(18); entry.writeUInt16LE(0x7fff, 6); entry.writeUInt16LE(0xffff, 16);
  const tree = Buffer.concat([Buffer.from(`bsp\0maps\0${id}\0`), entry, Buffer.alloc(3)]);
  const header = Buffer.alloc(12); header.writeUInt32LE(0x55aa1234); header.writeUInt32LE(1, 4); header.writeUInt32LE(tree.length, 8);
  return Buffer.concat([header, tree]);
}

test('OpenList config rejects credentials and keeps token out of public config', () => {
  assert.deepEqual(parseConfig({ OPENLIST_URL: '', OPENLIST_SHARE_TOKEN: '', OPENLIST_MAPS_PATH: '' }), { enabled: false, url: '', token: '', upload: false, projectUrl: 'https://github.com/OpenListTeam/OpenList', mapsPath: '/l4d2-maps' });
  assert.equal(parseConfig({ OPENLIST_URL: 'https://files.example', OPENLIST_SHARE_TOKEN: 'secret', OPENLIST_UPLOAD: '1' }).upload, true);
  assert.throws(() => parseConfig({ OPENLIST_URL: 'http://files.example', OPENLIST_SHARE_TOKEN: 'secret' }), /HTTPS/);
  assert.throws(() => parseConfig({ OPENLIST_URL: 'https://user:pass@files.example', OPENLIST_SHARE_TOKEN: 'secret' }), /无凭据/);
  assert.throws(() => parseConfig({ OPENLIST_URL: 'https://files.example?token=secret', OPENLIST_SHARE_TOKEN: 'secret' }), /无凭据/);
});

test('OpenList uploads a map once to cloud storage before creating its share', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openlist-upload-test-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const addonDir = path.join(root, 'left4dead2', 'addons'); fs.mkdirSync(addonDir, { recursive: true });
  const source = path.join(addonDir, 'cloud map.vpk'); const bytes = vpk('cloud_map'); fs.writeFileSync(source, bytes);
  const calls = []; let uploaded = Buffer.alloc(0);
  const manager = createManager({ serverRoot: root, addonDir, config: { enabled: true, url: 'https://files.example/openlist', token: 'upload-token', upload: true, projectUrl: 'https://github.com/OpenListTeam/OpenList', mapsPath: '/cloud-maps' }, fetchImpl: async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes('/api/fs/get?')) return new Response(JSON.stringify({ code: 404, message: 'not found' }), { status: 404 });
    if (url.endsWith('/api/fs/put')) { for await (const chunk of options.body) uploaded = Buffer.concat([uploaded, Buffer.from(chunk)]); return new Response(JSON.stringify({ code: 200, data: {} }), { status: 200 }); }
    return new Response(JSON.stringify({ code: 200, data: { id: 'cloud-map' } }), { status: 200 });
  } });
  const result = await manager.shareMap('cloud map.vpk');
  assert.equal(result.uploaded, true);
  assert.equal(result.reused, false);
  assert.equal(result.path, '/cloud-maps/cloud map.vpk');
  assert.deepEqual(uploaded, bytes);
  assert.equal(calls[1].options.headers['file-path'], encodeURIComponent('/cloud-maps/cloud map.vpk'));
  assert.equal(manager.getUploadStatus('cloud map.vpk').status, 'completed');
  assert.equal(fs.readFileSync(source).equals(bytes), true);
});

test('OpenList refuses a same-name cloud file with a different size', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openlist-conflict-test-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const addonDir = path.join(root, 'left4dead2', 'addons'); fs.mkdirSync(addonDir, { recursive: true });
  fs.writeFileSync(path.join(addonDir, 'conflict.vpk'), vpk('conflict'));
  let putCalled = false;
  const manager = createManager({ serverRoot: root, addonDir, config: { enabled: true, url: 'https://files.example/openlist', token: 'upload-token', upload: true, projectUrl: 'https://github.com/OpenListTeam/OpenList', mapsPath: '/cloud-maps' }, fetchImpl: async (url) => {
    if (url.includes('/api/fs/get?')) return new Response(JSON.stringify({ code: 200, data: { size: 1 } }), { status: 200 });
    putCalled = true; return new Response(JSON.stringify({ code: 200, data: { id: 'unexpected' } }), { status: 200 });
  } });
  await assert.rejects(() => manager.shareMap('conflict.vpk'), error => error.status === 409 && /大小不同/.test(error.message));
  assert.equal(putCalled, false);
  assert.equal(manager.getUploadStatus('conflict.vpk').status, 'conflict');
});

test('OpenList creates a share page for an installed custom map without copying it', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openlist-test-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const addonDir = path.join(root, 'left4dead2', 'addons'); fs.mkdirSync(addonDir, { recursive: true });
  const source = path.join(addonDir, 'night terror.vpk'); const bytes = vpk(); fs.writeFileSync(source, bytes);
  let request, calls = 0;
  const manager = createManager({ serverRoot: root, addonDir, config: { enabled: true, url: 'https://files.example/openlist', token: 'admin-token', projectUrl: 'https://github.com/OpenListTeam/OpenList', mapsPath: '/l4d2-maps' }, fetchImpl: async (url, options) => { calls++; request = { url, options }; return new Response(JSON.stringify({ code: 200, data: { id: 'night-terror' } }), { status: 200, headers: { 'content-type': 'application/json' } }); } });
  const result = await manager.shareMap('night terror.vpk');
  assert.equal(result.openUrl, 'https://files.example/openlist/@s/night-terror');
  assert.equal(result.path, '/l4d2-maps/night terror.vpk');
  assert.equal(fs.readFileSync(source).equals(bytes), true);
  assert.equal(request.url, 'https://files.example/openlist/api/share/create');
  assert.equal(request.options.headers.authorization, 'admin-token');
  assert.deepEqual(JSON.parse(request.options.body).files, ['/l4d2-maps/night terror.vpk']);
  await manager.shareMap('night terror.vpk');
  assert.equal(request.options.headers.authorization, 'admin-token');
  assert.equal(calls, 1);
});
