const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const yazl = require('yazl');
const { createLibrary, validateSmx } = require('../library manager');
const { mapInventory, pluginInventory } = require('../inventory');
const { createManager } = require('../download manager');

function vpk(id = 'sample') {
  const entry = Buffer.alloc(18); entry.writeUInt16LE(0x7fff, 6); entry.writeUInt16LE(0xffff, 16);
  const tree = Buffer.concat([Buffer.from(`bsp\0maps\0${id}\0`), entry, Buffer.alloc(3)]);
  const header = Buffer.alloc(12); header.writeUInt32LE(0x55aa1234); header.writeUInt32LE(1, 4); header.writeUInt32LE(tree.length, 8);
  return Buffer.concat([header, tree]);
}
function smx() {
  const image = Buffer.alloc(44); image.writeUInt32LE(0x53504646); image.writeUInt16LE(0x107, 4);
  image.writeUInt32LE(image.length, 7); image.writeUInt32LE(image.length, 11); image[15] = 1;
  image.writeUInt32LE(36, 16); image.writeUInt32LE(40, 20); image.writeUInt32LE(40, 28); image.writeUInt32LE(4, 32);
  Buffer.from('abc\0').copy(image, 36); return image;
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'panel-library-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const addonDir = path.join(root, 'left4dead2', 'addons'), pluginPath = path.join(addonDir, 'sourcemod', 'plugins');
  fs.mkdirSync(pluginPath, { recursive: true });
  let current = 'c1m1_hotel'; const unloaded = [];
  const options = { serverRoot: root, addonDir, pluginPath, stateDir: path.join(root, 'library'), currentMap: async () => current, unloadPlugin: async id => unloaded.push(id) };
  return { root, addonDir, pluginPath, options, library: createLibrary(options), unloaded, current: value => { current = value; } };
}
const input = bytes => { const stream = Readable.from([bytes]); stream.headers = {'content-length':String(bytes.length)}; return stream; };
async function zip(files) {
  const archive = new yazl.ZipFile(), chunks = [];
  archive.outputStream.on('data', chunk => chunks.push(chunk));
  const done = new Promise((resolve, reject) => archive.outputStream.on('end', resolve).on('error', reject));
  for (const [name, bytes] of files) archive.addBuffer(bytes, name);
  archive.end(); await done; return Buffer.concat(chunks);
}
test('imported map without mission becomes visible; running map and official maps protected; deletion archives bytes', async t => {
  const f = fixture(t), bytes = vpk();
  await f.library.importFile('maps', '地图.vpk', input(bytes));
  const inventory = await mapInventory(f.root);
  assert.equal(inventory.campaigns[0].package, '地图.vpk'); assert.equal(inventory.campaigns[0].chapters[0].id, 'sample');
  f.current('sample'); await assert.rejects(f.library.deleteMap('地图.vpk'), /正在运行/);
  await assert.rejects(f.library.deleteMap('pak01_dir.vpk'), /只能删除/);
  f.current('c1m1_hotel'); await f.library.deleteMap('地图.vpk');
  assert.equal(fs.existsSync(path.join(f.addonDir, '地图.vpk')), false);
  const backup = path.join(f.options.stateDir, fs.readdirSync(f.options.stateDir)[0], '地图.vpk');
  assert.deepEqual(fs.readFileSync(backup), bytes);
});
test('SMX imports disabled, duplicate conflicts, enabled unload and core protection', async t => {
  const f = fixture(t);
  await f.library.importFile('plugins', 'sample.smx', input(smx()));
  assert.equal(pluginInventory(f.pluginPath)[0].enabled, false);
  await assert.rejects(f.library.importFile('plugins', 'sample.smx', input(smx())), /同名插件/);
  fs.renameSync(path.join(f.pluginPath, 'disabled', 'sample.smx'), path.join(f.pluginPath, 'sample.smx'));
  await f.library.deletePlugin('sample'); assert.deepEqual(f.unloaded, ['sample']); assert.equal(pluginInventory(f.pluginPath).length, 0);
  fs.writeFileSync(path.join(f.pluginPath, 'adminmenu.smx'), smx());
  await assert.rejects(f.library.deletePlugin('adminmenu'), /核心/);
  assert.ok(fs.existsSync(path.join(f.pluginPath, 'adminmenu.smx')));
});
test('failed unload preserves plugin file', async t => {
  const f = fixture(t); fs.writeFileSync(path.join(f.pluginPath, 'sample.smx'), smx());
  const library = createLibrary({...f.options, unloadPlugin: async () => { throw new Error('game command failed'); }});
  await assert.rejects(library.deletePlugin('sample'), /game command failed/);
  assert.deepEqual(fs.readFileSync(path.join(f.pluginPath, 'sample.smx')), smx());
});
test('bad files, traversal, oversize and duplicate ZIP leave installed bytes intact', async t => {
  const f = fixture(t);
  for (const name of ['../evil.vpk', 'folder/evil.vpk', 'evil.exe']) await assert.rejects(f.library.importFile('maps', name, input(vpk())), /文件名/);
  await assert.rejects(f.library.importFile('maps', 'bad.vpk', input(Buffer.from('bad'))), /VPK/);
  await assert.rejects(f.library.importFile('plugins', 'bad.smx', input(Buffer.alloc(30))), /SMX/);
  await assert.rejects(f.library.importFile('plugins', 'a'.repeat(129) + '.smx', input(smx())), /文件名/);
  const oversized = input(smx()); oversized.headers['content-length'] = String(65 * 1024 ** 2);
  await assert.rejects(f.library.importFile('plugins', 'big.smx', oversized), /大小限制/);
  await f.library.importFile('maps', 'existing.vpk', input(vpk()));
  const bundle = await zip([['one/new.vpk', vpk('new')], ['two/existing.vpk', vpk('other')]]);
  await assert.rejects(f.library.importFile('maps', 'bundle.zip', input(bundle)), /同名地图包/);
  assert.equal(fs.existsSync(path.join(f.addonDir, 'new.vpk')), false);
  assert.deepEqual(fs.readFileSync(path.join(f.addonDir, 'existing.vpk')), vpk());
  const duplicate = await zip([['one/same.vpk', vpk()], ['two/same.vpk', vpk('other')]]);
  await assert.rejects(f.library.importFile('maps', 'duplicate.zip', input(duplicate)), /同名地图包/);
});
test('ZIP imports all map packages and broken uploads cannot install a partial file', async t => {
  const f = fixture(t), bundle = await zip([['one/a.vpk', vpk('a')], ['two/b.vpk', vpk('b')]]);
  assert.deepEqual((await f.library.importFile('maps', 'bundle.zip', input(bundle))).files.sort(), ['a.vpk','b.vpk']);
  assert.equal((await mapInventory(f.root)).chapterCount, 2);
  const broken = new Readable({read(){this.push(Buffer.alloc(20));this.destroy(new Error('interrupted'));}});
  await assert.rejects(f.library.importFile('plugins', 'partial.smx', broken), /interrupted/);
  assert.equal(fs.existsSync(path.join(f.pluginPath, 'disabled', 'partial.smx')), false);
});
test('exports custom map packages and enabled or disabled plugins without changing state', async t => {
  const f = fixture(t), mapBytes = vpk('export_map'), pluginBytes = smx();
  await f.library.importFile('maps', '导出地图.vpk', input(mapBytes));
  await f.library.importFile('plugins', 'sample.smx', input(pluginBytes));
  const readExport = async artifact => {
    try { return fs.readFileSync(artifact.fd); } finally { fs.closeSync(artifact.fd); }
  };
  const map = await f.library.exportFile('maps', '导出地图.vpk');
  assert.equal(map.name, '导出地图.vpk');
  assert.deepEqual(await readExport(map), mapBytes);
  const disabled = await f.library.exportFile('plugins', 'sample');
  assert.deepEqual(await readExport(disabled), pluginBytes);
  fs.renameSync(path.join(f.pluginPath, 'disabled', 'sample.smx'), path.join(f.pluginPath, 'sample.smx'));
  const enabled = await f.library.exportFile('plugins', 'sample');
  assert.deepEqual(await readExport(enabled), pluginBytes);
  assert.ok(fs.existsSync(path.join(f.addonDir, '导出地图.vpk')));
  assert.ok(fs.existsSync(path.join(f.pluginPath, 'sample.smx')));
  await assert.rejects(f.library.exportFile('maps', 'pak01_dir.vpk'), /只能导出/);
  await assert.rejects(f.library.exportFile('plugins', '../sample'), /文件名/);
});
test('plugin directory symlink cannot redirect imported files', {skip:process.platform === 'win32'}, async t => {
  const f = fixture(t), elsewhere = path.join(f.root, 'elsewhere');fs.mkdirSync(elsewhere);
  fs.symlinkSync(elsewhere, path.join(f.pluginPath, 'disabled'));
  await assert.rejects(f.library.importFile('plugins', 'sample.smx', input(smx())), /符号链接/);
  assert.deepEqual(fs.readdirSync(elsewhere), []);
});
test('map export rejects VPK symlinks instead of serving outside files', {skip:process.platform === 'win32'}, async t => {
  const f = fixture(t), outside = path.join(f.root, 'outside.vpk'); fs.writeFileSync(outside, vpk('linked_map'));
  fs.symlinkSync(outside, path.join(f.addonDir, 'linked.vpk'));
  await assert.rejects(f.library.exportFile('maps', 'linked.vpk'), /普通文件/);
});
test('SMX validates compressed bytes and section bounds', t => {
  const f=fixture(t), file=path.join(f.root,'fixture.smx'), bytes=smx();
  fs.writeFileSync(file,bytes);validateSmx(file);
  // Compression overhead may exceed the original image size for tiny fixtures;
  // use a larger repetitive payload, as a real compressed SMX would.
  const large=Buffer.concat([bytes,Buffer.alloc(1000)]);large.writeUInt32LE(large.length,7);large.writeUInt32LE(large.length,11);
  const packed=Buffer.concat([large.subarray(0,40),require('node:zlib').deflateSync(large.subarray(40))]);packed[6]=1;packed.writeUInt32LE(packed.length,7);
  fs.writeFileSync(file,packed);validateSmx(file);
  packed[packed.length-1]^=255;fs.writeFileSync(file,packed);assert.throws(()=>validateSmx(file),/压缩数据/);
  bytes.writeUInt32LE(9999,28);fs.writeFileSync(file,bytes);assert.throws(()=>validateSmx(file),/分区/);
});
test('deleting completed task persists removal and keeps installed content', async t => {
  const f = fixture(t), stateDir=path.join(f.root,'downloads');fs.mkdirSync(stateDir);
  fs.writeFileSync(path.join(stateDir,'jobs.json'),JSON.stringify([{id:'fixture',source:'gamemaps',itemId:'1',status:'completed',installedFiles:['keep.vpk']}]));
  fs.writeFileSync(path.join(f.addonDir,'keep.vpk'),vpk());
  const options={addonDir:f.addonDir,stateDir,localMode:true};const manager=createManager(options);
  await manager.remove('fixture');assert.deepEqual(manager.list(),[]);assert.deepEqual(createManager(options).list(),[]);
  assert.deepEqual(fs.readFileSync(path.join(f.addonDir,'keep.vpk')),vpk());
});
test('deleting active task waits for abort cleanup, queued task never starts', {skip:process.platform==='win32'}, async t => {
  const f=fixture(t);let begun, stopped=false, calls=0;const started=new Promise(resolve=>begun=resolve);
  const source={details:async(id,signal)=>{calls++;begun();await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>setTimeout(()=>{stopped=true;reject(signal.reason);},30),{once:true}));}};
  const manager=createManager({addonDir:f.addonDir,stateDir:path.join(f.root,'downloads'),localMode:true,steamSource:source});
  const active=manager.start('steam-workshop','1','active'),queued=manager.start('steam-workshop','2','queued');
  await started;await manager.remove(queued.id);assert.equal(calls,1);
  await manager.remove(active.id);assert.equal(stopped,true);assert.deepEqual(manager.list(),[]);
  assert.deepEqual(fs.readdirSync(f.addonDir),['sourcemod']);
});
test('HTTP uploads enforce login and origin, show maps, and import/delete disabled plugins', async t => {
  const f=fixture(t), {spawn}=require('node:child_process');
  const child=spawn(process.execPath,[path.join(__dirname,'..','server.js')],{env:{...process.env,PORT:'0',BIND_HOST:'127.0.0.1',L4D2_EXEC_MODE:'local',L4D2_SERVER_ROOT:f.root,L4D2_PLUGIN_PATH:f.pluginPath,WORKSHOP_ADDON_DIR:f.addonDir,DOWNLOAD_STATE_DIR:path.join(f.root,'downloads'),LIBRARY_STATE_DIR:path.join(f.root,'state'),PLUGIN_STORE_SYNC_ENABLED:'false',PLUGIN_STORE_CACHE_DIR:path.join(f.root,'plugin store'),PANEL_ACCOUNT_STATE_DIR:path.join(f.root,'accounts'),PLAYER_STATE_DIR:path.join(f.root,'players'),CLOUD_MAPS_STATE_DIR:path.join(f.root,'cloud'),PANEL_PASSWORD:'fixture',PANEL_USER:'admin',PANEL_AUTH_TOKEN:'',L4D2_GAME_HOST:'game.example',L4D2_GAME_PORT:'27016',OPENLIST_URL:'https://files.example/openlist',OPENLIST_SHARE_TOKEN:'fixture-secret-token',OPENLIST_MAPS_PATH:'/l4d2-maps',PANEL_TLS_KEY:path.join(f.root,'absent-key'),PANEL_TLS_CERT:path.join(f.root,'absent-cert')},stdio:['ignore','pipe','pipe']});
  t.after(async()=>{const exit=new Promise(resolve=>child.once('exit',resolve));child.kill();await exit;});
  const port=await new Promise((resolve,reject)=>{
    let output='',stderr='';
    const timer=setTimeout(()=>reject(new Error('server startup timeout: '+stderr)),15000);
    child.stderr.on('data',bytes=>{stderr+=bytes;});
    child.stdout.on('data',bytes=>{output+=bytes;const match=output.match(/127\.0\.0\.1:(\d+)/);if(match){clearTimeout(timer);resolve(match[1]);}});
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('exit',code=>{clearTimeout(timer);reject(new Error(`server exited ${code}: ${stderr}`));});
  });
  const base=`http://127.0.0.1:${port}`,authorization='Basic '+Buffer.from('admin:fixture').toString('base64');
  assert.equal((await fetch(base+'/api/config')).status,401);
  assert.equal((await fetch(base+'/api/openlist/download?name=map.vpk')).status,401);
  assert.equal((await fetch(base+'/api/openlist/download-info',{method:'POST',body:'{}'})).status,401);
  assert.equal((await fetch(base+'/api/openlist/download?name=map.vpk',{headers:{authorization,'sec-fetch-site':'cross-site'}})).status,403);
  assert.equal((await fetch(base+'/api/openlist/download-info',{method:'POST',headers:{authorization,origin:'https://other.example','content-type':'application/json'},body:'{}'})).status,403);
  assert.equal((await fetch(base+'/api/openlist/download-info',{method:'POST',headers:{authorization,'content-type':'application/json'},body:JSON.stringify({name:'../private.vpk'})})).status,400);
  assert.equal((await fetch(base+'/api/openlist/map-download-info',{method:'POST',body:'{}'})).status,401);
  assert.equal((await fetch(base+'/api/openlist/map-download-info',{method:'POST',headers:{authorization,origin:'https://other.example','content-type':'application/json'},body:JSON.stringify({package:'a.vpk'})})).status,403);
  assert.equal((await fetch(base+'/api/openlist/map-download-info',{method:'POST',headers:{authorization,'content-type':'application/json'},body:JSON.stringify({package:'../private.vpk'})})).status,400);
  assert.equal((await fetch(base+'/api/openlist/direct-download?package=a.vpk')).status,401);
  assert.equal((await fetch(base+'/api/openlist/direct-download?package=a.vpk',{headers:{authorization,'sec-fetch-site':'cross-site'}})).status,403);
  assert.equal((await fetch(base+'/api/diagnostics')).status,401);
  const diagnostics=await fetch(base+'/api/diagnostics',{headers:{authorization}});
  assert.equal(diagnostics.status,200);
  const report=await diagnostics.json();assert.equal(report.maps.conflictCount,0);assert.equal(report.plugins.available,false);
  assert.equal((await fetch(base+'/api/diagnostics',{method:'POST',headers:{authorization,'content-type':'application/json'},body:'{}'})).status,404);
  const config = await fetch(base+'/api/config',{headers:{authorization}});
  assert.equal(config.status,200);
  const configBody=await config.text();
  assert.equal(configBody.includes('fixture-secret-token'),false);
  const configData=JSON.parse(configBody);
  assert.equal(configData.gameAddress,'game.example:27016');
  assert.deepEqual(configData.openList,{enabled:true,url:'https://files.example/openlist',projectUrl:'https://github.com/OpenListTeam/OpenList',mapsPath:'/l4d2-maps',upload:false});
  const openListConfig=await fetch(base+'/api/openlist',{headers:{authorization}});
  assert.deepEqual(await openListConfig.json(),configData.openList);
  const upload=(endpoint,bytes,headers={})=>fetch(base+endpoint,{method:'POST',headers:{authorization,'content-type':'application/octet-stream',...headers},body:bytes});
  assert.equal((await upload('/api/maps/import?name=a.vpk',vpk(),{authorization:''})).status,401);
  assert.equal((await upload('/api/maps/import?name=a.vpk',vpk(),{origin:'https://other.example'})).status,403);
  assert.equal((await upload('/api/maps/import?name=a.vpk',vpk())).status,200);
  const maps=await (await fetch(base+'/api/maps',{headers:{authorization}})).json();assert.equal(maps.chapterCount,1);
  assert.equal((await fetch(base+'/api/maps/export?package=a.vpk')).status,401);
  assert.equal((await fetch(base+'/api/plugins/export?id=sample')).status,401);
  assert.equal((await fetch(base+'/api/plugins/export?id=sample',{method:'POST',headers:{authorization,'content-type':'application/json'},body:'{}'})).status,405);
  assert.equal((await upload('/api/maps/import?name=a.vpk',vpk())).status,409);
  assert.equal((await upload('/api/plugins/import?name=sample.SMX',smx())).status,200);
  assert.equal(pluginInventory(f.pluginPath)[0].enabled,false);
  const mapExport = await fetch(base+'/api/maps/export?package=a.vpk',{headers:{authorization}});
  assert.equal(mapExport.status,200); assert.equal(mapExport.headers.get('content-type'),'application/octet-stream');
  assert.deepEqual(Buffer.from(await mapExport.arrayBuffer()),vpk());
  assert.equal((await upload('/api/maps/import?name='+encodeURIComponent('地图.vpk'),vpk('second_map'))).status,200);
  const chineseExport = await fetch(base+'/api/maps/export?package='+encodeURIComponent('地图.vpk'),{headers:{authorization}});
  assert.equal(chineseExport.status,200);
  assert.match(chineseExport.headers.get('content-disposition') || '',/filename\*=UTF-8''%E5%9C%B0%E5%9B%BE\.vpk/);
  assert.deepEqual(Buffer.from(await chineseExport.arrayBuffer()),vpk('second_map'));
  const pluginExport = await fetch(base+'/api/plugins/export?id=sample',{headers:{authorization}});
  assert.equal(pluginExport.status,200); assert.match(pluginExport.headers.get('content-disposition') || '',/sample\.smx/);
  assert.deepEqual(Buffer.from(await pluginExport.arrayBuffer()),smx());
  const pluginHead = await fetch(base+'/api/plugins/export?id=sample',{method:'HEAD',headers:{authorization}});
  assert.equal(pluginHead.status,200); assert.equal(Number(pluginHead.headers.get('content-length')),smx().length);
  assert.equal((await fetch(base+'/api/maps/export?package=pak01_dir.vpk',{headers:{authorization}})).status,400);
  assert.equal((await fetch(base+'/api/maps/export?package=..%2Fsample.vpk',{headers:{authorization}})).status,400);
  assert.equal((await fetch(base+'/api/plugins/export?id=missing',{headers:{authorization}})).status,404);
  const deleted=await fetch(base+'/api/plugins/delete',{method:'POST',headers:{authorization,'content-type':'application/json'},body:JSON.stringify({id:'sample'})});
  assert.equal(deleted.status,200);assert.deepEqual(pluginInventory(f.pluginPath),[]);
  assert.equal((await upload('/api/plugins/import?name=bad.smx',Buffer.from('bad'))).status,400);
});
