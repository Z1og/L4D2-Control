const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture() {
  const nodes = new Map();
  let document;
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {
      id, handlers: {}, textContent: '', value: '', hidden: false, isConnected: true,
      addEventListener(type, handler) { this.handlers[type] = handler; },
      focus() { document.activeElement = this; }, select() { this.selected = true; },
      showModal() { if (this.fail) throw Error('unavailable'); this.open = true; },
      close(value) { this.returnValue = value; this.open = false; queueMicrotask(() => this.handlers.close()); }
    });
    return nodes.get(id);
  };
  document = { getElementById: node, activeElement: node('trigger') };
  const context = vm.createContext({ window: {}, document, queueMicrotask });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../panel dialogs.js'), 'utf8'), context);
  const fire = (id, type) => { const event = { prevented: false, preventDefault() { this.prevented = true; } }; node(id).handlers[type](event); return event; };
  return { node, document, api: context.window.PanelDialogs, fire };
}

test('site confirmation waits for explicit acceptance and displays messages as plain text', async () => {
  const f = fixture(); let finished = false;
  const result = f.api.confirm('切换版本？\n<script>unsafe()</script>\n保留已有配置').then(value => { finished = true; return value; });
  assert.equal(f.node('panelConfirmDialog').open, true);
  assert.equal(f.node('panelConfirmTitle').textContent, '切换版本？');
  assert.match(f.node('panelConfirmMessage').textContent, /<script>unsafe\(\)<\/script>/);
  assert.equal(f.document.activeElement.id, 'panelConfirmCancel');
  await Promise.resolve(); assert.equal(finished, false);
  assert.equal(f.fire('panelConfirmForm', 'submit').prevented, true);
  assert.equal(await result, true);
  assert.equal(f.document.activeElement.id, 'trigger');
  assert.equal(f.node('panelConfirmMessage').textContent, '');
});

test('cancel button, close button and Escape all resolve false without acceptance', async () => {
  for (const [id, event] of [['panelConfirmCancel', 'click'], ['panelConfirmClose', 'click'], ['panelConfirmDialog', 'cancel']]) {
    const f = fixture(); const result = f.api.confirm('删除插件？', { danger: true, confirmLabel: '确认删除' });
    assert.equal(f.node('panelConfirmAccept').className, 'danger-button');
    assert.equal(f.node('panelConfirmAccept').textContent, '确认删除');
    const e = f.fire(id, event); if (event === 'cancel') assert.equal(e.prevented, true);
    assert.equal(await result, false); assert.equal(f.node('panelConfirmDialog').open, false);
  }
});

test('copy prompt selects readonly identity and clears its value when closed', async () => {
  const f = fixture(); const result = f.api.prompt('手动复制身份', '76561198000000000', { title: '复制 SteamID64', readOnly: true, label: 'SteamID64', confirmLabel: '完成' });
  assert.equal(f.node('panelConfirmField').hidden, false);
  assert.equal(f.node('panelConfirmInput').selected, true);
  assert.equal(f.node('panelConfirmInput').readOnly, true);
  f.fire('panelConfirmForm', 'submit'); assert.equal(await result, '76561198000000000');
  assert.equal(f.node('panelConfirmInput').value, '');
  const cancelled = f.api.prompt('复制', 'identity'); f.fire('panelConfirmDialog', 'cancel'); assert.equal(await cancelled, null);
});

test('queued confirmations are independent and rapid duplicate clicks do not confirm the next request', async () => {
  const f = fixture(); const first = f.api.confirm('第一项'); const second = f.api.confirm('第二项');
  f.fire('panelConfirmCancel', 'click'); f.fire('panelConfirmForm', 'submit');
  assert.equal(await first, false); await Promise.resolve();
  assert.equal(f.node('panelConfirmTitle').textContent, '第二项');
  f.fire('panelConfirmForm', 'submit'); assert.equal(await second, true);
});

test('unexpected dialog close cancels and failed showModal never falls back to native prompts', async () => {
  const f = fixture(); const result = f.api.confirm('确认'); f.node('panelConfirmDialog').close('confirm'); assert.equal(await result, false);
  f.node('panelConfirmDialog').fail = true;
  await assert.rejects(f.api.confirm('不可显示'), /unavailable/);
});

test('all panel native confirmation and copy prompt call sites use the shared awaited helper', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.ok(html.indexOf('src="panel dialogs.js"') < html.indexOf('src="app.js"'));
  assert.match(html, /id="panelConfirmDialog"[^>]*aria-labelledby="panelConfirmTitle"/);
  for (const name of ['app.js', 'players.js', 'platforms.js', 'gameplay.js']) {
    const source = fs.readFileSync(path.join(root, name), 'utf8');
    assert.doesNotMatch(source, /(?<![\w.])(?:confirm|prompt|alert)\s*\(/, name);
    assert.doesNotMatch(source, /(?<!await )window\.PanelDialogs\.(?:confirm|prompt)\(/, name);
  }
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  assert.match(server, /'panel dialogs.js'/);
  const fingerprint = fs.readFileSync(path.join(root, 'project fingerprint.js'), 'utf8');
  assert.match(fingerprint, /'panel dialogs.js'/);
});

test('whitelist toggle and removal wait for site confirmation, and cancellation restores toggle state', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../players.js'), 'utf8');
  const section = source.slice(source.indexOf("$('#playerWhitelistEnabled').onchange"), source.indexOf('\nfunction playerRows'));
  const nodes = new Map(), updates = []; let decide;
  const node = id => { if (!nodes.has(id)) nodes.set(id, { value: '', addEventListener(type, callback) { this.listener = callback; } }); return nodes.get(id); };
  const context = vm.createContext({ $: node, window: { PanelDialogs: { confirm: () => new Promise(resolve => { decide = resolve; }) } }, updatePlayerWhitelist: async payload => { updates.push(payload); return true; } });
  vm.runInContext(section, context);
  const checkbox = { checked: true };
  const first = node('#playerWhitelistEnabled').onchange({ target: checkbox });
  assert.equal(updates.length, 0); decide(false); await first;
  assert.equal(checkbox.checked, false); assert.equal(updates.length, 0);
  checkbox.checked = true;
  const second = node('#playerWhitelistEnabled').onchange({ target: checkbox }); decide(true); await second;
  assert.equal(updates.length, 1); assert.equal(updates[0].enabled, true); assert.equal(updates[0].confirmed, true);
  const event = { target: { closest: () => ({ dataset: { playerWhitelistRemove: '76561198000000000' } }) } };
  const remove = node('#playerWhitelistList').onclick(event); assert.equal(updates.length, 1); decide(false); await remove; assert.equal(updates.length, 1);
  const confirmed = node('#playerWhitelistList').onclick(event); decide(true); await confirmed; assert.equal(updates.length, 2); assert.equal(updates[1].action, 'remove');
});
