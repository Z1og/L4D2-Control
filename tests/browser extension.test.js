const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const yauzl = require('yauzl');
const root = path.join(__dirname, '..');
const source = path.join(root, 'browser extension', 'L4D2 Baidu Download Helper');

function fixture(tab = { id: 17, url: 'https://panel.example.test:4174/maps' }) {
  const nodes = new Map(); let rules = [], rejected = false;
  const document = { getElementById(id) {
    if (!nodes.has(id)) nodes.set(id, { textContent: '', hidden: false, disabled: false, addEventListener(name, fn) { this[name] = fn; } });
    return nodes.get(id);
  } };
  const chrome = { tabs: { query: async () => [tab] }, declarativeNetRequest: {
    getSessionRules: async () => rules,
    updateSessionRules: async ({ addRules = [] }) => { if (rejected) throw Error('Rule rejected'); rules = addRules; }
  } };
  const context = vm.createContext({ document, chrome, URL });
  vm.runInContext(fs.readFileSync(path.join(source, 'popup.js'), 'utf8'), context);
  return { nodes, ready: () => new Promise(resolve => setImmediate(resolve)), rules: () => JSON.parse(JSON.stringify(rules)), reject: () => { rejected = true; } };
}

test('extension binding restricts tab, source and CDN; disable clears the session', async () => {
  const f = fixture(); await f.ready(); await f.nodes.get('bind').click();
  const [rule] = f.rules();
  assert.deepEqual(rule.condition.tabIds, [17]);
  assert.deepEqual(rule.condition.initiatorDomains, ['panel.example.test']);
  assert.deepEqual(rule.condition.requestDomains, ['baidupcs.com', 'pcs.baidu.com']);
  assert.deepEqual(rule.action.requestHeaders, [{ header: 'user-agent', operation: 'set', value: 'pan.baidu.com' }]);
  await f.nodes.get('disable').click(); assert.deepEqual(f.rules(), []);
  assert.equal(f.nodes.get('disable').hidden, true);
});

test('extension rejects internal pages and CDN tabs and reports browser rejection', async () => {
  for (const url of ['chrome://extensions', 'file:///private.html', 'https://baidupcs.com/a', 'https://cdn.pcs.baidu.com/a']) {
    const f = fixture({ id: 9, url }); await f.ready(); await f.nodes.get('bind').click();
    assert.deepEqual(f.rules(), []); assert.ok(f.nodes.get('notice').textContent);
    assert.equal(f.nodes.get('bind').disabled, false);
  }
  const f = fixture(); await f.ready(); f.reject(); await f.nodes.get('bind').click();
  assert.equal(f.nodes.get('notice').textContent, 'Rule rejected'); assert.deepEqual(f.rules(), []);
});

test('manifest has no all-sites, cookies, proxy, scripting or storage access', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json')));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ['activeTab', 'declarativeNetRequestWithHostAccess']);
  assert.deepEqual(manifest.host_permissions, ['https://*.baidupcs.com/*', 'https://*.pcs.baidu.com/*']);
  assert.equal(manifest.content_scripts, undefined); assert.equal(manifest.externally_connectable, undefined);
});

test('download ZIP contains only release files and is byte-for-byte current', async () => {
  const expected = new Map(['manifest.json', 'popup.js', 'popup.html', 'popup.css'].map(name => [name, path.join(source, name)]));
  expected.set('使用说明.md', path.join(root, 'browser extension', '使用说明.md'));
  await new Promise((resolve, reject) => yauzl.open(path.join(root, 'downloads', 'L4D2 Baidu Download Helper.zip'), { lazyEntries: true }, (error, zip) => {
    if (error) return reject(error);
    zip.on('error', reject); zip.on('end', () => { try { assert.equal(expected.size, 0); resolve(); } catch (e) { reject(e); } });
    zip.on('entry', entry => {
      if (!expected.has(entry.fileName)) { zip.close(); reject(Error('Unexpected ZIP entry: ' + entry.fileName)); return; }
      zip.openReadStream(entry, (error, stream) => {
        if (error) return reject(error); const chunks = [];
        stream.on('error', reject); stream.on('data', chunk => chunks.push(chunk));
        stream.on('end', () => { try { assert.deepEqual(Buffer.concat(chunks), fs.readFileSync(expected.get(entry.fileName))); expected.delete(entry.fileName); zip.readEntry(); } catch (e) { reject(e); zip.close(); } });
      });
    }); zip.readEntry();
  }));
});

test('browser direct link stays in the bound tab and hides unsupported hosts', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const link = html.match(/<a id="browserDirectDownload"[^>]*>/)[0];
  assert.doesNotMatch(link, /target=|noreferrer/);
  const script = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const body = script.slice(script.indexOf('function updateCloudDownloadCommand()'), script.indexOf("$('#cloudDownloadTool').onchange"));
  for (const [url, direct, ua, hidden] of [
    ['https://cdn.baidupcs.com/file', true, 'pan.baidu.com', false],
    ['https://pcs.baidu.com/file', true, 'pan.baidu.com', false],
    ['https://baidupcs.com.evil.test/file', true, 'pan.baidu.com', true],
    ['https://pan.baidu.com/file', true, 'pan.baidu.com', true],
    ['http://cdn.baidupcs.com/file', true, 'pan.baidu.com', true],
    ['https://cdn.baidupcs.com/file', false, 'pan.baidu.com', true]
  ]) {
    const elements = {}; const context = vm.createContext({ URL, cloudDirectInfo: { name: 'map.vpk', url, direct, userAgent: ua }, $: key => elements[key] ||= {} });
    vm.runInContext(body + '\nupdateCloudDownloadCommand();', context);
    assert.equal(elements['#browserDirectDownload'].hidden, hidden, url);
  }
});
