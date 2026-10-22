const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const workerCode = fs.readFileSync(path.join(root, 'browser extension/L4D2 Baidu Download Helper/background.js'), 'utf8');
const payload = { action: 'download', url: 'https://cdn.baidupcs.com/file?sign=fixture', name: 'map.vpk', size: 100 };
const sender = { tab: { id: 17 }, url: 'https://panel.example/maps' };
function worker(fetchImpl) {
  const context = vm.createContext({ URL, TextDecoder, Uint8Array, AbortSignal, fetch: fetchImpl, chrome: {
    runtime: { getManifest: () => ({ version: '1.2.1' }), onMessage: { addListener() {} } },
    tabs: { onUpdated: { addListener() {} } },
    declarativeNetRequest: { getSessionRules: async () => [{ id: 1, condition: { tabIds: [17], initiatorDomains: ['panel.example'] } }] }
  } });
  vm.runInContext(workerCode, context); return context;
}
function vpk(magic = [0x34, 0x12, 0xaa, 0x55], size = 100) { const bytes = new Uint8Array(32); bytes.set(magic); return new Response(bytes, { status: 206, headers: { 'content-range': `bytes 0-31/${size}` } }); }
test('download helper checks source tab, host and VPK metadata before approval', async () => {
  let calls = 0; const w = worker(async (url, options) => { calls++; assert.equal(options.headers.Range, 'bytes=0-31'); assert.equal(options.credentials, 'omit'); return vpk(); });
  for (const bad of [{ tab: { id: 18 }, url: sender.url }, { ...sender, url: 'https://other.example/' }, {}]) await assert.rejects(w.handleMessage(payload, bad));
  for (const url of ['http://cdn.baidupcs.com/file', 'https://baidupcs.com.evil.test/file', 'https://a:b@cdn.baidupcs.com/file', 'https://127.0.0.1/file']) await assert.rejects(w.handleMessage({ ...payload, url }, sender));
  assert.equal(calls, 0);
  assert.equal((await w.handleMessage(payload, sender)).verified, true); assert.equal(calls, 1);
});
test('reload restores only the bound tab bridge after document completion', async () => {
  let onUpdate; const injections = [];
  const c = vm.createContext({ URL, chrome: {
    tabs: { onUpdated: { addListener(fn) { onUpdate = fn; } } },
    runtime: { onMessage: { addListener() {} } },
    scripting: { async executeScript(options) { injections.push(options.target.tabId); } },
    declarativeNetRequest: { async getSessionRules() { return [{ id: 1, condition: { tabIds: [17], initiatorDomains: ['panel.example'] } }]; } }
  } });
  vm.runInContext(workerCode, c);
  onUpdate(17, { status: 'loading' }, { url: sender.url });
  onUpdate(18, { status: 'complete' }, { url: sender.url });
  onUpdate(17, { status: 'complete' }, { url: 'https://other.example/' });
  await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(injections, []);
  onUpdate(17, { status: 'complete' }, { url: sender.url });
  await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(injections, [17]);
});
test('bridge reports an invalidated extension context instead of silently failing', () => {
  let receive; const replies = [];
  const window = { addEventListener(name, fn) { receive = fn; }, postMessage(data) { replies.push(data); } };
  const c = vm.createContext({ window, location: { origin: 'https://panel.example' }, chrome: { runtime: {
    onMessage: { addListener() {} }, sendMessage() { throw Error('Extension context invalidated.'); }
  } } });
  vm.runInContext(fs.readFileSync(path.join(root, 'browser extension/L4D2 Baidu Download Helper/bridge.js'), 'utf8'), c);
  receive({ source: window, origin: 'https://panel.example', data: { source: 'l4d2-control', action: 'status', requestId: 'test' } });
  assert.equal(replies.length, 1); assert.equal(replies[0].ok, false); assert.match(replies[0].error, /重新绑定/);
});
test('31362, wrong file type and changed size are reported instead of navigating', async () => {
  const w = worker(async () => new Response(JSON.stringify({ error_code: 31362, error_msg: 'sign error' }), { status: 403 }));
  await assert.rejects(w.handleMessage(payload, sender), /31362/);
  for (const response of [vpk([1, 2, 3, 4]), vpk(undefined, 101)]) await assert.rejects(worker(async () => response).handleMessage(payload, sender), /内容或大小/);
});
test('concurrent requests from the same bound tab do not duplicate verification', async () => {
  let release; const w = worker(() => new Promise(resolve => { release = resolve; }));
  const first = w.handleMessage(payload, sender); await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(w.handleMessage(payload, sender), /正在检查/); release(vpk()); await first;
});
test('missing extension gives actionable guidance; foreign or unrelated messages are ignored', async () => {
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const code = app.slice(app.indexOf('function requestDownloadHelper('), app.indexOf('function updateCloudDownloadCommand()'));
  let receive, sent, timeout; const window = { addEventListener: (name, fn) => { receive = fn; }, removeEventListener: () => { receive = null; }, postMessage: data => { sent = data; } };
  const c = vm.createContext({ window, location: { origin: 'https://panel.example' }, crypto: { randomUUID: () => 'fixture-id' }, cloudDirectController: null, setTimeout: fn => { timeout = fn; return 1; }, clearTimeout() {}, DOMException }); vm.runInContext(code, c);
  const missing = c.requestDownloadHelper('status'); const rejected = assert.rejects(missing, /1\.2\.1/); timeout(); await rejected; assert.equal(receive, null);
  const present = c.requestDownloadHelper('status'); receive({ source: window, origin: 'https://other.example', data: { source: 'l4d2-download-helper', requestId: sent.requestId, ok: true } }); assert.notEqual(receive, null);
  receive({ source: window, origin: 'https://panel.example', data: { source: 'l4d2-download-helper', requestId: sent.requestId, ok: true, version: '1.2.1' } }); assert.equal((await present).version, '1.2.1'); assert.equal(receive, null);
});
