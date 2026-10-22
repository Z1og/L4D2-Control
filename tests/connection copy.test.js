const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const code = app.slice(app.indexOf('async function loadConnection()'), app.indexOf('function icons()'));
function fixture(address, { rejectClipboard = false, fallbackWorks = false, failConfig = false } = {}) {
  const nodes = new Map(), copied = [], notices = [], fallbacks = [];
  const node = key => { if (!nodes.has(key)) nodes.set(key, { style: {}, scrollHeight: 68, focus() { this.focused = true; }, select() { this.selected = true; } }); return nodes.get(key); };
  const context = vm.createContext({ gameAddress: '', openListState: {},
    api: async () => { if (failConfig) throw Error('Offline'); return { gameAddress: address }; },
    $: node, $$: () => [node('address')], renderCloudBackup() {}, renderMaps() {}, toast: text => notices.push(text),
    navigator: { clipboard: { async writeText(text) { if (rejectClipboard) throw Error('Denied'); copied.push(text); } } },
    document: { activeElement: node('previous'), createElement() { const item = { style: {}, setAttribute() {}, focus() {}, select() {}, remove() { this.removed = true; } }; fallbacks.push(item); return item; }, body: { append() {} }, execCommand(name) { assert.equal(name, 'copy'); return fallbackWorks; } }
  });
  vm.runInContext(code, context); return { context, nodes, copied, notices, fallbacks };
}
test('connection display and copied command follow configured host and port', async () => {
  for (const address of ['203.0.113.42:28015', 'games.example.test:27025', '[2001:db8::42]:27035']) {
    const f = fixture(address); await f.context.loadConnection();
    assert.equal(f.nodes.get('#serverConnectCommand').value, 'connect ' + address);
    assert.equal(f.nodes.get('#copyServerConnection').disabled, false);
    await f.context.copyGameConnection(); assert.deepEqual(f.copied, ['connect ' + address]);
    assert.match(f.notices[0], /已复制/);
  }
});
test('missing or failed configuration disables copying instead of using a fixed address', async () => {
  for (const f of [fixture(''), fixture('unused', { failConfig: true }), fixture({ host: 'invalid' })]) {
    await f.context.loadConnection(); await f.context.copyGameConnection();
    assert.equal(f.nodes.get('#serverConnectCommand').value, '');
    assert.equal(f.nodes.get('#copyServerConnection').disabled, true);
    assert.deepEqual(f.copied, []); assert.equal(f.fallbacks.length, 0); assert.match(f.notices[0], /配置/);
  }
});
test('clipboard fallback copies only the command and restores focus without leaving a field', async () => {
  const f = fixture('games.example.test:28015', { rejectClipboard: true, fallbackWorks: true });
  await f.context.loadConnection(); await f.context.copyGameConnection();
  assert.equal(f.fallbacks[0].value, 'connect games.example.test:28015');
  assert.equal(f.fallbacks[0].removed, true); assert.equal(f.nodes.get('previous').focused, true); assert.match(f.notices[0], /已复制/);
});
test('denied clipboard and fallback expose manual selection without reporting success', async () => {
  const f = fixture('games.example.test:28015', { rejectClipboard: true });
  await f.context.loadConnection(); await f.context.copyGameConnection();
  assert.equal(f.nodes.get('#serverConnectCommand').selected, true);
  assert.match(f.notices[0], /Ctrl\+C/); assert.doesNotMatch(f.notices[0], /已复制/); assert.equal(f.fallbacks[0].removed, true);
});
test('sidebar has a labelled readonly command field and an explicit copy icon', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const sidebar = html.slice(html.indexOf('class="server-chip'), html.indexOf('<nav class="nav-list"'));
  assert.match(sidebar, /for="serverConnectCommand"/); assert.match(sidebar, /id="serverConnectCommand"[^>]+readonly/);
  assert.match(sidebar, /id="copyServerConnection"/); assert.match(sidebar, /data-lucide="copy"/);
  assert.doesNotMatch(sidebar, /好友合作服务器|\b\d+\.\d+\.\d+\.\d+:\d+/);
});
