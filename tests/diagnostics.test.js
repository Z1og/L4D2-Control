const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { scanVpkConflicts, parsePluginListing, parsePluginInfo, inspectPluginRuntime, collectPluginRuntime, extractConsoleFrame } = require('../diagnostics');

function vpk(paths) {
  const groups = new Map();
  for (const file of paths) {
    const ext = path.posix.extname(file).slice(1) || ' ', folder = path.posix.dirname(file) === '.' ? ' ' : path.posix.dirname(file), name = path.posix.basename(file, path.posix.extname(file));
    if (!groups.has(ext)) groups.set(ext, new Map());
    if (!groups.get(ext).has(folder)) groups.get(ext).set(folder, []);
    groups.get(ext).get(folder).push(name);
  }
  const tree = [];
  for (const [ext, folders] of groups) {
    tree.push(Buffer.from(ext+'\0'));
    for (const [folder, names] of folders) {
      tree.push(Buffer.from(folder+'\0'));
      for (const name of names) { const entry = Buffer.alloc(18); entry.writeUInt16LE(0x7fff,6); entry.writeUInt16LE(0xffff,16); tree.push(Buffer.from(name+'\0'),entry); }
      tree.push(Buffer.alloc(1));
    }
    tree.push(Buffer.alloc(1));
  }
  tree.push(Buffer.alloc(1));
  const bytes=Buffer.concat(tree), header=Buffer.alloc(12);header.writeUInt32LE(0x55aa1234);header.writeUInt32LE(1,4);header.writeUInt32LE(bytes.length,8);
  return Buffer.concat([header,bytes]);
}
function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'l4d2 diagnostics '));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;
}
const disk = (id, enabled=true) => ({id,name:id,enabled});
const listing='[SM] Listing 3 plugins:\n 01 "Arbitrary Display Name" (1.0) by Author\n 02 <Failed> failed.smx\n 03 <Paused> "Paused plugin" (1.0)\nErrors:\nfailed.smx: Missing native';

test('VPK detects shared paths across map packs and workshop, excluding metadata and non-map packs', async t=>{
 const root=fixture(t);fs.mkdirSync(path.join(root,'workshop'));
 const inputs={'a.vpk':vpk(['maps/a.bsp','materials/shared.vmt','addoninfo.txt']), 'b.vpk':vpk(['maps/b.bsp','Materials/SHARED.vmt','addoninfo.txt']), 'skin.vpk':vpk(['materials/shared.vmt'])};
 for(const [name,bytes] of Object.entries(inputs))fs.writeFileSync(path.join(root,name),bytes);
 fs.writeFileSync(path.join(root,'workshop','c.vpk'),vpk(['maps/a.bsp']));
 const before=Object.fromEntries(Object.entries(inputs).map(([name,bytes])=>[name,crypto.createHash('sha256').update(bytes).digest('hex')]));
 const result=await scanVpkConflicts(root);assert.equal(result.scannedPackages,3);assert.equal(result.ignoredPackages,1);assert.equal(result.conflictCount,2);assert.equal(result.partial,false);
 assert.deepEqual(result.conflicts.find(item=>item.path==='materials/shared.vmt').packages,['a.vpk','b.vpk']);
 assert.deepEqual(result.conflicts.find(item=>item.path==='maps/a.bsp').packages,['a.vpk','workshop/c.vpk']);
 for(const [name,hash] of Object.entries(before))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,name))).digest('hex'),hash);
});
test('VPK empty, unique, malformed and missing directories have distinct outcomes', async t=>{
 const root=fixture(t);assert.equal((await scanVpkConflicts(root)).scannedPackages,0);
 fs.writeFileSync(path.join(root,'a.vpk'),vpk(['maps/a.bsp']));fs.writeFileSync(path.join(root,'b.vpk'),vpk(['maps/b.bsp']));
 assert.equal((await scanVpkConflicts(root)).conflictCount,0);
 fs.writeFileSync(path.join(root,'bad.vpk'),Buffer.from('not a vpk'));
 const broken=vpk(['maps/bad.bsp']);broken.fill(65,12);fs.writeFileSync(path.join(root,'truncated.vpk'),broken);
 const result=await scanVpkConflicts(root);assert.equal(result.partial,true);assert.equal(result.unreadablePackages.length,2);assert.equal(result.scannedPackages,2);
 assert.equal((await scanVpkConflicts(path.join(root,'absent'))).available,false);
});
test('VPK output limit retains total conflict count; split payloads are not read as indexes', async t=>{
 const root=fixture(t), paths=['maps/same.bsp',...Array.from({length:210},(_,i)=>`materials/${i}.vmt`)];
 fs.writeFileSync(path.join(root,'a_dir.vpk'),vpk(paths));fs.writeFileSync(path.join(root,'a_000.vpk'),Buffer.from('payload'));
 fs.writeFileSync(path.join(root,'b.vpk'),vpk(paths));
 const result=await scanVpkConflicts(root);assert.equal(result.conflictCount,211);assert.equal(result.conflicts.length,200);assert.equal(result.truncated,true);assert.equal(result.unreadablePackages.length,0);
});
test('VPK bounds index allocations before reading resources', async t=>{
 const root=fixture(t), file=path.join(root,'huge.vpk'), header=Buffer.alloc(12);header.writeUInt32LE(0x55aa1234);header.writeUInt32LE(1,4);header.writeUInt32LE(9*1024**2,8);
 fs.writeFileSync(file,header);fs.truncateSync(file,12+9*1024**2);
 const result=await scanVpkConflicts(root);assert.equal(result.partial,true);assert.match(result.unreadablePackages[0].reason,/8 MiB/);
});
test('VPK skips symlinks without following targets', {skip:process.platform==='win32'}, async t=>{
 const root=fixture(t);fs.writeFileSync(path.join(root,'source'),vpk(['maps/a.bsp']));fs.symlinkSync(path.join(root,'source'),path.join(root,'link.vpk'));
 const result=await scanVpkConflicts(root);assert.equal(result.scannedPackages,0);assert.equal(result.partial,true);
});
test('SourceMod parser accepts actual failed, paused and zero-plugin formats and rejects truncation', ()=>{
 const result=parsePluginListing(listing);assert.equal(result.partial,false);assert.deepEqual(result.entries.map(entry=>entry.state),['loaded','error','paused']);
 assert.equal(parsePluginListing('[SM] No plugins loaded').partial,false);
 assert.equal(parsePluginListing('Unknown command "sm"').available,false);
 assert.equal(parsePluginListing('[SM] Listing 2 plugins:\n 01 "Only one"').partial,true);
 assert.equal(parsePluginInfo('Filename: broken.smx\nLoad error: Invalid format').state,'error');
 assert.equal(parsePluginInfo('Filename: broken.smx\nError: Missing native').state,'error');
 assert.equal(parsePluginInfo('Filename: ../outside.smx\nStatus: running').filename,'');
});
test('Runtime reconciles exact filenames and retains enabled versus runtime distinctions', ()=>{
 const plugins=[disk('different'),disk('failed'),disk('paused'),disk('absent'),disk('stopped',false),disk('still',false)];
 const result=inspectPluginRuntime(plugins,{available:true,partial:false,entries:[{filename:'different.smx',name:'Fancy title',state:'loaded'},{filename:'failed.smx',state:'error',detail:'Missing native'},{filename:'paused.smx',state:'paused'},{filename:'still.smx',state:'loaded'}]});
 assert.deepEqual(result.plugins.map(item=>item.runtimeStatus),['loaded','error','paused','not-found','disabled','unexpected-loaded']);
 const unknown=inspectPluginRuntime(plugins,{available:false,entries:[],partial:true});assert.equal(unknown.counts.unknown,6);
 const incomplete=inspectPluginRuntime([disk('absent')],{available:true,partial:true,entries:[]});assert.equal(incomplete.counts.unknown,1);
 const sameTitle=inspectPluginRuntime([disk('foo')],{available:true,partial:false,entries:[{name:'foo',filename:'other.smx',state:'loaded'}]});assert.equal(sameTitle.plugins[0].runtimeStatus,'not-found');
 const missingName=inspectPluginRuntime([disk('foo')],{available:true,partial:false,entries:[{name:'foo',state:'loaded'}]});assert.equal(missingName.plugins[0].runtimeStatus,'unknown');
});
test('Console framing rejects stale, echoed or unfinished responses', ()=>{
 assert.equal(extractConsoleFrame('old\n[SM] Listing 0 plugins:\necho START\necho END','START','END'),null);
 assert.equal(extractConsoleFrame('START\nnew\nEND','START','END'),'new');
 assert.equal(extractConsoleFrame('START\nnew','START','END'),null);
 assert.equal(extractConsoleFrame('START\nold\nEND\nSTART\nnew\nEND','START','END'),'new');
});
test('Collector gets exact info and preserves paused/error state, using read-only commands', async ()=>{
 const calls=[];
 const capture=async commands=>{calls.push(commands);if(commands[0]==='sm plugins list')return listing;return '  Filename: different.smx\n  Status: running\n  Filename: failed.smx\n  Load error: Missing native\n  Filename: paused.smx\n  Status: running';};
 const result=await collectPluginRuntime([disk('different'),disk('failed'),disk('paused'),disk('absent')],capture);
 assert.deepEqual(result.plugins.map(item=>item.runtimeStatus),['loaded','error','paused','not-found']);assert.equal(result.plugins[1].detail,'Missing native');
 assert.ok(calls.flat().every(command=>/^sm plugins (list|info \d+)$/.test(command)));
});
test('Collector keeps unavailable, changed and partially captured lists unknown', async ()=>{
 let n=0;const changed=await collectPluginRuntime([disk('different')],async commands=>{if(commands[0]!=='sm plugins list')return 'Filename: different.smx\nStatus: running';return ++n===1?'[SM] Listing 1 plugin:\n 01 "A"':'[SM] No plugins loaded';});
 assert.equal(changed.counts.unknown,1);
 const failed=await collectPluginRuntime([disk('different')],async()=>{throw new Error('No game');});assert.equal(failed.available,false);
 const partial=await collectPluginRuntime([disk('different')],async commands=>commands[0]==='sm plugins list'?listing:'Filename: different.smx\nStatus: running');assert.equal(partial.counts.unknown,1);
});
