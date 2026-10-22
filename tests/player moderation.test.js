const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createModeration, BAN_DAYS } = require('../player moderation');
const { steamIdentity, parseKeyValues } = require('../player manager');
function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'l4d2 moderation ')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let clock = Date.UTC(2026, 9, 23), syncs = 0;
  const players = [1, 2, 3].map(n => ({ ...steamIdentity(`[U:1:${n}]`), name: n === 1 ? '名字 "引号" \\ 中文' : 'Player ' + n, userId: n + 10, online: n !== 3 }));
  const kicks = [], file = path.join(root, 'left4dead2/addons/sourcemod/data/l4d2 control/bans.txt');
  const config = { serverRoot: root, now: () => clock, playerManager: { list: async () => ({ available: !options.stale, moderationAvailable: !options.oldPlugin, players }) }, syncBans: async revision => { syncs++; assert.equal(parseKeyValues(fs.readFileSync(file, 'utf8')).PanelBans.revision, revision); if (options.failSync && syncs === options.failSync) throw Error('fixture sync failed'); }, kickPlayer: async (id, userId) => { if (options.failKick === id) throw Error('identity changed'); kicks.push({ id, userId }); } };
  return { manager: createModeration(config), recreate: () => createModeration(config), players, file, kicks, advance: ms => { clock += ms; }, now: () => clock };
}
const request = (action, ids, days = 1) => ({ action, steamIds: ids, days, confirmed: true });
test('all six ban durations persist across manager restarts and expire automatically', async t => {
  const f = fixture(t), id = f.players[0].steam64;
  for (const days of BAN_DAYS) {
    const result = await f.manager.act(request('ban', [id], days)); assert.equal(result.succeeded, 1);
    const [ban] = await f.recreate().list(); assert.equal(ban.expiresAt, f.now() + days * 86400000); assert.equal(ban.name, f.players[0].name);
    f.advance(days * 86400000); assert.equal((await f.manager.list()).length, 0);
  }
});
test('offline history can be banned; duration resets from now and unban removes only selected identity', async t => {
  const f = fixture(t), ids = f.players.map(p => p.steam64);
  await f.manager.act(request('ban', ids, 30)); f.advance(86400000);
  await f.manager.act(request('duration', [ids[2]], 3));
  assert.equal((await f.manager.list()).find(p => p.steam64 === ids[2]).expiresAt, f.now() + 3 * 86400000);
  await f.manager.act(request('unban', [ids[0]])); assert.deepEqual(new Set((await f.manager.list()).map(p => p.steam64)), new Set(ids.slice(1)));
});
test('kick processes each current Steam identity and reports offline and changed identities separately', async t => {
  const f = fixture(t, { failKick: steamIdentity('[U:1:2]').steam64 });
  const result = await f.manager.act(request('kick', f.players.map(p => p.steam64)));
  assert.equal(result.succeeded, 1); assert.equal(result.failed, 2); assert.deepEqual(f.kicks, [{ id: f.players[0].steam64, userId: 11 }]); assert.equal((await f.manager.list()).length, 0);
});
test('kick-ban persists selected identities once and handles duplicate IDs without duplicate actions', async t => {
  const f = fixture(t), id = f.players[0];
  const result = await f.manager.act(request('kick-ban', [id.steam2, id.steam64], 180)); assert.equal(result.results.length, 1); assert.equal((await f.manager.list()).length, 1);
});
test('invalid identities, unsupported durations and missing confirmation never touch ban state', async t => {
  const f = fixture(t), id = f.players[0].steam64;
  for (const payload of [{ ...request('ban', [id]), confirmed: false }, request('ban', [id], 0), request('ban', [id], '1'), request('ban', ['STEAM_1:1:1\nquit']), request('ban', []), request('ban', Array(101).fill(id)), request('ban', ['76561197960265799']), request('unknown', [id])]) await assert.rejects(() => f.manager.act(payload));
  assert.equal(fs.existsSync(f.file), false);
});
test('stale snapshots and old bridge versions prevent destructive operations', async t => {
  for (const options of [{ stale: true }, { oldPlugin: true }]) { const f = fixture(t, options); await assert.rejects(() => f.manager.act(request('kick', [f.players[0].steam64])), /未就绪/); assert.equal(f.kicks.length, 0); }
});
test('failed synchronization restores prior bans and confirms restored runtime state', async t => {
  const f = fixture(t, { failSync: 2 }), [a,b] = f.players;
  await f.manager.act(request('ban', [a.steam64], 7)); const before = await f.manager.list();
  await assert.rejects(() => f.manager.act(request('ban', [b.steam64], 30)), /已恢复原黑名单/); assert.deepEqual(await f.manager.list(), before);
});
test('concurrent edits retain all identities and malformed files are preserved', async t => {
  const f = fixture(t); await Promise.all(f.players.map(p => f.manager.act(request('ban', [p.steam64])))); assert.equal((await f.manager.list()).length, 3);
  fs.writeFileSync(f.file, 'broken {'); await assert.rejects(() => f.manager.act(request('unban', [f.players[0].steam64]))); assert.equal(fs.readFileSync(f.file, 'utf8'), 'broken {');
});
