const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const code = app.slice(app.indexOf('const panelViews ='), app.indexOf('async function api('));
function fixture(hash = '', saved = null, blocked = false) {
  const views = ['overview', 'maps', 'plugins', 'diagnostics', 'workshop', 'proxy', 'players', 'logs', 'settings'];
  const events = {}, calls = [];
  const nodes = views.map(view => ({ id: view + 'View', dataset: { view }, classList: { toggle() {} }, setAttribute() {}, removeAttribute() {} }));
  const title = {}, location = { hash };
  const context = vm.createContext({ location, history: { replaceState(a, b, value) { if (blocked) throw Error('Denied'); location.hash = value; } },
    sessionStorage: { getItem() { if (blocked) throw Error('Denied'); return saved; }, setItem(key, value) { if (blocked) throw Error('Denied'); saved = value; } },
    document: { addEventListener(name, fn) { events[name] = fn; } }, window: { addEventListener(name, fn) { events[name] = fn; } },
    $: () => title, $$: () => nodes, icons() {}, loadProxy() { calls.push('proxy'); }, loadPlayers() { calls.push('players'); },
    loadDownloads() { calls.push('workshop'); }, loadCloudBackup() { calls.push('diagnostics'); }, startCloudPolling() {}, stopCloudPolling() {}
  });
  vm.runInContext(code, context); return { context, events, location, title, calls, saved: () => saved };
}
test('all panel sections restore on reload, after dependent scripts are initialized', () => {
  for (const view of ['overview', 'maps', 'plugins', 'diagnostics', 'workshop', 'proxy', 'players', 'logs', 'settings']) {
    const first = fixture(); first.context.navigate(view); assert.equal(first.location.hash, '#' + view);
    const second = fixture(first.location.hash, first.saved()); assert.equal(second.calls.length, 0);
    second.events.DOMContentLoaded(); assert.equal(second.location.hash, '#' + view); assert.equal(second.saved(), view);
    assert.ok(second.title.textContent); if (view === 'players') assert.deepEqual(second.calls, ['players']);
  }
});
test('hash navigation, storage fallback and invalid or blocked storage are safe', () => {
  const f = fixture('', 'maps'); f.events.DOMContentLoaded(); assert.equal(f.location.hash, '#maps');
  f.location.hash = '#plugins'; f.events.hashchange(); assert.equal(f.saved(), 'plugins');
  for (const hash of ['#unknown', '#__proto__', '#constructor', '#%invalid']) {
    const bad = fixture(hash, 'maps'); bad.events.DOMContentLoaded(); assert.equal(bad.location.hash, '#overview');
  }
  const blocked = fixture('#players', null, true); blocked.events.DOMContentLoaded(); assert.equal(blocked.title.textContent, '在线玩家');
  const empty = fixture('', null, true); empty.events.DOMContentLoaded(); assert.equal(empty.title.textContent, '总览');
});

function filterFixture(saved = null, blocked = false) {
  const buttons = ['custom', 'official', 'other'].map(filter => ({ dataset: { filter }, classList: { toggle(name, active) { this.active = active; } }, setAttribute(name, value) { this[name] = value; } }));
  const context = vm.createContext({ mapFilter: 'all', campaigns: buttons.map(button => ({ type: button.dataset.filter, name: button.dataset.filter, english: '', chapters: [] })),
    sessionStorage: { getItem() { if (blocked) throw Error('Denied'); return saved; }, setItem(key, value) { if (blocked) throw Error('Denied'); assert.equal(key, 'l4d2-map-filter'); saved = value; } },
    $$: () => buttons, $: () => ({ value: '' }), renderMaps() {}
  });
  vm.runInContext(app.slice(app.indexOf('function savedMapFilter()'), app.indexOf('function renderMaps()')) + '\nmapFilter = savedMapFilter(); syncMapFilterButtons();', context);
  return { context, buttons, saved: () => saved };
}
test('map tabs are custom, official, other with no all tab or missing count target', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const tabs = html.slice(html.indexOf('id="mapFilters"'), html.indexOf('<div class="maps-layout"'));
  assert.deepEqual([...tabs.matchAll(/data-filter="([^"]+)"/g)].map(match => match[1]), ['custom', 'official', 'other']);
  assert.doesNotMatch(tabs, /allMapCount/); assert.doesNotMatch(app, /\$\('#allMapCount'\)/);
});
test('each map filter survives reload and matches highlighted tab and rendered data', () => {
  for (const filter of ['custom', 'official', 'other']) {
    const first = filterFixture(); first.context.setMapFilter(filter);
    const reload = filterFixture(first.saved());
    assert.equal(reload.context.mapFilter, filter);
    assert.deepEqual(reload.buttons.filter(button => button.classList.active).map(button => button.dataset.filter), [filter]);
    assert.equal(reload.buttons.find(button => button.dataset.filter === filter)['aria-pressed'], 'true');
    assert.equal(reload.context.filteredCampaigns().length, 1);
    assert.equal(reload.context.filteredCampaigns()[0].type, filter);
  }
});
test('new sessions, removed all filter and invalid storage default to custom safely', () => {
  for (const value of [null, 'all', 'missing', '__proto__']) assert.equal(filterFixture(value).context.mapFilter, 'custom');
  const f = filterFixture('official', true); assert.equal(f.context.mapFilter, 'custom');
  f.context.setMapFilter('official'); assert.equal(f.context.mapFilter, 'official');
  f.context.setMapFilter('all'); assert.equal(f.context.mapFilter, 'custom');
});

function contentSearchFixture(respond = async () => ({ items: [], hasMore: false })) {
  const nodes = new Map(), requests = [];
  const element = selector => {
    if (!nodes.has(selector)) nodes.set(selector, { value: '', textContent: '', innerHTML: '', disabled: false, childNodes: [{}], classList: { toggle() {} }, setAttribute() {} });
    return nodes.get(selector);
  };
  const buttons = ['steam-workshop', 'gamemaps'].map(source => ({ dataset: { source }, classList: { toggle(name, active) { this.active = active; } }, setAttribute(name, value) { this[name] = value; } }));
  const context = vm.createContext({
    $: element, $$: selector => selector === '#contentSources button' ? buttons : [], AbortController,
    contentSource: 'steam-workshop', contentSection: 'maps', workshopPage: 1, workshopQuery: '', workshopResults: [], workshopSearched: false,
    searchVersion: 0, searchController: null, hasMoreResults: false, downloadJobs: [], pluginStoreLoaded: true, pluginStoreBusy: false,
    escapeHtml: value => String(value ?? ''), icons() {}, renderDownloads() {}, renderWorkshop() {}, searchPluginStore() {},
    api(url, options) { requests.push({ url, signal: options.signal }); return respond(url, options); }
  });
  for (const [start, end] of [
    ['function renderWorkshopResults()', 'function renderPluginStoreResults()'],
    ['async function searchWorkshop(', 'const bytesLabel ='],
    ['function selectContentSource(', 'async function loadDownloads()'],
    ["$('#workshopSearch').oninput", "$('#pluginStoreResults').onclick"]
  ]) vm.runInContext(app.slice(app.indexOf(start), app.indexOf(end, app.indexOf(start))), context);
  return { context, element, buttons, requests };
}

test('source tabs reset to idle without searching and preserve the typed query', () => {
  const f = contentSearchFixture();
  f.element('#workshopSearch').value = 'city map';
  Object.assign(f.context, { workshopPage: 5, workshopResults: [{ id: 'old' }], hasMoreResults: true, workshopSearched: true });
  for (const source of ['gamemaps', 'steam-workshop']) {
    f.element('#contentSources').onclick({ target: { closest: () => f.buttons.find(button => button.dataset.source === source) } });
    assert.equal(f.requests.length, 0);
    assert.equal(f.context.workshopPage, 1);
    assert.equal(f.context.workshopResults.length, 0);
    assert.equal(f.element('#workshopSearch').value, 'city map');
    assert.equal(f.element('#workshopResultMeta').textContent, '尚未搜索');
    assert.match(f.element('#workshopResults').innerHTML, /点击“搜索”/);
    assert.equal(f.element('#workshopNext').disabled, true);
    assert.equal(f.element('#workshopPrev').disabled, true);
    assert.equal(f.buttons.find(button => button.dataset.source === source)['aria-selected'], 'true');
  }
});

test('typing and returning to map downloads never start a provider search', () => {
  const f = contentSearchFixture();
  f.element('#workshopSearch').value = 'campaign';
  f.element('#workshopSearch').oninput();
  f.context.selectContentSection('plugins'); f.context.selectContentSection('maps');
  assert.equal(f.requests.length, 0);
});

test('explicit search uses the selected source and pagination keeps the submitted query', async () => {
  const f = contentSearchFixture(async () => ({ items: [{ id: '123', title: 'Campaign' }], hasMore: true }));
  f.context.selectContentSource('gamemaps', 'city map');
  await f.element('#searchWorkshop').onclick();
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].url, '/api/gamemaps?query=city%20map&page=1');
  assert.match(f.element('#workshopResults').innerHTML, /Campaign/);
  f.element('#workshopSearch').value = 'unsubmitted edit';
  f.element('#workshopNext').onclick();
  await Promise.resolve();
  assert.equal(f.requests[1].url, '/api/gamemaps?query=city%20map&page=2');
});

test('Enter, search shortcuts and browse all remain explicit search actions', async () => {
  const f = contentSearchFixture();
  f.element('#workshopSearch').value = 'survival';
  f.element('#workshopSearch').onkeydown({ key: 'Enter' }); await Promise.resolve();
  f.element('#workshopGrid').onclick({ target: { closest: () => ({ dataset: { workshop: 'campaign map' } }) } }); await Promise.resolve();
  await f.element('#openWorkshop').onclick();
  assert.deepEqual(f.requests.map(request => request.url), ['/api/workshop?query=survival&page=1', '/api/workshop?query=campaign%20map&page=1', '/api/workshop?query=&page=1']);
});

test('switching sources aborts pending requests and ignores their late results', async () => {
  const pending = [];
  const f = contentSearchFixture(() => new Promise(resolve => pending.push(resolve)));
  const first = f.context.searchWorkshop('first');
  f.context.selectContentSource('gamemaps');
  assert.equal(f.requests[0].signal.aborted, true);
  assert.equal(f.element('#searchWorkshop').disabled, false);
  assert.equal(f.requests.length, 1);
  const second = f.context.searchWorkshop('second');
  pending[0]({ items: [{ id: 'old', title: 'Old source' }], hasMore: true }); await first;
  assert.equal(f.context.workshopResults.length, 0);
  assert.equal(f.element('#searchWorkshop').disabled, true);
  assert.match(f.element('#workshopResultMeta').textContent, /正在搜索 GameMaps/);
  pending[1]({ items: [{ id: 'new', title: 'New source' }], hasMore: false }); await second;
  assert.equal(f.context.workshopResults[0].id, 'new');
  assert.equal(f.element('#searchWorkshop').disabled, false);
});

test('late failures cannot overwrite the idle state after a source switch', async () => {
  let reject;
  const f = contentSearchFixture(() => new Promise((resolve, fail) => { reject = fail; }));
  const first = f.context.searchWorkshop('first'); f.context.selectContentSource('gamemaps');
  reject(Error('Old source failed')); await first;
  assert.equal(f.element('#workshopResultMeta').textContent, '尚未搜索');
  assert.doesNotMatch(f.element('#workshopResults').innerHTML, /Old source failed/);
});

test('explicit Steam recovery still searches, and an empty search is not shown as idle', async () => {
  const f = contentSearchFixture();
  f.context.selectContentSource('gamemaps', 'campaign');
  await f.element('#workshopResults').onclick({ target: { closest: selector => selector === '[data-search-steam]' ? {} : null } });
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].url, '/api/workshop?query=campaign&page=1');
  assert.equal(f.element('#workshopResultMeta').textContent, '没有匹配项目');
  assert.match(f.element('#workshopResults').innerHTML, /请更换关键词/);
});

test('download and plugin introductions include their requested notices', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(html.includes('<p>分开查找地图和 SourceMod 插件，下载任务统一显示。</p><p>内容下载需要在代理管理中开启魔法功能。</p>'));
  assert.ok(html.includes('<p>按功能查找服务器实际安装的 SourceMod 插件。</p><p>插件可能因插件平台版本差异而不可用。</p>'));
});
