const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { spawn } = require('node:child_process');
const { createRestartController, inspectGame } = require('../server controls');
const old = { pid: 101, identity: '101:1', supervised: true }, next = { pid: 102, identity: '102:2', supervised: true };
const tick = () => new Promise(resolve => setImmediate(resolve));

test('game restart shortcuts share confirmation, busy state and retry without restarting the host', async () => {
  const vm = require('node:vm'), cheerio = require('cheerio');
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const $html = cheerio.load(html);
  assert.equal($html('[data-game-restart]').length, 2);
  assert.equal($html('#restartServer').text(), '重启游戏');
  assert.equal($html('#restartPlatformGame').text(), '重启游戏');
  assert.equal($html('[data-game-restart][data-admin-only]').length, 2);
  assert.match($html('#restartServerDialog').text(), /不重启整台主机/);
  const nodes = new Map(), posts = [], timers = [], notices = [];
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, { disabled: false, isConnected: true, handlers: {}, classList: { toggle() {} },
      addEventListener(name, fn) { this.handlers[name] = fn; },
      showModal() { this.open = true; }, close() { this.open = false; this.handlers.close?.(); }, focus() { this.focused = true; } });
    return nodes.get(id);
  }
  const triggers = ['#restartServer', '#restartPlatformGame'].map(node), statuses = ['#restartServerStatus', '#platformGameRestartStatus'].map(node);
  let fail = false;
  const context = vm.createContext({ $: node, restartBusy: false, restartTimer: null,
    document: { querySelectorAll: selector => selector === '[data-game-restart]' ? triggers : statuses },
    setInterval: fn => { timers.push(fn); return timers.length; }, clearInterval() {}, syncStatus() {}, loadPlayers() {},
    post: async (url, body) => { posts.push({ url, body }); if (fail) throw Error('fixture failure'); return { status: 'restarting', message: 'waiting' }; }, record: value => notices.push(value), toast() {} });
  const source = fs.readFileSync(path.join(__dirname, '../players.js'), 'utf8');
  vm.runInContext(source.slice(source.indexOf('function displayRestartStatus('), source.indexOf('\ncheckRestartStatus();')), context);
  for (const trigger of triggers) {
    trigger.onclick(); assert.equal(node('#restartServerDialog').open, true); assert.equal(posts.length, 0);
    node('#cancelServerRestart').onclick(); assert.equal(node('#restartServerDialog').open, false); assert.equal(trigger.focused, true);
  }
  triggers[1].onclick(); fail = true; await node('#confirmServerRestart').onclick();
  assert.equal(node('#restartServerDialog').open, true); assert.equal(node('#restartServerMessage').textContent, 'fixture failure');
  assert.equal(node('#confirmServerRestart').disabled, false);
  fail = false; await node('#confirmServerRestart').onclick();
  assert.equal(posts.length, 2); assert.equal(posts[1].url, '/api/server/restart'); assert.equal(posts[1].body.confirmed, true);
  assert.equal(node('#restartServerDialog').open, false); assert.ok(triggers.every(button => button.disabled));
  triggers[0].onclick(); assert.equal(node('#restartServerDialog').open, false);
  vm.runInContext('displayRestartStatus({status:"completed",message:"ready"})', context);
  assert.ok(triggers.every(button => !button.disabled)); assert.ok(statuses.every(message => message.textContent === 'ready'));
  assert.equal(notices.length, 1);
});
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
