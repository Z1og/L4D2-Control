const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createGameplayController,cvarValue}=require('../gameplay controls');
function fixture(t,options={}){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'Gameplay test '));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const values={mp_gamemode:'coop',z_difficulty:'Normal',sv_maxplayers:'4',sv_visiblemaxplayers:'4',sv_allow_lobby_connect_only:'0',bots_limit:'4',bots_join_limit:'-1',bots_version:'1.11.8'};
 const writes=[];let ignore=options.ignore;
 const capture=async commands=>{
  for(const c of commands){const match=/^sm_cvar (\w+) ([A-Za-z0-9_-]+)$/.exec(c);if(match){writes.push(c);if(match[1]!==ignore)values[match[1]]=match[2];}}
  return Object.entries(values).map(([key,value])=>'[SM] Value of cvar "'+key+'": "'+value+'"').join('\n')+'\n"bots_limit" = "4" min. 1.000000 max. 18.000000\n"sv_maxplayers" = "4" min. -1.000000 max. 31.000000\n'+(options.unsupported?'':' 50 "l4d2_sv_maxplayers" (1.3.8) by author');
 };
 return {values,writes,directory,control:createGameplayController({capture,directory,onlineCount:async()=>options.online||0})};
}
const payload={confirmed:true,mode:'coop',difficulty:'Normal',allowDirect:true,multiplayer:true,maxPlayers:8,botCount:4};
test('runtime queries detect actual engine limit and hidden convars',async t=>{
 const f=fixture(t),s=await f.control.read();assert.equal(s.maxSlots,18);assert.equal(s.maxPlayersSupported,true);assert.equal(s.mode,'coop');assert.equal(f.writes.length,0);
 assert.match(s.capabilityMessage,/l4d2_sv_maxplayers 与 bots/);assert.match(s.capabilityMessage,/当前配置上限为 18 人/);assert.doesNotMatch(s.capabilityMessage,/当前引擎/);
 assert.equal(cvarValue('Unknown command "mp_gamemode"','mp_gamemode'),null);
});
test('save reads values back and persists only allowlisted settings',async t=>{
 const f=fixture(t),s=await f.control.apply(payload);assert.equal(s.applied,true);assert.equal(s.maxPlayers,8);assert.equal(s.requiresMapChange,false);
 const saved=fs.readFileSync(path.join(f.directory,'gameplay.txt'),'utf8');assert.match(saved,/"sv_maxplayers" "8"/);assert.match(saved,/"bots_join_limit" "8"/);
});
test('mode changes report deferred map effect; standard versus restores eight slots',async t=>{
 const f=fixture(t),s=await f.control.apply({...payload,mode:'versus',multiplayer:false});assert.equal(s.requiresMapChange,true);assert.equal(s.maxPlayers,8);assert.equal(f.values.bots_join_limit,'-1');
});
test('unavailable dependencies, over-capacity, malicious input and online shrink cannot mutate',async t=>{
 for(const options of [{unsupported:true},{online:10}]){const f=fixture(t,options);await assert.rejects(()=>f.control.apply(payload));assert.equal(f.writes.length,0);}
 for(const change of [{maxPlayers:19},{maxPlayers:4.5},{botCount:20},{mode:'coop;quit'},{confirmed:false},{multiplayer:true,mode:'survival'},{allowDirect:'yes'}]){
  const f=fixture(t);await assert.rejects(()=>f.control.apply({...payload,...change}));assert.equal(f.writes.length,0);
 }
});
test('readback mismatch rolls all changed values back and never persists false success',async t=>{
 const f=fixture(t,{ignore:'bots_limit'});await assert.rejects(()=>f.control.apply({...payload,botCount:6}),/读回/);
 assert.equal(f.values.sv_maxplayers,'4');assert.equal(f.values.sv_visiblemaxplayers,'4');assert.equal(fs.existsSync(path.join(f.directory,'gameplay.txt')),false);
});
test('gameplay navigation is shared while settings and map reload stay administrator-only',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 assert.ok(html.indexOf('data-view="gameplay"')<html.indexOf('data-view="maps"'));assert.match(html,/<section class="content hidden" id="gameplayView"/);assert.match(html,/<form data-admin-only id="gameplayForm"/);assert.match(html,/gameplay-reload" data-admin-only/);
 assert.match(html,/id="gameplayMaxPlayers"/);assert.doesNotMatch(html,/<span>Co-op · 合作模式<\/span>/);
});

test('ordinary gameplay snapshot exposes only live public values and invalidates after admin changes',async t=>{
 const f=fixture(t);const s=await f.control.readPublic();
 assert.deepEqual(Object.keys(s).sort(),['mode','modeName','difficulty','difficultyName','maxPlayers','botCount','allowDirect','updatedAt'].sort());
 assert.equal(s.modeName,'合作战役');assert.equal(s.difficultyName,'普通');assert.equal(s.maxPlayers,4);assert.equal(f.writes.length,0);
 await f.control.apply(payload);const changed=await f.control.readPublic();assert.equal(changed.maxPlayers,8);
});
