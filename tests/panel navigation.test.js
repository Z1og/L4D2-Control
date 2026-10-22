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
