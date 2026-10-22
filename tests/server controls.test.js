const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { spawn } = require('node:child_process');
const { createRestartController, inspectGame } = require('../server controls');
const old = { pid: 101, identity: '101:1', supervised: true }, next = { pid: 102, identity: '102:2', supervised: true };
const tick = () => new Promise(resolve => setImmediate(resolve));
test('restart needs explicit confirmation and a single verified supervisor', async () => {
  for (const processes of [[], [old,next], [{ ...old, supervised: false }]]) { let kills = 0; const control = createRestartController({ inspect: async () => processes, terminate: () => kills++ }); await assert.rejects(() => control.start({ confirmed: true })); assert.equal(kills, 0); }
  const control = createRestartController({ inspect: async () => [old] }); await assert.rejects(() => control.start({}), /确认/);
});
test('PID changes before termination fail without sending a signal', async () => {
  let reads=0,kills=0; const control=createRestartController({inspect:async()=>[++reads===1?old:next],terminate:()=>kills++}); await assert.rejects(()=>control.start({confirmed:true}),/变化/); assert.equal(kills,0);
});
test('restart waits for a new ready process and rejects duplicate requests', async () => {
  let killed=false,ready=false;const control=createRestartController({inspect:async()=>[killed?next:old],terminate:pid=>{assert.equal(pid,101);killed=true;},ready:async()=>ready,sleep:tick});
  assert.equal((await control.start({confirmed:true})).status,'restarting'); await assert.rejects(()=>control.start({confirmed:true}),/正在重启/); ready=true;
  for(let i=0;i<10&&control.get().status==='restarting';i++)await tick();assert.equal(control.get().status,'completed');
});
test('timeout and signal failure are reported instead of claiming restart success',async()=>{
  const timeout=createRestartController({inspect:async()=>[old],terminate:()=>{},sleep:async()=>{}});await timeout.start({confirmed:true});for(let i=0;i<100&&timeout.get().status==='restarting';i++)await tick();assert.equal(timeout.get().status,'failed');
  const signal=createRestartController({inspect:async()=>[old],terminate:()=>{throw Error('permission denied');}});await assert.rejects(()=>signal.start({confirmed:true}),/permission/);assert.equal(signal.get().status,'failed');
});
test('Linux isolated srcds_run supervisor restarts only its own child process', {skip:process.platform!=='linux'}, async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'l4d2 restart fixture '));
  const wrapper=path.join(root,'srcds_run'),child=path.join(root,'game fixture.js');
  fs.writeFileSync(wrapper,'#!/bin/sh\nwhile :; do "$1" "$2"; done\n');fs.writeFileSync(child,'process.title="srcds_linux"; setInterval(()=>{},1000);');
  const supervisor=spawn('/bin/sh',[wrapper,process.execPath,child],{cwd:root,stdio:'ignore'});
  t.after(async()=>{supervisor.kill('SIGTERM');for(const p of await inspectGame(root))try{process.kill(p.pid,'SIGKILL');}catch{}fs.rmSync(root,{recursive:true,force:true});});
  let before;for(let i=0;i<100;i++){[before]=await inspectGame(root);if(before)break;await new Promise(r=>setTimeout(r,20));}assert.ok(before?.supervised);
  const control=createRestartController({inspect:()=>inspectGame(root),sleep:()=>new Promise(r=>setTimeout(r,30))});await control.start({confirmed:true});
  for(let i=0;i<100&&control.get().status==='restarting';i++)await new Promise(r=>setTimeout(r,30));assert.equal(control.get().status,'completed');const [after]=await inspectGame(root);assert.notEqual(after.identity,before.identity);
});
