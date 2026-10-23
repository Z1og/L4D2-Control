const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { gzipSync } = require('node:zlib');
const { createPlatforms, parseRuntime, unpackArchive, officialRelease } = require('../platform manager');
function elf(value = 1) { const data = Buffer.alloc(64, value); Buffer.from([127, 69, 76, 70, 1, 1]).copy(data); data.writeUInt16LE(3, 18); return data; }
function tar(entries) {
  const chunks = [];
  for (const [name, data, type = '0'] of entries) {
    const head = Buffer.alloc(512); head.write(name); head.write('0000644\0', 100); head.write('0000000\0', 108); head.write('0000000\0', 116); head.write(data.length.toString(8).padStart(11, '0') + '\0', 124); head.write('00000000000\0', 136); head.fill(32, 148, 156); head.write(type, 156); head.write('ustar\0', 257);
    const sum = head.reduce((a, b) => a + b, 0); head.write(sum.toString(8).padStart(6, '0') + '\0 ', 148); chunks.push(head, data, Buffer.alloc((512 - data.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...chunks, Buffer.alloc(1024)]));
}
async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'Platform test '));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const game = path.join(directory, 'left4dead2'), stateDir = path.join(directory, 'state'); await fs.mkdir(game);
  let version = '1', entries = [['addons/metamod/bin/server.so', elf()], ['addons/metamod.vdf', Buffer.from('official')]], calls = 0;
  const manager = createPlatforms({ serverRoot: directory, stateDir, system: 'linux', capture: async () => '', releaseResolver: async () => ({ version, url: 'https://mms.alliedmods.net/test.tar.gz' }), fetchImpl: async () => { calls++; return new Response(tar(entries)); }, ...options });
  return { directory, game, stateDir, manager, setVersion(value) { version = value; }, setEntries(value) { entries = value; }, calls: () => calls, read: file => fs.readFile(path.join(game, file)), write: async (file, data) => { await fs.mkdir(path.dirname(path.join(game, file)), { recursive: true }); await fs.writeFile(path.join(game, file), data); } };
}
const payload = (action, version = '1', id = 'metamod') => ({ id, action, version, confirmed: true });
test('runtime versions require actual command output and failed MetaMod entries stay failed', () => {
  const parsed = parseRuntime('meta version\nMetamod:Source version 1.12.0-dev+1228\n [01] SourceMod (1.12.0.7255) by AlliedModders\nSourceMod Version: 1.12.0.7255\n [02] L4DToolZ (2.2.0) by Accelerator\n [03] <FAILED> Stripper');
  assert.equal(parsed.metamod.status, 'running'); assert.equal(parsed.sourcemod.version, '1.12.0.7255'); assert.equal(parsed.l4dtoolz.status, 'running'); assert.equal(parsed.stripper.status, 'error'); assert.equal(parseRuntime('Unknown command "meta"').metamod.status, 'unknown');
});
test('archive rejects traversal, links, duplicate members and checksum corruption', () => {
  for (const entries of [[['../outside', elf()]], [['addons/link', Buffer.alloc(0), '2']], [['addons/file', elf()], ['addons/file', elf()]]]) assert.throws(() => unpackArchive(tar(entries)));
  const broken = Buffer.alloc(1024, 1); assert.throws(() => unpackArchive(gzipSync(broken)));
  assert.equal(unpackArchive(tar([['addons/file', elf()]])).size, 1);
});
test('framework bundles only install the exact L4D2 architecture files', () => {
  const { allowedFile } = require('../platform manager');
  assert.equal(allowedFile('metamod', 'addons/metamod/bin/metamod.2.csgo.so'), false);
  assert.equal(allowedFile('metamod', 'addons/metamod/bin/metamod.2.l4d2.so'), true);
  assert.equal(allowedFile('stripper', 'addons/stripper/bin/stripper.2.tf2.so'), false);
  assert.equal(allowedFile('stripper', 'addons/stripper/bin/stripper.2.l4d2.so'), true);
});
test('install, update, persistent rollback and config preservation use actual file bytes', async t => {
  const f = await fixture(t); await f.write('addons/metamod.vdf', 'custom config');
  await assert.rejects(f.manager.act({ ...payload('install'), confirmed: false }), /确认/); assert.equal(f.calls(), 0);
  await f.manager.checkUpdates(); const result = await f.manager.act(payload('install'));
  assert.equal(result.changedFiles, 1); assert.equal((await f.read('addons/metamod.vdf')).toString(), 'custom config'); assert.deepEqual(await f.read('addons/metamod/bin/server.so'), elf());
  let item = (await f.manager.snapshot()).components[0]; assert.equal(item.diskVersion, '1'); assert.equal(item.runtime.status, 'unknown'); assert.equal(item.restartRequired, true);
  f.setVersion('2'); f.setEntries([['addons/metamod/bin/server.so', elf(2)], ['addons/metamod.vdf', Buffer.from('new official')]]); await f.manager.checkUpdates(); await f.manager.act(payload('update', '2'));
  assert.deepEqual(await f.read('addons/metamod/bin/server.so'), elf(2));
  const reopened = createPlatforms({ serverRoot: f.directory, stateDir: f.stateDir, system: 'linux', capture: async () => '' });
  await reopened.act(payload('rollback')); assert.deepEqual(await f.read('addons/metamod/bin/server.so'), elf());
  item = (await reopened.snapshot()).components[0]; assert.equal(item.diskVersion, '1'); assert.equal(item.canRollback, false);
  assert.equal((await f.read('addons/metamod.vdf')).toString(), 'custom config');
});
test('failed multi-file update restores all original bytes and keeps prior rollback', async t => {
  let failNow = false;
  const f = await fixture(t, { fault: index => { if (failNow && index === 1) throw Error('simulated disk failure'); } });
  await f.manager.act(payload('install')); const old = await f.read('addons/metamod/bin/server.so');
  f.setVersion('2'); f.setEntries([['addons/metamod/bin/server.so', elf(2)], ['addons/metamod/bin/metamod.2.l4d2.so', elf(3)]]); await f.manager.checkUpdates(); failNow = true;
  await assert.rejects(f.manager.act(payload('update', '2')), /simulated/); assert.deepEqual(await f.read('addons/metamod/bin/server.so'), old);
  await assert.rejects(f.read('addons/metamod/bin/metamod.2.l4d2.so'), { code: 'ENOENT' }); assert.equal((await f.manager.snapshot()).components[0].diskVersion, '1');
});
test('process interruption is recovered from the durable journal before reporting status', async t => {
  const f = await fixture(t); await f.manager.act(payload('install'));
  const file = path.join(f.stateDir, 'metamod.json'), saved = JSON.parse(await fs.readFile(file));
  saved.pending = { changes: [{ name: 'addons/metamod/bin/server.so', before: elf().toString('base64'), mode: 0o644 }] }; await fs.writeFile(file, JSON.stringify(saved)); await f.write('addons/metamod/bin/server.so', elf(7));
  await f.manager.snapshot(); assert.deepEqual(await f.read('addons/metamod/bin/server.so'), elf()); assert.equal(JSON.parse(await fs.readFile(file)).pending, undefined);
});
test('rollback rejects external edits, failed hashes, stale versions, missing dependencies and mismatched architecture', async t => {
  const f = await fixture(t); await assert.rejects(f.manager.act(payload('install', '1', 'sourcemod')), /先安装/);
  await assert.rejects(f.manager.act(payload('install', 'stale')), /版本已变化/);
  await f.manager.act(payload('install')); await f.write('addons/metamod/bin/server.so', elf(8)); await assert.rejects(f.manager.act(payload('rollback')), /其他操作更改/);
  assert.equal((await f.manager.snapshot()).components[0].diskVersion, null);
  f.setVersion('2'); f.setEntries([['addons/metamod/bin/server.so', Buffer.from('not an ELF')]]); await f.manager.checkUpdates(); await assert.rejects(f.manager.act(payload('update', '2')), /ELF/);
  assert.deepEqual(await f.read('addons/metamod/bin/server.so'), elf(8));
  const bad = await fixture(t, { releaseResolver: async () => ({ version: '1', url: 'https://mms.alliedmods.net/file', sha256: '0'.repeat(64) }) });
  await assert.rejects(bad.manager.act(payload('install')), /SHA-256/);
});
test('existing SourceMod SMX and configuration stay untouched while gamedata is updated', async t => {
  const f = await fixture(t); await f.manager.act(payload('install'));
  await f.write('addons/sourcemod/plugins/adminmenu.smx', 'existing plugin'); await f.write('addons/sourcemod/configs/admins_simple.ini', 'admin permissions'); await f.write('addons/sourcemod/gamedata/sdkhooks.games.txt', 'old gamedata');
  f.setEntries([['addons/sourcemod/bin/sourcemod.2.l4d2.so', elf()], ['addons/sourcemod/plugins/adminmenu.smx', Buffer.from('bundled plugin')], ['addons/sourcemod/configs/admins_simple.ini', Buffer.from('default permissions')], ['addons/sourcemod/gamedata/sdkhooks.games.txt', Buffer.from('new gamedata')]]);
  await f.manager.act(payload('install', '1', 'sourcemod'));
  assert.equal((await f.read('addons/sourcemod/plugins/adminmenu.smx')).toString(), 'existing plugin'); assert.equal((await f.read('addons/sourcemod/configs/admins_simple.ini')).toString(), 'admin permissions'); assert.equal((await f.read('addons/sourcemod/gamedata/sdkhooks.games.txt')).toString(), 'new gamedata');
});
test('only one action runs at a time and symlinked directories cannot redirect installation', async t => {
  let releaseDownload; const gate = new Promise(resolve => { releaseDownload = resolve; });
  const f = await fixture(t, { fetchImpl: async () => { await gate; return new Response(tar([['addons/metamod/bin/server.so', elf()]])); } });
  const first = f.manager.act(payload('install')); await assert.rejects(f.manager.act(payload('install')), /正在执行/); releaseDownload(); await first;
  const other = await fixture(t), outside = path.join(other.directory, 'outside'); await fs.mkdir(outside); await fs.symlink(outside, path.join(other.game, 'addons'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(other.manager.act(payload('install')), /符号链接/); assert.deepEqual(await fs.readdir(outside), []);
});
test('dependency records are shared plugin identities, with no second Left4DHooks manager', async t => {
  const f = await fixture(t); await f.write('addons/sourcemod/plugins/left4dhooks.smx', 'fixture');
  const d = (await f.manager.snapshot()).dependencies; assert.equal(d.plugins[0].id, 'left4dhooks'); assert.equal(d.plugins[0].managedIn, 'plugins'); assert.deepEqual(d.plugins[0].requires, ['sourcemod']);
  await assert.rejects(f.manager.act(payload('install', '1', 'left4dhooks')), /操作无效/);
});
test('official release resolver accepts matching stable Linux asset and refuses another repo', async () => {
  const request = async url => url.includes('mmsdrop') ? new Response('mmsource-1.12.0-git1228-linux.tar.gz') : new Response(JSON.stringify({ tag_name: '2.2.0', assets: [{ name: 'l4dtoolz-l4d2-linux-abc123.tar.gz', browser_download_url: 'https://github.com/accelerator74/l4dtoolz/releases/download/2.2.0/l4dtoolz-l4d2-linux-abc123.tar.gz', size: 100 }] }));
  assert.equal((await officialRelease('metamod', request)).version, '1.12.0-git1228'); assert.equal((await officialRelease('l4dtoolz', request)).version, '2.2.0');
  await assert.rejects(officialRelease('l4dtoolz', async () => new Response(JSON.stringify({ tag_name: '2.2.0', assets: [{ name: 'l4dtoolz-l4d2-linux-abc123.tar.gz', browser_download_url: 'https://github.com/other/repo/file', size: 100 }] }))), /地址/);
});
test('peer tabs persist independently, support keyboard switching and block ordinary accounts', async () => {
  const source = await fs.readFile(path.join(__dirname, '../platforms.js'), 'utf8');
  for (const guest of [false, true]) {
    const nodes = new Map(), saved = new Map(), calls = [];
    const node = id => { if (!nodes.has(id)) nodes.set(id, { classList: { toggle() {} }, setAttribute() {}, focus() { calls.push('focus'); } }); return nodes.get(id); };
    const context = vm.createContext({ window: { panelState: { set: (key, value) => saved.set(key, value), activate: value => calls.push(value) } }, $: node, isGuest: guest, api: async () => { throw Error('fixture offline'); }, post() {}, icons() {}, escapeHtml: String });
    vm.runInContext(source, context); context.window.selectPluginPage('platforms');
    assert.equal(node('#platformPage').hidden, guest); assert.equal(saved.get('pluginPage'), guest ? 'plugins' : 'platforms');
    if (!guest) { node('#platformTab').onkeydown({ key: 'ArrowLeft', preventDefault() {} }); assert.equal(node('#pluginPage').hidden, false); assert.ok(calls.includes('focus')); }
  }
  const html = await fs.readFile(path.join(__dirname, '../index.html'), 'utf8'); assert.equal((html.match(/data-view="plugins"/g) || []).length, 2); assert.match(html, /插件、平台管理/); assert.match(html, /id="platformPage" role="tabpanel"/);
});
