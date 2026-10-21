const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createCloudMaps, cloudConfig, safeName, uploadFailure } = require('../cloud maps');
function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud maps test '));
  const addonDir = path.join(root, 'addons'); fs.mkdirSync(addonDir);
  const remote = new Map(), calls = [], uploaded = [];
  const config = { enabled: true, url: 'https://files.example', token: 'private-token', mapsPath: '/l4d2-maps', apiPath: '/', upload: true };
  const fetchImpl = async (url, req) => {
    calls.push({ url, body: JSON.parse(req.body) });
    const body = JSON.parse(req.body);
    if (options.deny) return new Response(JSON.stringify({ code: 403, message: 'denied' }));
    if (url.endsWith('/api/fs/list')) return new Response(JSON.stringify({ code: 200, data: { content: [...remote.values()], total: remote.size } }));
    if (url.endsWith('/api/fs/get')) return new Response(JSON.stringify({ code: 200, data: remote.get(body.path.slice(1)) }));
    if (url.endsWith('/api/share/create')) return new Response(JSON.stringify({ code: 200, data: { id: 'map-share' } }));
    throw new Error('Unexpected route');
  };
  const uploadImpl = async (url, data) => { const bytes = fs.readFileSync(data.file); uploaded.push({ name: data.remotePath.slice(1), bytes }); data.onProgress(bytes.length); remote.set(data.remotePath.slice(1), { name: data.remotePath.slice(1), size: bytes.length, is_dir: false, modified: '2026-10-21T00:00:00Z', raw_url: 'SECRET' }); };
  const stateDir = path.join(root, 'state');
  const manager = createCloudMaps({ addonDir, config, stateDir, fetchImpl, uploadImpl: options.uploadImpl || uploadImpl, intervalMs: 3600000 });
  t.after(() => { manager.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, addonDir, stateDir, manager, remote, uploaded, calls, config, fetchImpl, uploadImpl };
}
test('cloud configuration hides credentials and rejects unsafe names', t => {
  const f = fixture(t);
  assert.equal(JSON.stringify(f.manager.publicConfig()).includes('private-token'), false);
  for (const name of ['../private.vpk', 'a/b.vpk', 'a\\b.vpk', 'x\n.vpk', 'secret.txt']) assert.throws(() => safeName(name));
  assert.throws(() => cloudConfig({ OPENLIST_URL: 'https://name:secret@example.test' }));
});
test('backup is single-flight, sequential, persistent, and incremental', async t => {
  const f = fixture(t); fs.writeFileSync(path.join(f.addonDir, 'small.vpk'), 'abc'); fs.writeFileSync(path.join(f.addonDir, 'large.vpk'), 'abcdef');
  f.manager.startBackup(); f.manager.startBackup(); await f.manager.waitForIdle();
  assert.deepEqual(f.uploaded.map(x => x.name), ['small.vpk', 'large.vpk']);
  assert.equal(f.manager.getStatus().uploaded, 2); assert.equal(f.manager.getStatus().phase, 'completed');
  f.manager.startBackup(); await f.manager.waitForIdle(); assert.equal(f.uploaded.length, 2); assert.equal(f.manager.getStatus().skipped, 2);
  assert.equal(fs.readFileSync(path.join(f.addonDir, 'small.vpk'), 'utf8'), 'abc');
  const second = createCloudMaps({ addonDir: f.addonDir, config: f.config, stateDir: f.stateDir, fetchImpl: f.fetchImpl, uploadImpl: f.uploadImpl }); t.after(() => second.close());
  second.startBackup(); await second.waitForIdle(); assert.equal(second.getStatus().skipped, 2);
});
test('list stays in scoped directory and removes raw URLs and secrets', async t => {
  const f = fixture(t); f.remote.set('map.vpk', { name: 'map.vpk', size: 4, raw_url: 'SECRET', sign: 'SECRET' }); f.remote.set('private.txt', { name: 'private.txt', size: 1 }); f.remote.set('folder', { name: 'folder', is_dir: true });
  const list = await f.manager.listMaps(); assert.equal(list.files.length, 1); assert.equal(JSON.stringify(list).includes('SECRET'), false); assert.equal(f.calls[0].body.path, '/');
});
test('unknown equal-size cloud file is preserved as a separate version', async t => {
  const f = fixture(t); fs.writeFileSync(path.join(f.addonDir, 'map.vpk'), 'new'); f.remote.set('map.vpk', { name: 'map.vpk', size: 3 });
  f.manager.startBackup(); await f.manager.waitForIdle(); assert.equal(f.manager.getStatus().uploaded, 1); assert.match(f.uploaded[0].name, /^map - [a-f0-9]{16}\.vpk$/); assert.equal(f.remote.has('map.vpk'), true);
});
test('denied directory listing fails closed and never uploads', async t => {
  const f = fixture(t, { deny: true }); fs.writeFileSync(path.join(f.addonDir, 'map.vpk'), 'abc'); f.manager.startBackup(); await f.manager.waitForIdle(); assert.equal(f.manager.getStatus().phase, 'failed'); assert.equal(f.uploaded.length, 0);
});
test('resource parts and workshop VPKs are backed up, other file types are excluded', async t => {
  const f = fixture(t); fs.mkdirSync(path.join(f.addonDir, 'workshop')); fs.writeFileSync(path.join(f.addonDir, 'workshop', 'map.vpk'), 'abc'); fs.writeFileSync(path.join(f.addonDir, 'map part2.vpk'), 'asset'); fs.writeFileSync(path.join(f.addonDir, 'private.cfg'), 'skip');
  f.manager.startBackup(); await f.manager.waitForIdle(); assert.equal(f.uploaded.length, 2); assert.ok(f.uploaded.some(x => x.name === 'workshop - map.vpk')); assert.ok(f.uploaded.some(x => x.name === 'map part2.vpk'));
});
test('stop aborts a running upload and disables future automatic runs', async t => {
  const f = fixture(t, { uploadImpl: (url, args) => new Promise((resolve, reject) => { args.signal.addEventListener('abort', () => reject(args.signal.reason), { once: true }); }) });
  fs.writeFileSync(path.join(f.addonDir, 'map.vpk'), 'abc'); f.manager.setEnabled(true);
  for (let i = 0; i < 50 && f.manager.getStatus().current?.stage !== 'uploading'; i++) await new Promise(r => setTimeout(r, 5));
  f.manager.stopBackup(); await f.manager.waitForIdle(); assert.equal(f.manager.getStatus().phase, 'stopped'); assert.equal(f.manager.getStatus().enabled, false); assert.equal(f.manager.getStatus().uploaded, 0);
});
test('share only accepts a map confirmed inside the dedicated cloud folder', async t => {
  const f = fixture(t); await assert.rejects(() => f.manager.shareCloud('../secret.vpk')); await assert.rejects(() => f.manager.shareCloud('absent.vpk'));
  f.remote.set('map.vpk', { name: 'map.vpk', size: 1 }); const share = await f.manager.shareCloud('map.vpk'); assert.equal(share.openUrl, 'https://files.example/s/map-share'); assert.deepEqual(f.calls.at(-1).body.files, ['/l4d2-maps/map.vpk']);
});

test('upload diagnostics expose numeric codes without provider URLs or credentials', () => {
  const e = uploadFailure(200, { code: 500, message: 'timeout https://cloud.example?access_token=SECRET errno: 31326' });
  assert.match(e.message, /HTTP 200 \/ OpenList 500 \/ 上游 31326/);
  assert.equal(e.message.includes('SECRET'), false);
  assert.equal(e.message.includes('cloud.example'), false);
  assert.match(uploadFailure(403, { code: 403, message: 'permission denied' }).message, /上传权限被拒绝/);
});

test('loopback upload accepts only explicit loopback addresses', () => {
  for (const address of ['127.0.0.1', '::1']) assert.equal(cloudConfig({ OPENLIST_CONNECT_ADDRESS: address }).connectAddress, address);
  for (const address of ['example.com', '127.0.0.2', '10.0.0.1']) assert.throws(() => cloudConfig({ OPENLIST_CONNECT_ADDRESS: address }));
});

test('read-only configuration cannot start or enable uploads', t => {
  const f = fixture(t); f.config.upload = false;
  assert.throws(() => f.manager.startBackup(), /尚未启用/);
  assert.throws(() => f.manager.setEnabled(true), /尚未启用/);
  assert.equal(f.manager.getStatus().enabled, false);
  assert.equal(f.uploaded.length, 0);
});

test('cloud size mismatch clears the server backed-up badge', async t => {
  const f = fixture(t); fs.writeFileSync(path.join(f.addonDir, 'map.vpk'), 'abc');
  f.manager.startBackup(); await f.manager.waitForIdle();
  assert.equal((await f.manager.listMaps()).serverFiles[0].backedUp, true);
  f.remote.get('map.vpk').size = 2;
  const list = await f.manager.listMaps();
  assert.equal(list.serverFiles[0].backedUp, false); assert.equal(list.files[0].verified, false);
});

test('enabled backup resumes on a server-side timer without a browser', async t => {
  const f = fixture(t); fs.writeFileSync(path.join(f.addonDir, 'map.vpk'), 'abc');
  const manager = createCloudMaps({ addonDir: f.addonDir, config: f.config, stateDir: path.join(f.root, 'scheduled state'), fetchImpl: f.fetchImpl, uploadImpl: f.uploadImpl, intervalMs: 20, startEnabled: true });
  t.after(() => manager.close());
  for (let i = 0; i < 100 && !f.uploaded.length; i++) await new Promise(r => setTimeout(r, 10));
  await manager.waitForIdle(); assert.equal(f.uploaded.length, 1); assert.equal(manager.getStatus().phase, 'completed');
});
