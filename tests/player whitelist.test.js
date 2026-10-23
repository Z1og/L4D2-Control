const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createWhitelist, profileIdentity, INITIAL_REVISION } = require('../player whitelist');
const { steamIdentity, parseKeyValues } = require('../player manager');

function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'L4D2 whitelist test '));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let now = Date.UTC(2026, 9, 23), syncCount = 0;
  const admin = { ...steamIdentity('[U:1:111]'), name: 'Test admin', flags: 'b', permissionSource: 'panel', online: false };
  const guest = { ...steamIdentity('[U:1:222]'), name: 'Test guest', flags: '', permissionSource: 'none', online: false };
  const playerManager = { list: async () => ({ available: options.available !== false, whitelistAvailable: options.whitelistAvailable !== false, players: [admin, guest] }) };
  const file = path.join(root, 'left4dead2', 'addons', 'sourcemod', 'data', 'l4d2 control', 'whitelist.txt');
  const manager = createWhitelist({ serverRoot: root, playerManager, now: () => now,
    fetchImpl: options.fetchImpl,
    syncWhitelist: async revision => {
      syncCount++;
      const parsed = parseKeyValues(fs.readFileSync(file, 'utf8')).PanelWhitelist;
      assert.equal(parsed.revision, revision);
      if (options.failSyncAt === syncCount) throw new Error('plugin did not acknowledge');
    }
  });
  return { manager, root, file, admin, guest, advance: ms => { now += ms; }, get syncCount() { return syncCount; } };
}

test('Steam IDs and numeric/custom profile URLs normalize to exact SteamID64 values', async () => {
  const expected = steamIdentity('[U:1:234]');
  assert.deepEqual(await profileIdentity(expected.steam2), expected);
  assert.deepEqual(await profileIdentity(`https://steamcommunity.com/profiles/${expected.steam64}/`), expected);
  let requested;
  const custom = await profileIdentity('https://steamcommunity.com/id/friend_name/', async (url, options) => {
    requested = { url, options };
    return new Response(`<profile><steamID64>${expected.steam64}</steamID64></profile>`, { status: 200, headers: { 'content-type': 'application/xml' } });
  });
  assert.deepEqual(custom, expected);
  assert.equal(new URL(requested.url).origin, 'https://steamcommunity.com');
  assert.equal(requested.options.redirect, 'manual');
  for (const value of ['https://steamcommunity.com.evil.example/profiles/76561197960265962', 'https://steamcommunity.com/id/name?redirect=https://127.0.0.1', 'https://steamcommunity.com/id/../profiles/76561197960265962', 'steamcommunity.com/id/name']) await assert.rejects(profileIdentity(value, async () => { throw new Error('must not fetch'); }));
});

test('an untrusted redirect from custom profile resolution is rejected', async () => {
  const response = new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/private' } });
  await assert.rejects(profileIdentity('https://steamcommunity.com/id/friend', async () => response), /不支持的跳转/);
});

test('friends can be added while admission mode is off; enabling includes administrators and preserves records', async t => {
  const f = fixture(t);
  assert.deepEqual(await f.manager.read(), { original: null, revision: INITIAL_REVISION, enabled: false, players: [] });
  await f.manager.act({ action: 'add', identity: f.guest.steam64 });
  let state = await f.manager.list();
  assert.equal(state.enabled, false);
  assert.equal(state.players.find(player => player.steam64 === f.guest.steam64).source, 'manual');
  assert.equal(state.players.length, 1);

  await f.manager.act({ action: 'set-enabled', enabled: true, confirmed: true });
  state = await f.manager.list();
  assert.equal(state.enabled, true);
  assert.equal(state.players.find(player => player.steam64 === f.admin.steam64).source, 'admin');
  assert.equal(state.players.find(player => player.steam64 === f.guest.steam64).source, 'manual');

  await f.manager.act({ action: 'set-enabled', enabled: false, confirmed: true });
  const closed = await f.manager.list();
  assert.equal(closed.enabled, false);
  assert.deepEqual(new Set(closed.players.map(player => player.steam64)), new Set([f.admin.steam64, f.guest.steam64]));
  await f.manager.act({ action: 'set-enabled', enabled: true, confirmed: true });
  const reopened = await f.manager.list();
  assert.equal(reopened.enabled, true);
  assert.equal(reopened.players.length, 2);
});

test('manual add is idempotent; removal applies by identity and never clears mode', async t => {
  const f = fixture(t);
  await f.manager.act({ action: 'add', identity: `https://steamcommunity.com/profiles/${f.guest.steam64}` });
  const duplicate = await f.manager.act({ action: 'add', identity: f.guest.steam2 });
  assert.equal(duplicate.changed, false);
  assert.equal((await f.manager.list()).players.length, 1);
  await f.manager.act({ action: 'set-enabled', enabled: true, confirmed: true });
  await f.manager.act({ action: 'remove', steamId: f.guest.steam64 });
  const state = await f.manager.list();
  assert.equal(state.enabled, true);
  assert.ok(!state.players.some(player => player.steam64 === f.guest.steam64));
  await assert.rejects(f.manager.act({ action: 'remove', steamId: f.guest.steam64 }), /不在白名单/);
});

test('failed plugin sync restores previous bytes and reports the observed failure', async t => {
  const f = fixture(t, { failSyncAt: 2 });
  await f.manager.act({ action: 'add', identity: f.guest.steam64 });
  const before = fs.readFileSync(f.file, 'utf8');
  await assert.rejects(f.manager.act({ action: 'set-enabled', enabled: true, confirmed: true }), /已恢复原记录/);
  assert.equal(fs.readFileSync(f.file, 'utf8'), before);
  assert.equal((await f.manager.list()).enabled, false);
  assert.equal(f.syncCount, 3);
});

test('unavailable bridge and malformed persistent data cannot silently change the whitelist', async t => {
  const old = fixture(t, { whitelistAvailable: false });
  await assert.rejects(old.manager.act({ action: 'add', identity: old.guest.steam64 }), /插件未就绪/);
  assert.equal(fs.existsSync(old.file), false);
  const broken = fixture(t);
  fs.mkdirSync(path.dirname(broken.file), { recursive: true });
  fs.writeFileSync(broken.file, 'corrupt {');
  await assert.rejects(broken.manager.act({ action: 'set-enabled', enabled: true, confirmed: true }), /白名单格式无效/);
  assert.equal(fs.readFileSync(broken.file, 'utf8'), 'corrupt {');
});
