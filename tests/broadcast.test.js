const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { createBroadcast, cleanEntry, sourceLink } = require('../broadcast manager');
const { normalizeMaps, parseGuides, createBroadcastSource, monthAgo, campaignEvidence, chineseSummaries } = require('../broadcast sources');
const at = Date.parse('2026-10-26T08:00:00Z');
async function temp(t) { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'Radio test ')); t.after(() => fs.rm(dir, { recursive: true, force: true })); return dir; }
const entry = { kind: 'qa', title: '紫黑贴图怎么解决？', content: '核对地图版本\n检查依赖', tags: ['地图故障'], map: 'Urban Flight' };

test('radio data survives restarts, serialized edits and confirmed deletion without any network reads', async t => {
  const directory = await temp(t); let calls = 0;
  const make = () => createBroadcast({ directory, now: () => at, collect: async () => { calls++; return { items: [] }; } });
  const manager = make(), baseline = await manager.snapshot(); assert.equal(baseline.entries.length, 14); assert.equal(calls, 0);
  await Promise.all(Array.from({ length: 5 }, (_, i) => manager.save({ ...entry, title: '问题 ' + i })));
  let snapshot = await make().snapshot(); assert.equal(snapshot.entries.length, 19); assert.equal(calls, 0);
  const saved = snapshot.entries.find(x => x.title === '问题 0');
  await manager.save({ ...saved, content: '已解决', verifiedAt: '2026-10-26', pinned: true });
  assert.equal((await make().snapshot()).entries.find(x => x.id === saved.id).content, '已解决');
  await assert.rejects(() => manager.remove({ id: saved.id, confirmed: false }), e => e.status === 400);
  await manager.remove({ id: saved.id, confirmed: true });
  assert.ok(!(await make().snapshot()).entries.some(x => x.id === saved.id));
});
test('source URLs reject executable schemes and credentials; plain text content remains literal', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,test', 'http://example.com', 'https://secret:token@example.com', 'https://127.0.0.1/a']) assert.throws(() => sourceLink(url), e => e.status === 400);
  assert.equal(sourceLink('https://www.bilibili.com/video/BV123?utm_source=chatgpt.com&p=2'), 'https://www.bilibili.com/video/BV123?p=2');
  assert.equal(cleanEntry({ ...entry, content: '<img src=x onerror=alert(1)>' }).content, '<img src=x onerror=alert(1)>');
  for (const changes of [{ kind: 'unknown' }, { title: '' }, { tags: ['x'.repeat(31)] }, { verifiedAt: '2026-02-30' }, { verifiedAt: '2026-99-99' }, { content: '', url: '' }, { title: {} }]) assert.throws(() => cleanEntry({ ...entry, ...changes }), e => e.status === 400);
});
test('a failed refresh preserves cached data and reports the real error; reads never refresh', async t => {
  let broken = false, calls = 0;
  const manager = createBroadcast({ directory: await temp(t), now: () => at, collect: async () => { calls++; if (broken) throw Error('upstream unavailable'); return { items: [{ id: 'guide-123', title: '中文指南' }], scope: 'fixture' }; } });
  await manager.refresh('guides'); broken = true;
  await assert.rejects(() => manager.refresh('guides'), e => e.status === 502 && e.message === 'upstream unavailable');
  const snapshot = await manager.snapshot(); assert.equal(snapshot.feeds.guides.items.length, 1); assert.equal(snapshot.feeds.guides.error, 'upstream unavailable'); assert.equal(calls, 2);
  await manager.remove({ id: 'guide-123', confirmed: true }); assert.equal((await manager.snapshot()).feeds.guides.items.length, 0);
  broken = false; await manager.refresh('guides'); assert.equal((await manager.snapshot()).feeds.guides.items.length, 0);
});
test('duplicate refresh clicks share one collector; edits during refresh are retained', async t => {
  let resolve, calls = 0;
  const manager = createBroadcast({ directory: await temp(t), collect: () => { calls++; return new Promise(r => { resolve = r; }); } });
  const first = manager.refresh('guides'), second = manager.refresh('guides');
  assert.equal((await manager.snapshot()).feeds.guides.refreshing, true);
  await manager.save(entry); resolve({ items: [] }); await Promise.all([first, second]);
  const data = await manager.snapshot(); assert.equal(calls, 1); assert.ok(data.entries.some(x => x.title === entry.title)); assert.equal(data.feeds.guides.refreshing, false);
});
test('corrupt private data is reported rather than overwritten with defaults', async t => {
  const directory = await temp(t), file = path.join(directory, 'broadcast.json'); await fs.writeFile(file, 'broken json');
  const manager = createBroadcast({ directory }); await assert.rejects(() => manager.save(entry), SyntaxError); assert.equal(await fs.readFile(file, 'utf8'), 'broken json');
});
test('recent maps use calendar month boundaries, campaign tags and actual app identity', () => {
  assert.equal(new Date(monthAgo(Date.parse('2026-03-31T12:00:00Z'))).toISOString(), '2026-02-28T12:00:00.000Z');
  const candidates = ['1', '2', '3', '4', '5', '6'].map(id => ({ id, title: '地图 ' + id }));
  const detail = id => ({ publishedfileid: id, result: 1, consumer_app_id: 550, time_created: (at - 5 * 86400000) / 1000, time_updated: (at - 86400000) / 1000, tags: [{ tag: 'Campaigns' }], description: '[b]说明[/b]' });
  const details = [detail('1'), { ...detail('2'), tags: [{ tag: 'Weapons' }] }, { ...detail('3'), time_updated: (monthAgo(at) - 1000) / 1000 }, { ...detail('4'), consumer_app_id: 999 }, { ...detail('5'), time_updated: (at + 86400000) / 1000 }, { ...detail('6'), time_created: (at - 200 * 86400000) / 1000 }];
  const maps = normalizeMaps(candidates, details, at); assert.deepEqual(maps.map(x => x.workshopId), ['1', '6']); assert.equal(maps[0].isNew, true); assert.equal(maps[1].isNew, false); assert.equal(maps[0].summary, '说明');
});
test('expired maps disappear from stored cache without initiating a new collection', async t => {
  let clock = at;
  const manager = createBroadcast({ directory: await temp(t), now: () => clock, collect: async () => ({ items: [{ id: 'steam-1', updatedAt: new Date(at).toISOString() }] }) });
  await manager.refresh('maps'); assert.equal((await manager.snapshot()).feeds.maps.items.length, 1);
  clock += 40 * 86400000; assert.equal((await manager.snapshot()).feeds.maps.items.length, 0);
});
test('Campaigns-tagged scripts, music and character mods stay out of recent maps; mixed campaign packages retain evidence', () => {
  const item = (title, description, extraTags, file_size = 500000000) => ({ title, description, file_size, tags: ['Campaigns', ...extraTags].map(tag => ({ tag })) });
  for (const fixture of [item('更多生还者AI功能', 'Advanced Bot AI custom features', ['Scripts'], 100000), item('Memories', 'A safe-room theme for The Passing', ['Scripts', 'Sounds']), item('Nightmare Aesthetics', 'The main mod defining the look of the world of L4D', ['Miscellaneous', 'Models']), item('Character skin', 'A new look for Nick', ['Nick'])]) assert.equal(campaignEvidence(fixture), '');
  // Real upstream entries whose sole Campaigns tag previously bypassed screening.
  assert.equal(campaignEvidence(item('DJ TAPIA (TANK)', 'Sonia Sonia Bola de Cebo con patas', [])), '');
  assert.equal(campaignEvidence(item('[Fix / Parche] Insurgencia - Textures and Lighting Fix (No More White Props)', 'Parche de Texturas, Iluminacion y Scripts para Insurgencia. Fix completo para la campana de Left 4 Dead 2', [])), '');
  assert.equal(campaignEvidence(item('Unknown add-on', 'Campaign content', [])), '');
  assert.ok(campaignEvidence(item('Archive:Zero part1', 'Fixed tanks from M1 to M5 have been reduced.', ['Scripts', 'Sounds', 'Models'])));
  assert.ok(campaignEvidence(item('NOT SO SPIRAL', 'A chaotic 7-map campaign built from a blank grid.', ['Other', 'Textures', 'Sounds'])));
  assert.ok(campaignEvidence(item('Reverse Dead Air', 'The campaign in reverse. bsp names: r_c11m5_runway', ['Co-op', 'Versus', 'Single Player'])));
  assert.ok(campaignEvidence(item('上海外滩', '三章节战役', [])));
  assert.equal(campaignEvidence(item('Map names list', 'bsp names: c1m1', [], 100000)), '');
});
test('uncertain items remain in the admin review queue until curated or dismissed', async t => {
  const pending = { id: 'steam-55', title: '待确认地图', kind: 'candidate', updatedAt: new Date(at).toISOString(), url: 'https://steamcommunity.com/sharedfiles/filedetails/?id=55' };
  const manager = createBroadcast({ directory: await temp(t), now: () => at, collect: async () => ({ items: [], reviewItems: [pending] }) });
  await manager.refresh('maps'); assert.equal((await manager.snapshot()).feeds.maps.reviewItems.length, 1);
  await manager.save({ ...entry, kind: 'classic', url: pending.url }); assert.equal((await manager.snapshot()).feeds.maps.reviewItems.length, 0);
  const id = (await manager.snapshot()).entries.find(x => x.url === pending.url).id;
  await manager.remove({ id, confirmed: true }); assert.equal((await manager.snapshot()).feeds.maps.reviewItems.length, 1);
  await manager.remove({ id: pending.id, confirmed: true }); await manager.refresh('maps'); assert.equal((await manager.snapshot()).feeds.maps.reviewItems.length, 0);
});
const guideHtml = (id, title = '中文通关攻略') => `<a class="workshopItemCollection" data-appid="550" data-publishedfileid="${id}"><span class="guide"></span><div class="workshopItemTitle">${title}</div><span class="workshopItemAuthorName">作者 &amp; 同伴</span><div class="workshopItemShortDesc">路线与补给</div></a>`;
test('guide parser scopes title and attribution to each guide and rejects other apps', () => {
  const data = parseGuides(guideHtml('12') + guideHtml('12') + guideHtml('13', '另一个攻略') + guideHtml('14').replace('appid="550"', 'appid="999"'));
  assert.equal(data.length, 2); assert.equal(data[0].author, '作者 & 同伴'); assert.equal(data[1].title, '另一个攻略'); assert.match(data[0].url, /id=12$/);
});
test('source collector bounds scanning and verifies maps against batch metadata', async () => {
  const calls = [];
  const collect = createBroadcastSource('', { now: () => at, request: async (url, body) => {
    calls.push({ url, body });
    if (url.includes('/guides/')) return guideHtml('45');
    if (url.includes('/browse/')) return '<a href="https://steamcommunity.com/sharedfiles/filedetails/?id=99"><img alt="战役标题" src="https://example.com/a.jpg"></a>';
    return JSON.stringify({ response: { publishedfiledetails: [{ publishedfileid: '99', result: 1, consumer_app_id: 550, time_updated: at / 1000, time_created: at / 1000, description: 'A 4-map campaign.', file_size: 500000000, tags: [{ tag: 'Campaigns' }] }] } });
  } });
  assert.equal((await collect('guides')).items[0].title, '中文通关攻略');
  const data = await collect('maps'); assert.equal(data.items.length, 1); assert.equal(data.scanned, 1); assert.match(calls[2].body, /publishedfileids%5B0%5D=99/);
  await assert.rejects(() => collect('other'), /未知/);
});

test('foreign summaries are translated in batches, cached by original text and remain inspectable',async()=>{
 let calls=0;const request=async(url,body,options)=>{calls++;assert.match(url,/edge\.microsoft\.com/);assert.equal(options.json,true);return JSON.stringify(JSON.parse(body).map(text=>({translations:[{text:'中文译文：'+text}]})));};
 const source=[{id:'1',summary:'A campaign in a deserted city.'},{id:'2',summary:'三章节地图，前往楼顶寻找救援。'}];
 const first=await chineseSummaries({items:structuredClone(source)},request);assert.equal(calls,1);assert.equal(first.items[0].summaryOriginal,source[0].summary);assert.match(first.items[0].summary,/中文译文/);assert.equal(first.items[1].summaryOriginal,undefined);
 const again=await chineseSummaries({items:structuredClone(source)},request,first);assert.equal(calls,1);assert.equal(again.items[0].summary,first.items[0].summary);
 const updated=await chineseSummaries({items:[{id:'1',summary:'An updated campaign in the city.'}]},request,first);assert.equal(calls,2);assert.match(updated.items[0].summaryOriginal,/updated/);
});
test('translation failure preserves source content and surfaces an explicit error',async()=>{
 const result=await chineseSummaries({items:[{id:'1',summary:'Original campaign description'}]},async()=>{throw Error('upstream 429');});
 assert.equal(result.items[0].summary,'Original campaign description');assert.match(result.translationError,/upstream 429/);assert.equal(result.items[0].summaryOriginal,undefined);
});

test('bilingual summaries explicitly translate English while keeping the Chinese source inspectable',async()=>{
 const text='三章节地图，地图大更新。A three-chapter map with a major update.';
 const result=await chineseSummaries({items:[{id:'mixed',summary:text}]},async(url)=>{assert.match(url,/from=en/);return JSON.stringify([{translations:[{text:'三章节地图，地图大更新。包含重大更新的三章地图。'}]}]);});
 assert.equal(result.items[0].summaryOriginal,text);assert.ok(!result.items[0].summary.includes('three-chapter'));
});
