const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createPlayerManager, steamIdentity, parseKeyValues, flagsOf, splitManaged, simpleEntries, BEGIN, END } = require('../player manager');
const id = steamIdentity('STEAM_1:1:1');
function kv(value) { return Object.entries(value).map(([k,v]) => JSON.stringify(k) + (typeof v === 'object' ? '\n{\n' + kv(v) + '}\n' : ' ' + JSON.stringify(String(v)) + '\n')).join(''); }
function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'l4d2 players ')), base = path.join(root,'left4dead2','addons','sourcemod');
  fs.mkdirSync(path.join(base,'configs'),{recursive:true});fs.mkdirSync(path.join(base,'data','l4d2 control'),{recursive:true});
  const simple = path.join(base,'configs','admins_simple.ini');fs.writeFileSync(simple,'// existing administrator\n"STEAM_0:0:99" "99:z"\n');
  fs.writeFileSync(path.join(base,'configs','admins.cfg'),'"Admins"\n{\n}\n');
  const history = path.join(base,'data','l4d2 control','history.txt');fs.writeFileSync(history,kv({PanelPlayerHistory:{[id.steam2]:{name:'中文玩家 "名字"',firstSeen:100,lastSeen:200}}}));
  let liveFlags = options.flags || '', reloads = 0;
  const snapshotFile = path.join(base,'data','l4d2 control','players.txt');
  function snapshot(age = 0) { fs.writeFileSync(snapshotFile,kv({PanelPlayers:{version:1,moderationVersion:1,whitelistVersion:options.oldBridge?0:1,updated:Math.floor(Date.now()/1000)-age,bots:3,players:options.offline?{}:{'42':{...id,name:'中文玩家 "名字"',userid:42,team:2,ping:45,connected:120,flags:liveFlags,immunity:liveFlags?10:0}}}})); }
  snapshot();
  const manager = createPlayerManager({serverRoot:root,stateDir:path.join(root,'private state'),refreshSnapshot:options.refresh?()=>options.refresh(snapshot):undefined,reloadAdmins:async()=>{reloads++;if(options.failReload && reloads===1)throw new Error('mock reload failed');const text=fs.readFileSync(simple,'utf8');liveFlags=options.mismatch?'':simpleEntries(splitManaged(text).managed,true).get(id.steam64)?.flags||'';snapshot();}});
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  return {root,base,simple,manager,snapshot,get reloads(){return reloads;}};
}
test('SteamID2/3/64 conversion preserves every digit and rejects malformed identities',()=>{
  assert.deepEqual(steamIdentity('STEAM_0:1:1'),id);assert.deepEqual(steamIdentity('[U:1:3]'),id);assert.deepEqual(steamIdentity('76561197960265731'),id);
  assert.equal(steamIdentity('76561202255233023').steam2,'STEAM_1:1:2147483647');
  for(const value of ['BOT','STEAM_ID_PENDING','STEAM_1:0:0','STEAM_1:0:9999999999','STEAM_1:0:1\nsm_rcon','76561197960265728',76561197960265731])assert.throws(()=>steamIdentity(value));
});
test('KeyValues keeps SteamID64 strings, escaped names and prototype keys inert',()=>{
 const out=parseKeyValues(kv({Root:{steam64:'76561197960265731',name:'a"b\\c\n中文'}}));assert.equal(out.Root.steam64,'76561197960265731');assert.equal(out.Root.name,'a"b\\c\n中文');assert.equal(Object.getPrototypeOf(out),null);
 assert.throws(()=>parseKeyValues('"a" {'));assert.throws(()=>parseKeyValues('"a" "1" "a" "2"'));
 assert.equal(parseKeyValues('/* SourceMod default */ Admins { "fixture" { auth steam identity "STEAM_1:1:1" } }').Admins.fixture.auth,'steam');
});
test('live listing joins durable records, bots and external administrators',async t=>{
 const f=fixture(t),out=await f.manager.list();assert.equal(out.available,true);assert.equal(out.moderationAvailable,true);assert.equal(out.whitelistAvailable,true);assert.equal(out.onlineCount,1);assert.equal(out.bots,3);
 const p=out.players.find(p=>p.steam64===id.steam64);assert.equal(p.name,'中文玩家 "名字"');assert.equal(p.firstSeen,100000);assert.equal(p.readOnly,false);
 assert.equal(out.players.find(p=>p.steam2==='STEAM_1:0:99').readOnly,true);assert.equal(JSON.stringify(out).includes('127.0.0.1'),false);
});
test('older player bridge versions do not advertise whitelist enforcement',async t=>{const f=fixture(t,{oldBridge:true});const out=await f.manager.snapshot();assert.equal(out.available,true);assert.equal(out.whitelistAvailable,false);});
test('grant, persist, reload and revoke owned permissions without altering external bytes',async t=>{
 const f=fixture(t),original=fs.readFileSync(f.simple,'utf8');
 const grant=await f.manager.update({steamId:id.steam64,flags:'bfn',immunity:10});assert.equal(grant.runtimeConfirmed,true);assert.equal(f.reloads,1);
 assert.equal(splitManaged(fs.readFileSync(f.simple,'utf8')).before,original+'\n');assert.equal((await f.manager.list()).players.find(p=>p.steam64===id.steam64).managed,true);
 const revoke=await f.manager.update({steamId:id.steam64,flags:'',immunity:0});assert.equal(revoke.runtimeConfirmed,true);assert.equal(simpleEntries(splitManaged(fs.readFileSync(f.simple,'utf8')).managed,true).size,0);assert.equal((await f.manager.list()).audit.length,2);
});
test('root requires explicit confirmation and invalid flags cannot become commands',async t=>{
 const f=fixture(t),old=fs.readFileSync(f.simple);
 await assert.rejects(()=>f.manager.update({steamId:id.steam64,flags:'z',immunity:10}),/单独确认/);
 for(const flags of ['x','b;quit','Z','b\n'])assert.throws(()=>flagsOf(flags));
 await assert.rejects(()=>f.manager.update({steamId:id.steam64,flags:'b',immunity:1000}));assert.deepEqual(fs.readFileSync(f.simple),old);
});
test('external and other-plugin administrators remain read-only',async t=>{
 const f=fixture(t,{flags:'z'}),old=fs.readFileSync(f.simple);
 await assert.rejects(()=>f.manager.update({steamId:'STEAM_1:0:99',flags:'b',immunity:0}),/外部/);
 await assert.rejects(()=>f.manager.update({steamId:id.steam64,flags:'b',immunity:0}),/其他来源/);assert.deepEqual(fs.readFileSync(f.simple),old);
});
test('reload failure restores exact original config and reloads the restored version',async t=>{
 const f=fixture(t,{failReload:true}),old=fs.readFileSync(f.simple);
 await assert.rejects(()=>f.manager.update({steamId:id.steam64,flags:'bfn',immunity:10}),/已恢复/);assert.deepEqual(fs.readFileSync(f.simple),old);assert.equal(f.reloads,2);
});
test('runtime permission mismatch rolls back rather than claiming success',async t=>{
 const f=fixture(t,{mismatch:true}),old=fs.readFileSync(f.simple);await assert.rejects(()=>f.manager.update({steamId:id.steam64,flags:'bfn',immunity:10}),/已恢复/);assert.deepEqual(fs.readFileSync(f.simple),old);
});
test('stale snapshots show unknown online state and prevent permission writes',async t=>{
 const f=fixture(t);f.snapshot(30);const out=await f.manager.list();assert.equal(out.available,false);assert.equal(out.onlineCount,null);assert.ok(out.players.every(p=>!p.online));await assert.rejects(()=>f.manager.update({steamId:id.steam64,flags:'b',immunity:0}),/采集未运行/);
});
test('offline grants are persistent but do not claim runtime verification',async t=>{
 const f=fixture(t,{offline:true}),out=await f.manager.update({steamId:id.steam64,flags:'b',immunity:5});assert.equal(out.runtimeConfirmed,false);assert.match(out.message,/上线/);
});
test('concurrent updates serialize and preserve both managed identities',async t=>{
 const f=fixture(t,{offline:true});await Promise.all([f.manager.update({steamId:id.steam64,flags:'b',immunity:0}),f.manager.update({steamId:'[U:1:5]',flags:'bf',immunity:0})]);assert.equal(simpleEntries(splitManaged(fs.readFileSync(f.simple,'utf8')).managed,true).size,2);
});
test('malformed owned blocks fail closed and ordinary password entries are recognized',async t=>{
 const f=fixture(t);fs.appendFileSync(f.simple,BEGIN+'\n');await assert.rejects(()=>f.manager.update({steamId:id.steam64,flags:'b',immunity:0}),/配置块损坏/);
 assert.equal(simpleEntries('"STEAM_0:0:10" "z" "private-password"').size,1);assert.throws(()=>splitManaged(BEGIN+'\n'+END+'\n'+END));
});

test('Valve KeyValues field capitalization does not break snapshots or history',async t=>{
 const f=fixture(t),dir=path.join(f.base,'data','l4d2 control');
 for(const file of ['players.txt','history.txt']){const p=path.join(dir,file);fs.writeFileSync(p,fs.readFileSync(p,'utf8').replace(/"version"/g,'"Version"').replace(/"name"/g,'"Name"').replace(/"steam64"/g,'"Steam64"').replace(/"firstSeen"/g,'"FirstSeen"'));}
 const out=await f.manager.list();assert.equal(out.available,true);assert.equal(out.onlineCount,1);assert.equal(out.players.find(p=>p.steam64===id.steam64).firstSeen,100000);
});

test('hibernating servers refresh stale snapshots once for concurrent readers',async t=>{
 let calls=0;const f=fixture(t,{refresh:async snapshot=>{calls++;await new Promise(r=>setTimeout(r,15));snapshot();}});f.snapshot(60);
 const results=await Promise.all([f.manager.list(),f.manager.list()]);assert.equal(calls,1);assert.ok(results.every(r=>r.available));
});
