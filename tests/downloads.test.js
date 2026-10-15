const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const yazl = require('yazl');
const { createManager, validateVpk, unpackZip } = require('../download manager');
const { parseSearch, officialUrl } = require('../content sources');
const { createSource } = require('../content sources');
const https = require('node:https');
const net = require('node:net');
const { EventEmitter } = require('node:events');

function vpk(name = 'sample') {
  const entry = Buffer.alloc(18); entry.writeUInt16LE(0x7fff, 6); entry.writeUInt16LE(0xffff, 16);
  const tree = Buffer.concat([Buffer.from(`txt\0missions\0${name}\0`), entry, Buffer.alloc(3)]);
  const header = Buffer.alloc(12); header.writeUInt32LE(0x55aa1234); header.writeUInt32LE(1, 4); header.writeUInt32LE(tree.length, 8);
  return Buffer.concat([header, tree]);
}
function fixture(t) { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'panel-test-')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root; }
async function waitFor(manager, id, predicate) {
  const end = Date.now() + 8000;
  while (Date.now() < end) { const job = manager.list().find(item => item.id === id); if (predicate(job)) return job; await new Promise(resolve => setTimeout(resolve, 15)); }
  throw new Error('job timed out: ' + JSON.stringify(manager.list()));
}
const ended = job => ['completed', 'failed', 'cancelled'].includes(job.status);
async function zip(file, files) { const archive = new yazl.ZipFile(); for (const [name, buffer] of files) archive.addBuffer(buffer, name); const output = pipeline(archive.outputStream, fs.createWriteStream(file)); archive.end(); await output; }
function manager(root, source) { return createManager({ addonDir: path.join(root, 'addons'), steamcmdPath: '/missing', workshopProxy: '', localMode: true, stateDir: path.join(root, 'state'), gameMapsSource: source }); }
function response(buffer, total = buffer.length) { const stream = Readable.from([buffer]); stream.headers = { 'content-length': String(total) }; return stream; }

test('GameMaps parser uses structured data and rejects unrelated links', () => {
  const html = `<article data-info='{"url":"/details/9406","image":"/img/a.jpg","title":"Admin System"}'></article><article class="list-item-file"><a href="/details/25"><img src="/img/b.jpg"></a><div class="title">Map B</div></article><article data-info='{"url":"https://evil.example/details/3","title":"bad"}'></article>`;
  assert.deepEqual(parseSearch(html).map(item => item.id), ['9406', '25']);
  assert.equal(officialUrl('/details/9406').hostname, 'www.gamemaps.com');
  for (const url of ['http://www.gamemaps.com/x', 'https://gamemaps.com.evil.example/x', 'https://127.0.0.1/x', 'https://x@www.gamemaps.com/x']) assert.throws(() => officialUrl(url));
});

test('GameMaps search excludes featured recommendations, including an empty result page', () => {
  const item = (id, title) => `<article class="list-item-file"><a href="/details/${id}"></a><div class="title">${title}</div></article>`;
  const page = results => `<section class="provider gamemaps"><div class="paged-list"><ul class="item-list">${results}</ul></div><section class="featured">${item(99, 'Unrelated')}</section></section>${item(100, 'Footer')}`;
  assert.deepEqual(parseSearch(page(item(21, 'Actual result'))).map(item => item.id), ['21']);
  assert.deepEqual(parseSearch(page('')), []);
});

test('GameMaps native provider, compound next relation and form values are retained', async t => {
  const calls = [], pages = [
    '<section class="provider gamemaps"><div class="paged-list"><ul class="item-list"></ul></div></section><a rel="next nofollow" href="?page=2">Next</a>',
    '<a href="/l4d2">L4D2</a><form action="/downloads/download"><input name="ids[]" value="21"><input name="noqueue" value="true"><input name="direct" value="true"></form>',
    'zip fixture'
  ];
  t.mock.method(https, 'request', (url, options, callback) => {
    const req = new EventEmitter();
    req.end = body => { calls.push({ url, body }); queueMicrotask(() => { const stream = Readable.from([Buffer.from(pages.shift())]); stream.statusCode = 200; stream.headers = {}; callback(stream); }); };
    return req;
  });
  const source = createSource();
  const search = await source.search('campaign', 1);
  assert.equal(calls[0].url.searchParams.get('provider'), 'gamemaps');
  assert.equal(search.hasMore, true); assert.deepEqual(search.items, []);
  (await source.download('21')).resume();
  assert.equal(new URLSearchParams(calls[2].body).get('noqueue'), 'true');
  assert.equal(new URLSearchParams(calls[2].body).get('direct'), 'true');
});
test('GameMaps source keeps SOCKS routing for search, form submission and redirects only', async t => {
  const calls = [], globalAgent = https.globalAgent;
  const pages = [
    { status: 302, headers: { location: '/l4d2?page=2' }, body: '' },
    { body: `<article data-info='{"url":"/details/9406","title":"Sample"}'></article>` },
    { body: '<a href="/l4d2">L4D2</a><form action="/downloads/download"><input name="ids[]" value="9406"></form>' },
    { status: 307, headers: { location: 'https://downloads.gamemaps.com/file/9406' }, body: '' },
    { headers: { 'content-type': 'application/zip' }, body: 'fixture' }
  ];
  t.mock.method(https, 'request', (url, options, callback) => {
    const page = pages.shift(); assert.ok(page);
    const req = new EventEmitter();
    req.end = body => { calls.push({ url, options, body }); queueMicrotask(() => { const stream = Readable.from([Buffer.from(page.body)]); stream.statusCode = page.status || 200; stream.headers = page.headers || {}; callback(stream); }); };
    return req;
  });
  const source = createSource('socks5h://127.0.0.1:10808');
  assert.equal((await source.search('sample', 1)).items.length, 1);
  const download = await source.download('9406'); download.resume();
  assert.equal(calls.length, 5);
  assert.ok(calls[0].options.agent);
  for (const call of calls) assert.equal(call.options.agent, calls[0].options.agent);
  assert.equal(calls[0].options.agent.shouldLookup, false);
  assert.equal(calls[3].options.method, 'POST'); assert.equal(calls[4].options.method, 'POST');
  assert.equal(calls[3].body, calls[4].body); assert.match(calls[3].body, /ids%5B%5D=9406/);
  assert.equal(https.globalAgent, globalAgent);
});
test('GameMaps proxy failure does not fall back to a direct request', async t => {
  let connections = 0;
  const proxy = net.createServer(socket => { connections++; socket.destroy(); });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => proxy.close(resolve)));
  const source = createSource(`socks5h://127.0.0.1:${proxy.address().port}`);
  await assert.rejects(source.search('sample', 1, AbortSignal.timeout(2000)), /Socket closed|connection|Socks|ECONNRESET/i);
  assert.equal(connections, 1);
});
test('GameMaps source accepts only a loopback SOCKS5h endpoint', () => {
  for (const proxy of ['http://127.0.0.1:10808', 'socks5://127.0.0.1:10808', 'socks5h://remote.example:10808', 'socks5h://127.0.0.1:99999']) assert.throws(() => createSource(proxy));
});

test('GameMaps identifies a Cloudflare challenge without retrying or falling back', async t => {
  let calls = 0, status = 403;
  t.mock.method(https, 'request', (url, options, callback) => {
    calls++; assert.ok(options.agent);
    const req = new EventEmitter();
    req.end = () => queueMicrotask(() => { const stream = Readable.from([Buffer.from('<title>Just a moment...</title>')]); stream.statusCode = status; stream.headers = status === 403 ? {'cf-mitigated':'challenge'} : {}; callback(stream); });
    return req;
  });
  const source = createSource('socks5h://127.0.0.1:10808');
  await assert.rejects(source.search('太原', 1), error => error.code === 'GAMEMAPS_CHALLENGE' && error.status === 403 && /站点验证/.test(error.message));
  assert.equal(calls,1);
  status = 200;
  await assert.rejects(source.search('太原', 1), error => error.code === 'GAMEMAPS_CHALLENGE');
  assert.equal(calls,2);
});
test('VPK validation rejects truncated, split and empty packages', t => {
  const root = fixture(t), file = path.join(root, 'sample.vpk'); fs.writeFileSync(file, vpk());
  assert.equal(validateVpk(file), vpk().length);
  fs.writeFileSync(file, vpk().subarray(0, 15)); assert.throws(() => validateVpk(file));
  const split = vpk(); split.writeUInt16LE(0, 12 + Buffer.byteLength('txt\0missions\0sample\0') + 6); split.writeUInt32LE(1, 12 + Buffer.byteLength('txt\0missions\0sample\0') + 12); fs.writeFileSync(file, split); assert.throws(() => validateVpk(file));
  fs.writeFileSync(file, Buffer.alloc(12)); assert.throws(() => validateVpk(file));
});
test('ZIP extracts only VPK files and detects traversal', async t => {
  const root = fixture(t), file = path.join(root, 'map.zip'), folder = path.join(root, 'output'); fs.mkdirSync(folder);
  await zip(file, [['map.vpk', vpk()], ['installer.sh', Buffer.from('never run')]]);
  await unpackZip(file, folder, new AbortController().signal); assert.equal(fs.readdirSync(folder).length, 1);
  const original = fs.readFileSync(file), malicious = Buffer.from(original); let offset = 0;
  while ((offset = malicious.indexOf(Buffer.from('map.vpk'), offset)) !== -1) { Buffer.from('../.vpk').copy(malicious, offset); offset += 7; }
  fs.writeFileSync(file, malicious); await assert.rejects(unpackZip(file, folder, new AbortController().signal));
});
test('Linux queue downloads, installs, deduplicates and recovers stored results', { skip: process.platform === 'win32' }, async t => {
  const root = fixture(t), source = { download: async () => response(vpk()) }, m = manager(root, source);
  const first = m.start('gamemaps', '9406', 'Sample'), duplicate = m.start('gamemaps', '9406', 'Sample'); assert.equal(first.id, duplicate.id);
  const done = await waitFor(m, first.id, ended); assert.equal(done.status, 'completed'); assert.equal(done.receivedBytes, vpk().length); assert.equal(done.totalBytes, vpk().length);
  assert.equal(fs.readdirSync(path.join(root, 'addons')).length, 1);
  const second = m.start('gamemaps', '9406'); const exists = await waitFor(m, second.id, ended); assert.equal(exists.alreadyInstalled, true);
  const reloaded = manager(root, source); assert.equal(reloaded.list().length, 2); assert.equal(reloaded.list()[0].status, 'completed');
});
test('Linux download meter exposes actual bytes before completion and cancellation stops transfer', { skip: process.platform === 'win32' }, async t => {
  const root = fixture(t); let signal;
  const source = { download: async (_, abortSignal) => { signal = abortSignal; const stream = new Readable({ read() {} }); stream.headers = { 'content-length': '1000' }; setTimeout(() => stream.push(Buffer.alloc(100)), 40); return stream; } };
  const m = manager(root, source), job = m.start('gamemaps', '21');
  const progress = await waitFor(m, job.id, job => job.receivedBytes === 100); assert.equal(progress.totalBytes, 1000); assert.equal(progress.status, 'downloading');
  m.cancel(job.id); await new Promise(resolve => setTimeout(resolve, 80)); assert.equal(signal.aborted, true); assert.equal(m.list()[0].status, 'cancelled'); assert.equal(fs.existsSync(path.join(root, 'addons')), false);
});

test('Linux browser transfer exposes network progress before its file stream exists and cancels cleanly', { skip: process.platform === 'win32' }, async t => {
  const root = fixture(t); let signal;
  const source = { download: async (_, abortSignal, progress) => {
    signal = abortSignal;
    progress({ receivedBytes: 1234, totalBytes: 9000 });
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  } };
  const m = manager(root, source), job = m.start('gamemaps', '21');
  const current = await waitFor(m, job.id, item => item.receivedBytes === 1234);
  assert.equal(current.status, 'downloading'); assert.equal(current.totalBytes, 9000);
  m.cancel(job.id); await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(signal.aborted, true); assert.equal(m.list()[0].status, 'cancelled');
  assert.equal(fs.existsSync(path.join(root, 'addons')), false);
});
test('Linux rejects HTML, incomplete downloads and conflicting installed names without overwrite', { skip: process.platform === 'win32' }, async t => {
  const root = fixture(t); let buffer = Buffer.from('<html>verification</html>'), total;
  const m = manager(root, { download: async () => response(buffer, total ?? buffer.length) });
  let job = m.start('gamemaps', '20'); assert.equal((await waitFor(m, job.id, ended)).status, 'failed');
  buffer = vpk(); total = buffer.length + 10; job = m.start('gamemaps', '21'); assert.match((await waitFor(m, job.id, ended)).error, /不完整/);
  total = undefined; fs.mkdirSync(path.join(root, 'addons')); const existing = path.join(root, 'addons', 'gamemaps-22-content-22.vpk'); fs.writeFileSync(existing, 'keep original');
  job = m.start('gamemaps', '22'); assert.equal((await waitFor(m, job.id, ended)).status, 'failed'); assert.equal(fs.readFileSync(existing, 'utf8'), 'keep original');
});
test('Linux restart marks interrupted jobs failed instead of showing false progress', { skip: process.platform === 'win32' }, t => {
  const root = fixture(t), state = path.join(root, 'state'); fs.mkdirSync(state); fs.writeFileSync(path.join(state, 'jobs.json'), JSON.stringify([{ id: 'interrupted', status: 'downloading', receivedBytes: 25 }]));
  const m = manager(root, { download: async () => response(vpk()) }); assert.equal(m.list()[0].status, 'failed'); assert.match(m.list()[0].error, /重启/);
});
test('Linux installs all VPKs in ZIP, omitting other downloaded files', { skip: process.platform === 'win32' }, async t => {
  const root = fixture(t), file = path.join(root, 'maps.zip'); await zip(file, [['a.vpk', vpk('a')], ['b.vpk', vpk('b')], ['x.exe', Buffer.from('do not execute')]]);
  const m = manager(root, { download: async () => response(fs.readFileSync(file)) }); const job = m.start('gamemaps', '23'); const done = await waitFor(m, job.id, ended); assert.equal(done.status, 'completed'); assert.equal(done.installedFiles.length, 2); assert.equal(fs.readdirSync(path.join(root, 'addons')).length, 2);
});
test('Linux SteamCMD fixture uses staging and installs without network access', { skip: process.platform === 'win32' }, async t => {
  const root = fixture(t), script = path.join(root, 'fake steamcmd.sh'); fs.writeFileSync(path.join(root, 'sample.vpk'), vpk());
  fs.writeFileSync(script, `#!/bin/bash\nset -eu\nstage="$2"\nid="$7"\nmkdir -p "$stage/steamapps/workshop/content/550/$id"\nsleep 1\ncp '${root}/sample.vpk' "$stage/steamapps/workshop/content/550/$id/sample.vpk"\necho 'fixture download complete'\n`, { mode: 0o700 });
  const m = createManager({ addonDir: path.join(root, 'addons'), steamcmdPath: script, workshopProxy: '', localMode: true, stateDir: path.join(root, 'state') }); const job = m.start('steam-workshop', '3812612203'); const done = await waitFor(m, job.id, ended); assert.equal(done.status, 'completed'); assert.equal(done.totalBytes, null);
});

test('Linux SteamCMD stops an oversized active transfer before installation', { skip: process.platform === 'win32' }, async t => {
  const root = fixture(t), script = path.join(root, 'large steamcmd.sh');
  fs.writeFileSync(script, '#!/bin/bash\nset -eu\nstage="$2"\nid="$7"\nmkdir -p "$stage/steamapps/workshop/downloads/550/$id"\nhead -c 200 /dev/zero > "$stage/steamapps/workshop/downloads/550/$id/partial"\nsleep 5\n', { mode: 0o700 });
  const m = createManager({ addonDir: path.join(root, 'addons'), steamcmdPath: script, workshopProxy: '', localMode: true, stateDir: path.join(root, 'state'), steamTransferLimit: 100 });
  const job = m.start('steam-workshop', '3812612203'); const done = await waitFor(m, job.id, ended);
  assert.equal(done.status, 'failed'); assert.match(done.error, /超过/); assert.equal(done.receivedBytes, 200); assert.equal(fs.existsSync(path.join(root, 'addons')), false);
});
