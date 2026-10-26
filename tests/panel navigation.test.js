const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const code = app.slice(app.indexOf('const panelViews ='), app.indexOf('async function api('));
function fixture(hash = '', saved = null, blocked = false, guest = false) {
  const views = ['overview', 'gameplay', 'maps', 'plugins', 'diagnostics', 'workshop', 'proxy', 'players', 'broadcast', 'settings', 'about'];
  const events = {}, calls = [];
  const nodes = views.map(view => ({ id: view + 'View', dataset: { view }, classList: { toggle() {} }, setAttribute() {}, removeAttribute() {} }));
  const title = {}, location = { hash };
  const context = vm.createContext({ isGuest: guest, location, history: { replaceState(a, b, value) { if (blocked) throw Error('Denied'); location.hash = value; } },
    sessionStorage: { getItem() { if (blocked) throw Error('Denied'); return saved; }, setItem(key, value) { if (blocked) throw Error('Denied'); saved = value; } },
    document: { addEventListener(name, fn) { events[name] = fn; } }, window: { addEventListener(name, fn) { events[name] = fn; } },
    $: () => title, $$: () => nodes, icons() {}, loadGameplay() { calls.push('gameplay'); }, loadProxy() { calls.push('proxy'); }, loadPlayers() { calls.push('players'); },
    contentSection: 'maps', selectContentSection(section) { context.contentSection = section; calls.push('select:' + section); },
    loadDownloads() { calls.push('workshop'); }, loadCloudBackup() { calls.push('diagnostics'); }, startCloudPolling() {}, stopCloudPolling() {}
  });
  vm.runInContext(code, context); return { context, events, location, title, calls, saved: () => saved };
}
test('all panel sections restore on reload, after dependent scripts are initialized', () => {
  for (const view of ['overview', 'gameplay', 'maps', 'plugins', 'diagnostics', 'workshop', 'proxy', 'players', 'broadcast', 'settings', 'about']) {
    const expected = view === 'proxy' ? 'workshop' : view;
    const first = fixture(); first.context.navigate(view); assert.equal(first.location.hash, '#' + expected);
    const second = fixture(first.location.hash, first.saved()); assert.equal(second.calls.length, 0);
    second.events.DOMContentLoaded(); assert.equal(second.location.hash, '#' + expected); assert.equal(second.saved(), expected);
    assert.ok(second.title.textContent); if (view === 'players') assert.deepEqual(second.calls, ['players']);
  }
});
test('hash navigation, storage fallback and invalid or blocked storage are safe', () => {
  const f = fixture('', 'maps'); f.events.DOMContentLoaded(); assert.equal(f.location.hash, '#maps');
  f.location.hash = '#plugins'; f.events.hashchange(); assert.equal(f.saved(), 'plugins');
  for (const hash of ['#unknown', '#__proto__', '#constructor', '#%invalid']) {
    const bad = fixture(hash, 'maps'); bad.events.DOMContentLoaded(); assert.equal(bad.location.hash, '#overview');
  }
  const blocked = fixture('#players', null, true); blocked.events.DOMContentLoaded(); assert.equal(blocked.title.textContent, '玩家管理');
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
    searchVersion: 0, searchController: null, hasMoreResults: false, downloadJobs: [], pluginStoreLoaded: true, pluginStoreBusy: false, proxyLoads: 0,
    escapeHtml: value => String(value ?? ''), icons() {}, renderDownloads() {}, renderWorkshop() {}, searchPluginStore() {}, loadProxy() { context.proxyLoads++; },
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
    assert.doesNotMatch(f.element('#workshopResults').innerHTML, /切换来源不会自动搜索/);
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

test('legacy activity URLs and storage migrate to settings without losing the new About route',()=>{
 for(const f of [fixture('#logs'),fixture('', 'logs')]){f.events.DOMContentLoaded();assert.equal(f.location.hash,'#settings');assert.equal(f.saved(),'settings');}
 const about=fixture('#about');about.context.isGuest=true;about.events.DOMContentLoaded();assert.equal(about.location.hash,'#about');
 const denied=fixture('#settings');denied.context.isGuest=true;denied.events.DOMContentLoaded();assert.equal(denied.location.hash,'#overview');
});

test('the player section is named Player Management and exposes the persistent whitelist controls', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /data-admin-only data-view="players"><i data-lucide="users"><\/i>玩家管理/);
  assert.match(html, /id="playersView"[\s\S]*?<h1>玩家管理<\/h1>/);
  assert.match(html, /<span>玩家管理<\/span><i data-lucide="users"><\/i>[\s\S]*?id="overviewPlayerCount"/);
  assert.match(html, /id="playerWhitelistEnabled"/);
  assert.match(html, /id="playerWhitelistIdentity"[^>]+placeholder="SteamID64 \/ SteamID2 \/ steamcommunity\.com\/id\/…"/);
  assert.match(html, /名单可在关闭准入限制时维护/);
  assert.doesNotMatch(html, /切换来源不会自动搜索/);
});


test('legacy proxy navigation opens the content-download parent and loads proxy only once', () => {
  const f = fixture('#proxy'); f.events.DOMContentLoaded();
  assert.equal(f.location.hash, '#workshop'); assert.equal(f.saved(), 'workshop');
  assert.equal(f.title.textContent, '内容下载'); assert.equal(f.context.contentSection, 'proxy');
  assert.deepEqual(f.calls, ['select:proxy', 'proxy']);
});
test('proxy joins map and plugin downloads and hides provider searches and download task panel', () => {
  const f = contentSearchFixture(); const states = new Map();
  for (const id of ['#mapDownloadSection','#pluginStoreSection','#proxyView','#contentDownloadTasks','#openWorkshop']) {
    f.element(id).classList.toggle = (name, hidden) => { states.set(id, hidden); };
  }
  f.context.selectContentSection('proxy');
  assert.equal(f.context.contentSection, 'proxy'); assert.equal(f.context.proxyLoads, 1);
  assert.equal(states.get('#mapDownloadSection'), true); assert.equal(states.get('#pluginStoreSection'), true);
  assert.equal(states.get('#proxyView'), false); assert.equal(states.get('#contentDownloadTasks'), true); assert.equal(states.get('#openWorkshop'), true);
  assert.equal(f.requests.length, 0);
  f.context.selectContentSection('maps'); assert.equal(states.get('#proxyView'), true); assert.equal(states.get('#contentDownloadTasks'), false);
  f.context.selectContentSection('proxy', true); assert.equal(f.context.proxyLoads, 1);
  f.context.selectContentSection('invalid'); assert.equal(f.context.contentSection, 'proxy');
});
test('proxy is nested inside content downloads with one shared sidebar entry and refresh persistence', () => {
  const cheerio = require('cheerio'), html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8'), $ = cheerio.load(html);
  assert.equal($('.nav-item[data-view="proxy"]').length, 0); assert.equal($('.nav-item[data-view="workshop"]').length, 1);
  assert.deepEqual($('#contentSections [data-content-section]').map((i,el) => $(el).attr('data-content-section')).get(), ['maps','plugins','proxy']);
  assert.equal($('#workshopView #proxyView').length, 1); assert.equal($('#proxyView.content').length, 0);
  assert.equal($('#proxyView').attr('role'), 'tabpanel'); assert.equal($('#contentProxyTab').attr('aria-controls'), 'proxyView');
  assert.equal($('#proxyLinks').length, 1); assert.equal($('#proxyList').length, 1);
  assert.ok(app.includes("!['maps','plugins','proxy'].includes(saved.section)"));
});

test('reloading content downloads restores the proxy tab without searching providers', () => {
  const f = contentSearchFixture();
  Object.assign(f.context, { isGuest: false, window: { panelState: { get: () => ({ source:'gamemaps', section:'proxy', page:1, pluginPage:1, query:'city', searched:false, items:[], pluginItems:[] }) } }, renderPluginStoreResults() {} });
  vm.runInContext(app.slice(app.indexOf('function restoreBrowseState()'), app.indexOf("window.addEventListener('pagehide',rememberBrowseState)")), f.context);
  f.context.restoreBrowseState();
  assert.equal(f.context.contentSection, 'proxy'); assert.equal(f.context.contentSource, 'gamemaps');
  assert.equal(f.context.proxyLoads, 0); assert.equal(f.requests.length, 0);
});

test('ordinary navigation restores gameplay and broadcast while management routes stay blocked',()=>{
 for(const view of ['gameplay','broadcast']){const f=fixture('#'+view,null,false,true);f.events.DOMContentLoaded();assert.equal(f.location.hash,'#'+view);}
 for(const view of ['players','settings','diagnostics','workshop']){const f=fixture('#'+view,null,false,true);f.events.DOMContentLoaded();assert.equal(f.location.hash,'#overview');}
});
