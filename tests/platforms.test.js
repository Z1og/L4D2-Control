const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { gzipSync } = require('node:zlib');
const { createPlatforms, parseRuntime, unpackArchive, unpackPackage, officialRelease, officialCatalog } = require('../platform manager');
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
  assert.equal(parseRuntime('Metamod:Source Version Information\n    Metamod:Source version 1.12.0-dev+1219').metamod.version, '1.12.0-dev+1219');
  assert.equal(parseRuntime('Metamod:Source Version Information').metamod.status, 'unknown');
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

test('official build catalog enumerates all Source 1 branches, sorts builds and marks per-branch cautions', async () => {
  const requests = [];
  const fetcher = async url => {
    requests.push(url);
    if (url.endsWith('mmsdrop/')) return new Response('<a href="1.11/">old</a><a href="1.12/">stable</a><a href="1.13/">dev</a><a href="2.0/">Source2</a><a href="https://bad/">bad</a>');
    if (url.endsWith('latest-linux')) return new Response('mmsource-1.12.0-git1228-linux.tar.gz');
    const branch = url.match(/(1\.\d+)\/$/)[1];
    return new Response([1227, 1228].map(build => `<a href="mmsource-${branch}.0-git${build}-linux.tar.gz">ok</a>`).join('') + '<a href="mmsource-1.12.0-git9999-windows.zip">win</a><a href="../evil-linux.tar.gz">evil</a>');
  };
  const result = await officialCatalog('metamod', fetcher);
  assert.equal(result.versions.length, 6); assert.equal(result.latest.version, '1.12.0-git1228'); assert.equal(result.complete, true);
  assert.equal(result.versions[0].version, '1.13.0-git1228'); assert.match(result.versions[0].notes.join(' '), /开发分支/);
  assert.match(result.versions.at(-1).notes.join(' '), /历史分支/); assert.equal(new Set(result.versions.map(item => item.id)).size, 6);
  assert.ok(!requests.some(url => url.includes('2.0')));
});

test('catalog identifies partial failures without discarding good branches', async () => {
  const result = await officialCatalog('sourcemod', async url => {
    if (url.endsWith('smdrop/')) return new Response('<a href="1.11/">old</a><a href="1.12/">stable</a>');
    if (url.endsWith('latest-linux')) return new Response('sourcemod-1.12.0-git7220-linux.tar.gz');
    if (url.includes('/1.11/')) return new Response('offline', { status: 503 });
    return new Response('<a href="sourcemod-1.12.0-git7220-linux.tar.gz">ok</a>');
  });
  assert.equal(result.versions.length, 1); assert.equal(result.complete, false); assert.match(result.warnings[0], /503/);
});

function githubRelease(tag, assets, extra = {}, repo = 'accelerator74/l4dtoolz') {
  return { tag_name: tag, body: '<script>not executable</script> release notes', assets: assets.map(name => ({ name, size: 100, browser_download_url: `https://github.com/${repo}/releases/download/${tag}/${name}` })), ...extra };
}
test('GitHub catalog paginates and keeps historical variants with their own guidance, excluding wrong games and ABIs', async () => {
  const releases = Array.from({ length: 100 }, (_, i) => githubRelease('2.2.' + i, ['l4dtoolz-l4d2-linux-abc123.tar.gz']));
  const result = await officialCatalog('l4dtoolz', async url => new Response(JSON.stringify(url.endsWith('page=1') ? releases : [githubRelease('1.1.0.2', ['l4dtoolz-l4d2-abc.zip', 'l4dtoolz-l4d-abc.zip']), githubRelease('2.2.0', ['l4dtoolz-l4d2-oldlinux-abc.tar.gz'])])));
  assert.equal(result.versions.length, 102); assert.ok(result.complete);
  assert.match(result.versions.find(item => item.file.endsWith('.zip')).notes.join(' '), /旧版人数/);
  assert.match(result.versions.find(item => item.file.includes('oldlinux')).notes.join(' '), /-maxplayers/);
  const stripper = await officialCatalog('stripper', async () => new Response(JSON.stringify([githubRelease('v1.2.2-git158', ['stripper-1.2.2-git158-mms1.12-linux.tar.gz', 'stripper-1.2.2-git158-mms2.0-linux.tar.gz', 'stripper-1.2.2-git158-mms1.12-windows.zip'], {}, 'alliedmodders/stripper-source'), githubRelease('v1.2.2-git151', ['stripper-1.2.2-git151-linux.tar.gz'], {}, 'alliedmodders/stripper-source')])));
  assert.equal(stripper.versions.length, 2); assert.match(stripper.versions[0].notes.join(' '), /MetaMod 1.12/); assert.match(stripper.versions[1].notes.join(' '), /未显式标注/);
  const wrong = githubRelease('2.2.0', ['l4dtoolz-l4d2-linux-abc.tar.gz']); wrong.assets[0].browser_download_url = 'https://github.com/other/repo/file';
  await assert.rejects(officialCatalog('l4dtoolz', async () => new Response(JSON.stringify([wrong]))), /地址/);
});

test('historical version selection installs, downgrades, removes obsolete managed binaries and rolls back', async t => {
  const versions = [{ id: 'new', version: '2', url: 'https://mms.alliedmods.net/new.tar.gz', file: 'new.tar.gz' }, { id: 'old', version: '1', url: 'https://mms.alliedmods.net/old.tar.gz', file: 'old.tar.gz' }];
  const f = await fixture(t, { catalogResolver: async () => ({ latest: versions[0], versions }), fetchImpl: async url => new Response(tar(url.includes('/new') ? [['addons/metamod/bin/server.so', elf(2)], ['addons/metamod/bin/metamod.2.l4d2.so', elf(3)]] : [['addons/metamod/bin/server_i486.so', elf()]])) });
  await f.manager.checkUpdates();
  await assert.rejects(f.manager.act({ ...payload('install', '1'), releaseId: 'forged' }), /所选版本无效/);
  await assert.rejects(f.manager.act({ ...payload('install', '1'), releaseId: 'new' }), /所选版本无效/);
  await f.manager.act({ ...payload('install', '2'), releaseId: 'new' });
  await f.manager.act({ ...payload('update', '1'), releaseId: 'old', url: 'https://untrusted.example/' });
  assert.deepEqual(await f.read('addons/metamod/bin/server_i486.so'), elf());
  await assert.rejects(f.read('addons/metamod/bin/server.so'), { code: 'ENOENT' }); await assert.rejects(f.read('addons/metamod/bin/metamod.2.l4d2.so'), { code: 'ENOENT' });
  assert.equal((await f.manager.snapshot()).components[0].diskReleaseId, 'old');
  await f.manager.act(payload('rollback'));
  assert.deepEqual(await f.read('addons/metamod/bin/server.so'), elf(2)); assert.deepEqual(await f.read('addons/metamod/bin/metamod.2.l4d2.so'), elf(3)); await assert.rejects(f.read('addons/metamod/bin/server_i486.so'), { code: 'ENOENT' });
  assert.equal((await f.manager.snapshot()).components[0].diskVersion, '2');
});

test('ambiguous build labels require the server-issued identity and catalog refresh failures retain known versions', async t => {
  const versions = ['normal', 'legacy'].map(id => ({ id, version: '1', url: 'https://mms.alliedmods.net/' + id })); let offline = false;
  const f = await fixture(t, { catalogResolver: async () => { if (offline) throw Error('offline'); return { versions, latest: versions[0] }; } });
  await f.manager.checkUpdates(); offline = true;
  const result = await f.manager.checkUpdates(); assert.equal(result.components[0].versions.length, 2); assert.match(result.updateErrors.metamod, /offline/);
  await assert.rejects(f.manager.act(payload('install')), /所选版本无效/);
  await f.manager.act({ ...payload('install'), releaseId: 'legacy' }); assert.equal((await f.manager.snapshot()).components[0].diskReleaseId, 'legacy');
});

test('Stripper ABI mismatches are rejected before downloading a package', async t => {
  const f = await fixture(t, { capture: async () => 'Metamod:Source version 1.11.0-dev+1148', catalogResolver: async () => ({ versions: [{ id: 'stripper12', version: '158', file: 'stripper-1.2.2-git158-mms1.12-linux.tar.gz', url: 'https://github.com/alliedmodders/stripper-source/releases/download/v1/file.tar.gz' }] }) });
  await f.write('addons/metamod/bin/server.so', elf());
  await assert.rejects(f.manager.act({ ...payload('install', '158', 'stripper'), releaseId: 'stripper12' }), /需要 MetaMod 1.12/); assert.equal(f.calls(), 0);
});

test('historical mixed ZIP accepts Linux package but rejects links and duplicate paths', async () => {
  const yazl = require('yazl');
  const archive = entries => new Promise(resolve => { const zip = new yazl.ZipFile(), chunks = []; for (const [name, data, mode] of entries) zip.addBuffer(data, name, mode ? { mode } : {}); zip.outputStream.on('data', chunk => chunks.push(chunk)); zip.outputStream.on('end', () => resolve(Buffer.concat(chunks))); zip.end(); });
  const files = await unpackPackage(await archive([['addons/l4dtoolz/l4dtoolz_mm.so', elf()], ['addons/l4dtoolz/l4dtoolz_mm.dll', Buffer.from('windows')]]), 'legacy.zip'); assert.equal(files.size, 2);
  await assert.rejects(unpackPackage(await archive([['link', Buffer.from('outside'), 0o120777]]), 'legacy.zip'), /链接/);
  await assert.rejects(unpackPackage(await archive([['same', elf()], ['same', elf()]]), 'legacy.zip'), /重复/);
});

test('version picker changes cautions, preserves choice and confirms the selected version without automatic writes', async () => {
  const source = await fs.readFile(path.join(__dirname, '../platforms.js'), 'utf8'), nodes = new Map(), saved = new Map(), posts = [], confirmations = [];
  const node = id => { if (!nodes.has(id)) nodes.set(id, { classList: { toggle() {} }, setAttribute() {}, focus() {} }); return nodes.get(id); };
  const versions = [{ id: 'new', version: '2', branch: '1.12', notes: ['NEW CAUTION'], releaseNotes: 'new notes' }, { id: 'old', version: '1', branch: '1.11', notes: ['OLD CAUTION'], releaseNotes: '<script>alert(1)</script>' }];
  const data = { components: [{ id: 'metamod', name: 'MetaMod', caution: 'BASE', requires: [], runtime: { status: 'unknown' }, installed: true, latest: versions[0], versions }], dependencies: { platforms: {} }, supported: true, checkedAt: new Date().toISOString() };
  const context = vm.createContext({ window: { PanelDialogs: { confirm: async text => { confirmations.push(text); return false; } }, panelState: { get: (key, fallback) => saved.get(key) || fallback, set: (key, value) => saved.set(key, value) } }, $: node, isGuest: false, api: async () => data, post: async (url, body) => { posts.push({ url, body }); return data; }, icons() {}, escapeHtml: value => String(value ?? '').replaceAll('<', '&lt;').replaceAll('>', '&gt;'), confirm: text => { confirmations.push(text); return false; }, Date, Map });
  vm.runInContext(source, context); await node('#refreshPlatforms').onclick(); assert.match(node('#platformGrid').innerHTML, /NEW CAUTION/);
  node('#platformGrid').onchange({ target: { id: 'platformBranch-metamod', dataset: { platformBranch: 'metamod' }, value: '1.11' } });
  assert.match(node('#platformGrid').innerHTML, /OLD CAUTION/); assert.doesNotMatch(node('#platformGrid').innerHTML, /NEW CAUTION/); assert.ok(node('#platformGrid').innerHTML.includes('&lt;script&gt;')); assert.equal(posts.length, 0); assert.equal(saved.get('platformVersion:metamod'), 'old');
  await node('#platformGrid').onclick({ target: { closest: () => ({ dataset: { platformId: 'metamod', platformAction: 'update' } }) } });
  assert.match(confirmations[0], /至 1（1.11）/); assert.match(confirmations[0], /OLD CAUTION/); assert.equal(posts.length, 0);
  await node('#refreshPlatforms').onclick(); assert.match(node('#platformGrid').innerHTML, /OLD CAUTION/);
  context.window.PanelDialogs.confirm = async text => { confirmations.push(text); return true; }; context.record = () => {}; context.toast = () => {}; context.loadPlugins = async () => {};
  await node('#platformGrid').onclick({ target: { closest: () => ({ dataset: { platformId: 'metamod', platformAction: 'update' } }) } });
  assert.equal(posts.length, 1); assert.equal(posts[0].body.releaseId, 'old'); assert.equal(posts[0].body.version, '1'); assert.equal(posts[0].body.confirmed, true);
});

test('catalogs persist across panel restarts and only manual checks contact official sources', async t => {
  let calls = 0, offline = false;
  const options = { catalogResolver: async id => { calls++; if (offline) throw Error('offline'); const release = { id, version: '1', url: 'https://mms.alliedmods.net/test.tar.gz' }; return { versions: [release], latest: release }; } };
  const f = await fixture(t, options);
  assert.ok((await f.manager.snapshot()).components.every(item => !item.versions.length)); assert.equal(calls, 0);
  await Promise.all([f.manager.checkUpdates(), f.manager.checkUpdates()]); assert.equal(calls, 4);
  const first = await f.manager.snapshot(); assert.ok(first.components.every(item => item.versions.length === 1 && item.catalogCheckedAt));
  const restarted = createPlatforms({ serverRoot: f.directory, stateDir: f.stateDir, capture: async () => '', ...options });
  offline = true;
  for (let i = 0; i < 3; i++) assert.deepEqual((await restarted.snapshot()).components.map(item => item.versions), first.components.map(item => item.versions));
  assert.equal(calls, 4);
  const failed = await restarted.checkUpdates(); assert.equal(calls, 8); assert.match(failed.updateErrors.metamod, /offline/);
  assert.deepEqual(failed.components.map(item => item.catalogCheckedAt), first.components.map(item => item.catalogCheckedAt));
  const again = createPlatforms({ serverRoot: f.directory, stateDir: f.stateDir, capture: async () => '', ...options });
  assert.deepEqual((await again.snapshot()).components.map(item => item.versions), first.components.map(item => item.versions)); assert.equal(calls, 8);
});

test('corrupt catalog cache does not trigger a network request and manual refresh repairs it', async t => {
  let calls = 0;
  const f = await fixture(t, { catalogResolver: async () => { calls++; return { versions: [{ id: 'fixture', version: '1' }] }; } });
  await fs.mkdir(f.stateDir); await fs.writeFile(path.join(f.stateDir, 'Version cache metamod.json'), '{broken');
  const snapshot = await f.manager.snapshot(); assert.equal(calls, 0); assert.equal(snapshot.components[0].versions.length, 0); assert.match(snapshot.components[0].catalogWarnings[0], /缓存不可用/);
  const refreshed = await f.manager.checkUpdates(); assert.equal(calls, 4); assert.equal(refreshed.components[0].versions.length, 1); assert.deepEqual(refreshed.components[0].catalogWarnings, []);
  assert.equal(JSON.parse(await fs.readFile(path.join(f.stateDir, 'Version cache metamod.json'), 'utf8')).schema, 1);
});

test('opening and reloading platform page reads cached catalogs without automatic check POST', async () => {
  const source = await fs.readFile(path.join(__dirname, '../platforms.js'), 'utf8');
  const nodes = new Map(), requests = [];
  const node = id => { if (!nodes.has(id)) nodes.set(id, { classList: { toggle() {} }, setAttribute() {} }); return nodes.get(id); };
  const data = { components: [], dependencies: { platforms: {} }, supported: true, checkedAt: new Date().toISOString() };
  const makeContext = () => vm.createContext({ window: {}, $: node, isGuest: false, api: async url => { requests.push('GET ' + url); return data; }, post: async url => { requests.push('POST ' + url); return data; }, icons() {}, escapeHtml: String, Date, Map });
  let context = makeContext(); vm.runInContext(source, context); await context.window.selectPluginPage('platforms');
  assert.deepEqual(requests, ['GET /api/platforms']); assert.match(node('#platformStatus').textContent, /尚无版本缓存/);
  await node('#refreshPlatforms').onclick(); assert.deepEqual(requests, ['GET /api/platforms', 'GET /api/platforms']);
  context = makeContext(); vm.runInContext(source, context); await context.window.selectPluginPage('platforms');
  assert.equal(requests.filter(value => value.startsWith('POST')).length, 0);
  await node('#checkPlatformUpdates').onclick(); assert.equal(requests.at(-1), 'POST /api/platforms/check');
});
