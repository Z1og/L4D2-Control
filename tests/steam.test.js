const test = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { EventEmitter } = require('node:events');
const { createSource, parseSearch, buildSearchUrl, officialFileUrl } = require('../steam source');
const { createManager } = require('../download manager');

const id = '3583374422', fileUrl = 'https://cdn.steamusercontent.com/ugc/sample';
function sampleVpk() {
  const entry = Buffer.alloc(18); entry.writeUInt16LE(0x7fff, 6); entry.writeUInt16LE(0xffff, 16);
  const tree = Buffer.concat([Buffer.from('txt\0missions\0sample\0'), entry, Buffer.alloc(3)]);
  const header = Buffer.alloc(12); header.writeUInt32LE(0x55aa1234); header.writeUInt32LE(1, 4); header.writeUInt32LE(tree.length, 8);
  return Buffer.concat([header, tree]);
}
function response(buffer) { const stream = Readable.from([buffer]); stream.headers = { 'content-length': String(buffer.length) }; return stream; }
function fixture(t, source, extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'panel-steam-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const manager = createManager({ addonDir: path.join(root, 'addons'), stateDir: path.join(root, 'state'), steamcmdPath: '/missing', workshopProxy: 'socks5h://127.0.0.1:10808', localMode: true, steamSource: source, ...extra });
  return { manager, root };
}
async function finished(manager, job) {
  const end = Date.now() + 4000;
  while (Date.now() < end) {
    const current = manager.list().find(item => item.id === job.id);
    if (['completed', 'failed', 'cancelled'].includes(current.status)) return current;
    await new Promise(resolve => setTimeout(resolve, 15));
  }
  throw new Error('Steam fixture timed out');
}
test('Steam search binds each ID, title and image to the same anchor', () => {
  const html = '<a href="/sharedfiles/filedetails/?id=11"><img src="https://images.steamusercontent.com/a" alt="Map A"></a><a href="/sharedfiles/filedetails/?id=11">Map A title</a><a href="/sharedfiles/filedetails/?id=22"><img alt="Map B &amp; C" src="https://images.steamusercontent.com/b"></a><a href="https://evil.example/sharedfiles/filedetails/?id=33"><img alt="Wrong host"></a>';
  const items = parseSearch(html);
  assert.deepEqual(items.map(item => [item.id, item.title]), [['11', 'Map A'], ['22', 'Map B & C']]);
  assert.equal(items[1].image, 'https://images.steamusercontent.com/b');
});
test('Steam search uses the Simplified Chinese locale and preserves the requested page', () => {
  const url = new URL(buildSearchUrl('狂潮珠江', 2));
  assert.equal(url.origin, 'https://steamcommunity.com');
  assert.equal(url.pathname, '/workshop/browse/');
  assert.equal(url.searchParams.get('appid'), '550');
  assert.equal(url.searchParams.get('searchtext'), '狂潮珠江');
  assert.equal(url.searchParams.get('p'), '2');
  assert.equal(url.searchParams.get('l'), 'schinese');
});
test('Steam search returns all 30 cards on a full official page', () => {
  const html = Array.from({ length: 32 }, (_, index) => `<a href="/sharedfiles/filedetails/?id=${index + 1}"><img src="https://images.steamusercontent.com/${index + 1}" alt="Map ${index + 1}"></a>`).join('');
  const items = parseSearch(html);
  assert.equal(items.length, 30);
  assert.deepEqual(items.map(item => item.id), Array.from({ length: 30 }, (_, index) => String(index + 1)));
});
test('Steam metadata and CDN redirects retain the selected proxy with remote DNS', async t => {
  const calls = [], globalAgent = https.globalAgent;
  const pages = [
    { body: JSON.stringify({ response: { publishedfiledetails: [{ result: 1, publishedfileid: id, consumer_app_id: 550, title: 'Map', file_size: '53', file_url: fileUrl }] } }) },
    { status: 302, headers: { location: 'https://steamusercontent-a.akamaihd.net/ugc/sample' }, body: '' },
    { body: 'file' }
  ];
  t.mock.method(https, 'request', (url, options, callback) => {
    const page = pages.shift(), req = new EventEmitter();
    req.end = body => { calls.push({ url, options, body }); queueMicrotask(() => { const stream = Readable.from([Buffer.from(page.body)]); stream.headers = page.headers || {}; stream.statusCode = page.status || 200; callback(stream); }); };
    return req;
  });
  const source = createSource('socks5h://127.0.0.1:10808'), item = await source.details(id);
  assert.equal(item.bytes, 53);
  const download = await source.download(item.fileUrl); download.resume();
  assert.equal(calls.length, 3); assert.equal(calls[0].options.method, 'POST');
  assert.match(calls[0].body, /publishedfileids%5B0%5D=3583374422/);
  for (const call of calls) assert.equal(call.options.agent, calls[0].options.agent);
  assert.equal(calls[0].options.agent.shouldLookup, false); assert.equal(https.globalAgent, globalAgent);
});
test('Steam source rejects non-official, plaintext and credential-bearing download URLs', () => {
  for (const url of ['http://cdn.steamusercontent.com/file', 'https://cdn.steamusercontent.com.evil.example/file', 'https://127.0.0.1/file', 'https://user@cdn.steamusercontent.com/file', 'https://cdn.steamusercontent.com:8443/file']) assert.throws(() => officialFileUrl(url));
  for (const proxy of ['http://127.0.0.1:10808', 'socks5h://remote.example:10808', 'socks5h://127.0.0.1:99999']) assert.throws(() => createSource(proxy));
});
test('Steam details rejects the wrong app and mismatched identity', async t => {
  let item = { result: 1, publishedfileid: id, consumer_app_id: 730 };
  t.mock.method(https, 'request', (_, options, callback) => {
    const req = new EventEmitter(); req.end = () => queueMicrotask(() => { const stream = response(Buffer.from(JSON.stringify({ response: { publishedfiledetails: [item] } }))); stream.statusCode = 200; callback(stream); }); return req;
  });
  const source = createSource(); await assert.rejects(source.details(id), /不是求生之路/);
  item = { result: 1, publishedfileid: '99', consumer_app_id: 550 }; await assert.rejects(source.details(id), /不存在/);
});
test('Linux Steam official file installs with known-byte progress, no SteamCMD', { skip: process.platform === 'win32' }, async t => {
  const bytes = sampleVpk(), source = { details: async () => ({ title: 'Map', fileUrl, bytes: bytes.length }), download: async () => response(bytes) };
  const { manager, root } = fixture(t, source);
  const done = await finished(manager, manager.start('steam-workshop', id, 'Map'));
  assert.equal(done.status, 'completed'); assert.equal(done.totalBytes, bytes.length); assert.equal(done.receivedBytes, bytes.length);
  assert.deepEqual(fs.readdirSync(path.join(root, 'addons')), [`workshop-${id}-content-${id}.vpk`]);
});
test('Linux rejects stale mismatched titles before any file download', { skip: process.platform === 'win32' }, async t => {
  let downloads = 0;
  const { manager, root } = fixture(t, { details: async () => ({ title: 'Actual plugin', fileUrl, bytes: 53 }), download: async () => { downloads++; return response(sampleVpk()); } });
  const done = await finished(manager, manager.start('steam-workshop', id, 'Wrong map'));
  assert.equal(done.status, 'failed'); assert.match(done.error, /重新搜索/); assert.equal(downloads, 0); assert.equal(fs.existsSync(path.join(root, 'addons')), false);
  assert.equal(done.errorCode, 'STEAM_IDENTITY_MISMATCH'); assert.equal(done.retryable, false);
  assert.throws(() => manager.start('steam-workshop', id, 'Wrong map'), /重新搜索/);
});

test('Stored identity mismatch fixes only matching failed history and survives dismissal', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'panel-history-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const stateDir = path.join(root, 'state'), addonDir = path.join(root, 'addons');
  fs.mkdirSync(stateDir); fs.mkdirSync(addonDir); fs.writeFileSync(path.join(addonDir, 'keep.vpk'), 'existing');
  const records = [
    { id:'old', source:'steam-workshop', itemId:'22', title:'Wrong  map', status:'failed', error:'No Connection' },
    { id:'proof', source:'steam-workshop', itemId:'22', title:'Wrong map', status:'failed', error:'项目名称与 Steam 官方编号不一致，请重新搜索后安装，不要重试旧任务' },
    { id:'other-title', source:'steam-workshop', itemId:'22', title:'Actual title', status:'failed', error:'No Connection' },
    { id:'other-source', source:'gamemaps', itemId:'22', title:'Wrong map', status:'failed', error:'HTTP 403' }
  ];
  fs.writeFileSync(path.join(stateDir,'jobs.json'), JSON.stringify(records));
  const options = { stateDir, addonDir, localMode:true, steamcmdPath:'/missing', workshopProxy:'' };
  const manager = createManager(options);
  assert.equal(manager.list().find(job => job.id === 'old').retryable, false);
  assert.equal(manager.list().find(job => job.id === 'other-title').error, 'No Connection');
  assert.equal(manager.list().find(job => job.id === 'other-source').error, 'HTTP 403');
  assert.deepEqual(manager.dismiss('old'), {ok:true});
  assert.equal(manager.list().some(job => job.id === 'old'), false);
  assert.equal(createManager(options).list().some(job => job.id === 'old'), false);
  assert.ok(JSON.parse(fs.readFileSync(path.join(stateDir,'jobs.json'))).find(job => job.id === 'old').dismissedAt);
  assert.equal(fs.readFileSync(path.join(addonDir,'keep.vpk'),'utf8'), 'existing');
  if (process.platform !== 'win32') assert.throws(() => manager.start('steam-workshop','22','Wrong map'), /重新搜索/);
});

test('Linux cannot dismiss a queued or active job', { skip: process.platform === 'win32' }, async t => {
  const { manager } = fixture(t, { details: (_, signal) => new Promise((resolve, reject) => { signal.addEventListener('abort', () => reject(signal.reason), {once:true}); }) });
  const job = manager.start('steam-workshop', id);
  assert.throws(() => manager.dismiss(job.id), /等待任务结束/);
  for (let i=0; i<100 && manager.list()[0].status === 'queued'; i++) await new Promise(resolve=>setTimeout(resolve,10));
  manager.cancel(job.id);
  assert.throws(() => manager.dismiss(job.id), /等待任务结束/);
  await new Promise(resolve=>setTimeout(resolve,50));
  assert.deepEqual(manager.dismiss(job.id), {ok:true});
});
test('Linux metadata or CDN failure never falls back to SteamCMD or direct traffic', { skip: process.platform === 'win32' }, async t => {
  for (const source of [{ details: async () => { throw new Error('proxy unavailable'); } }, { details: async () => ({ title: 'Map', fileUrl, bytes: 53 }), download: async () => { throw new Error('CDN proxy unavailable'); } }]) {
    const { manager, root } = fixture(t, source);
    const done = await finished(manager, manager.start('steam-workshop', id, 'Map'));
    assert.equal(done.status, 'failed'); assert.match(done.error, /proxy unavailable/); assert.equal(fs.existsSync(path.join(root, 'addons')), false);
  }
});
test('Linux Steam file rejects oversized metadata and incomplete or non-VPK bodies', { skip: process.platform === 'win32' }, async t => {
  const { manager, root } = fixture(t, { details: async () => ({ title: 'Map', fileUrl, bytes: 200 }), download: async () => { throw new Error('must not open oversized file'); } }, { steamTransferLimit: 100 });
  assert.match((await finished(manager, manager.start('steam-workshop', id, 'Map'))).error, /超过/);
  assert.equal(fs.existsSync(path.join(root, 'addons')), false);
  const html = Buffer.from('<html>not a package</html>');
  for (const [bytes, total, expected] of [[sampleVpk(), 100, /不完整/], [html, html.length, /VPK/]]) {
    const fixtureResult = fixture(t, { details: async () => ({ title: 'Map', fileUrl, bytes: total }), download: async () => response(bytes) });
    const done = await finished(fixtureResult.manager, fixtureResult.manager.start('steam-workshop', id, 'Map'));
    assert.equal(done.status, 'failed'); assert.match(done.error, expected);
  }
});
test('Linux cancellation stops an official file stream without installation', { skip: process.platform === 'win32' }, async t => {
  let signal;
  const { manager, root } = fixture(t, { details: async () => ({ title: 'Map', fileUrl, bytes: 1000 }), download: async (_, abortSignal) => { signal = abortSignal; const stream = new Readable({ read() {} }); stream.headers = {}; return stream; } });
  const job = manager.start('steam-workshop', id, 'Map');
  for (let i = 0; !signal && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 15));
  assert.ok(signal); manager.cancel(job.id);
  const done = await finished(manager, job); assert.equal(done.status, 'cancelled'); assert.equal(signal.aborted, true);
  await new Promise(resolve => setTimeout(resolve, 50)); assert.equal(fs.existsSync(path.join(root, 'addons')), false);
});
test('Localized names require the same official ID and title, with cancellation forwarded', async t => {
  let rows = [{ id, title: '狂潮珠江 v1.0' }], calls = 0;
  const controller = new AbortController();
  t.mock.method(https, 'request', (_, options, callback) => {
    const req = new EventEmitter(); req.end = () => queueMicrotask(() => {
      const stream = response(Buffer.from(JSON.stringify({ response: { publishedfiledetails: [{ result: 1, publishedfileid: id, consumer_app_id: 550, title: 'Pearl River Rage v1.0', file_url: fileUrl, file_size: '53' }] } })));
      stream.statusCode = 200; callback(stream);
    }); return req;
  });
  const source = createSource('', { search: async (query, page, signal) => { calls++; assert.equal(query, '狂潮珠江 v1.0'); assert.equal(page, 1); assert.equal(signal, controller.signal); return { items: rows }; } });
  assert.equal((await source.details(id, controller.signal, '狂潮珠江 v1.0')).title, '狂潮珠江 v1.0');
  rows = [{ id: '99', title: '狂潮珠江 v1.0' }];
  assert.equal((await source.details(id, controller.signal, '狂潮珠江 v1.0')).title, 'Pearl River Rage v1.0');
  rows = [{ id, title: 'Wrong map' }];
  assert.equal((await source.details(id, controller.signal, '狂潮珠江 v1.0')).title, 'Pearl River Rage v1.0');
  assert.equal((await source.details(id, controller.signal, 'Pearl River Rage v1.0')).title, 'Pearl River Rage v1.0');
  assert.equal(calls, 3);
  const failed = createSource('', { search: async () => { throw new Error('proxy unavailable'); } });
  await assert.rejects(failed.details(id, controller.signal, '狂潮珠江 v1.0'), /proxy unavailable/);
});
test('Linux localized search title reaches verification and installs fixture bytes', { skip: process.platform === 'win32' }, async t => {
  const bytes = sampleVpk(); let searches = 0;
  t.mock.method(https, 'request', (_, options, callback) => {
    const req = new EventEmitter(); req.end = () => queueMicrotask(() => {
      const stream = response(options.method === 'POST' ? Buffer.from(JSON.stringify({ response: { publishedfiledetails: [{ result: 1, publishedfileid: id, consumer_app_id: 550, title: 'Pearl River Rage v1.0', file_url: fileUrl, file_size: String(bytes.length) }] } })) : bytes);
      stream.statusCode = 200; callback(stream);
    }); return req;
  });
  const source = createSource('', { search: async () => { searches++; return { items: [{ id, title: '狂潮珠江 v1.0' }] }; } });
  const { manager } = fixture(t, source);
  const done = await finished(manager, manager.start('steam-workshop', id, '狂潮珠江 v1.0'));
  assert.equal(done.status, 'completed'); assert.equal(done.title, '狂潮珠江 v1.0'); assert.equal(done.receivedBytes, bytes.length); assert.equal(searches, 1);
});
