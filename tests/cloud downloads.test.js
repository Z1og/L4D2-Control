const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createCloudDownloads, downloadUrl, downloadRange } = require('../cloud downloads');
const bytes = Buffer.from([0x34,0x12,0xaa,0x55,1,2,3,4,5,6,7,8]);
async function fixture(t, options = {}) {
  const calls=[];
  const cloudMaps={downloadInfo:async name=>{if(name!=='地图.vpk')throw Object.assign(new Error('地图不存在'),{status:404});return {name,size:bytes.length,url:'https://cdn.baidupcs.com/file?sign=fixture',provider:'BaiduNetdisk',token:'must-not-return'};}};
  const fetchImpl=options.fetchImpl|| (async(url,request)=>{
    calls.push({url,request});let body=bytes,headers={'content-type':'application/octet-stream'},status=200;
    if(request.headers.Range){const [,start,end]=/bytes=(\d+)-(\d+)/.exec(request.headers.Range);body=bytes.subarray(Number(start),Number(end)+1);headers['content-range']=`bytes ${start}-${end}/${bytes.length}`;status=206;}
    headers['content-length']=String(body.length);
    return new Response(request.method==='HEAD'?null:body,{status,headers});
  });
  const manager=createCloudDownloads({cloudMaps,openListUrl:'https://files.example:5244',fetchImpl,...options});
  const server=http.createServer((req,res)=>manager.relay(req,res,new URL(req.url,'http://localhost').searchParams.get('name')));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  return {manager,calls,url:`http://127.0.0.1:${server.address().port}/?name=${encodeURIComponent('地图.vpk')}`};
}
test('cloud download URL allowlist rejects credentials, unrelated hosts and unsafe redirects',()=>{
  for(const url of ['http://cdn.baidupcs.com/f','https://cdn.baidupcs.com.evil.test/f','https://127.0.0.1/f','https://user:secret@cdn.baidupcs.com/f','https://cdn.baidupcs.com:1234/f','file:///secret'])assert.throws(()=>downloadUrl(url,'https://files.example:5244'));
  assert.equal(downloadUrl('https://files.example:5244/p/file','https://files.example:5244').port,'5244');
  assert.equal(downloadUrl('https://cdn.baidupcs.com/f','https://files.example:5244').protocol,'https:');
});
test('single ranges normalize suffixes and reject invalid or multiple ranges',()=>{
  assert.deepEqual(downloadRange('bytes=-4',12),{start:8,end:11,header:'bytes=8-11'});
  assert.deepEqual(downloadRange('bytes=4-',12),{start:4,end:11,header:'bytes=4-11'});
  for(const input of ['bytes=12-','bytes=3-1','bytes=-0','bytes=0-1,3-4','bytes=','bytes=999999999999999999999-'])assert.throws(()=>downloadRange(input,12),{status:416});
});
test('download metadata returns only file-scoped fields and selects Baidu request headers',async t=>{
  const f=await fixture(t);const info=await f.manager.info('地图.vpk');assert.equal(info.userAgent,'pan.baidu.com');assert.equal(info.referer,'https://pan.baidu.com/');assert.equal(info.direct,true);assert.equal(JSON.stringify(info).includes('must-not-return'),false);await assert.rejects(()=>f.manager.info('../secret'),{status:404});
});
test('map-card direct export requires a verified backup and refreshes its Baidu URL on demand',async()=>{
  let seenName='';
  const cloudMaps={
    listMaps:async refresh=>{assert.equal(refresh,true);return {serverFiles:[{id:'server.vpk',name:'server.vpk',backedUp:true}],files:[{name:'cloud.vpk',serverId:'server.vpk',verified:true}]}},
    downloadInfo:async name=>{seenName=name;return {name,size:bytes.length,url:'https://cdn.baidupcs.com/file?sign=fresh',provider:'BaiduNetdisk'}}
  };
  const manager=createCloudDownloads({cloudMaps,openListUrl:'https://files.example:5244'});
  const info=await manager.infoForServerPackage('server.vpk');
  assert.equal(seenName,'cloud.vpk');assert.equal(info.name,'server.vpk');assert.equal(info.direct,true);assert.equal(info.userAgent,'pan.baidu.com');assert.equal(info.referer,'https://pan.baidu.com/');assert.equal(JSON.stringify(info).includes('sign=fresh'),true);
  await assert.rejects(()=>manager.infoForServerPackage('../outside.vpk'),{status:400});
  const unbacked=createCloudDownloads({cloudMaps:{...cloudMaps,listMaps:async()=>({serverFiles:[{id:'server.vpk',name:'server.vpk',backedUp:false}],files:[]})},openListUrl:'https://files.example:5244'});
  await assert.rejects(()=>unbacked.infoForServerPackage('server.vpk'),{status:409});
});
test('legacy browser redirect refuses to navigate without extension verification',async t=>{
  let refreshed=0;
  const cloudMaps={listMaps:async()=>({serverFiles:[{id:'server.vpk',name:'server.vpk',backedUp:true}],files:[{name:'cloud.vpk',serverId:'server.vpk',verified:true}]}),downloadInfo:async name=>({name,size:bytes.length,url:`https://cdn.baidupcs.com/file?sign=${++refreshed}`,provider:'BaiduNetdisk'})};
  const manager=createCloudDownloads({cloudMaps,openListUrl:'https://files.example:5244'});
  const server=http.createServer((req,res)=>manager.redirectDirect(req,res,new URL(req.url,'http://localhost').searchParams.get('package')).catch(error=>{res.statusCode=error.status||500;res.end(error.message);}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const endpoint=`http://127.0.0.1:${server.address().port}/?package=server.vpk`;
  const response=await fetch(endpoint,{redirect:'manual'});assert.equal(response.status,409);assert.equal(response.headers.get('location'),null);assert.match(await response.text(),/1\.2\.0/);assert.equal(refreshed,0);
});
test('cloud backup is in Server Diagnostics and the cloud browser page is removed',()=>{
  const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8'),app=fs.readFileSync(path.join(root,'app.js'),'utf8');
  assert.doesNotMatch(html,/data-view="openlist"|id="openlistView"|id="cloudMapList"/);
  const diagnostics=html.slice(html.indexOf('id="diagnosticsView"'),html.indexOf('id="workshopView"'));
  for(const id of ['cloudBackupStatus','backupCloudMaps','toggleCloudBackup','stopCloudBackup'])assert.match(diagnostics,new RegExp(`id="${id}"`));
  assert.match(app,/直连下载导出（推荐）/);assert.match(app,/服务器下载导出/);assert.match(app,/requestDownloadHelper\('download'/);assert.match(app,/async function refreshCloudDirectInfo/);assert.doesNotMatch(app,/data-share-map|function shareMap\(/);
});
test('full download, HEAD and resume stream exact bytes with required Baidu headers and no service credential forwarding',async t=>{
  const f=await fixture(t);
  for(const method of ['GET','HEAD']){const r=await fetch(f.url,{method});assert.equal(r.status,200);assert.equal(r.headers.get('content-length'),String(bytes.length));assert.match(r.headers.get('content-disposition'),/filename\*=UTF-8''%E5%9C%B0%E5%9B%BE/);assert.deepEqual(Buffer.from(await r.arrayBuffer()),method==='HEAD'?Buffer.alloc(0):bytes);}
  const partial=await fetch(f.url,{headers:{Range:'bytes=4-7'}});assert.equal(partial.status,206);assert.equal(partial.headers.get('content-range'),'bytes 4-7/12');assert.deepEqual(Buffer.from(await partial.arrayBuffer()),bytes.subarray(4,8));
  assert.ok(f.calls.every(c=>c.request.headers['User-Agent']==='pan.baidu.com'&&c.request.headers.Referer==='https://pan.baidu.com/'&&!c.request.headers.authorization));assert.equal(f.manager.activeCount(),0);
  const invalid=await fetch(f.url,{headers:{Range:'bytes=99-'}});assert.equal(invalid.status,416);assert.equal(invalid.headers.get('content-range'),'bytes */12');
});
test('redirect is followed only to another allowed host with the required UA',async t=>{
  let calls=0;const f=await fixture(t,{fetchImpl:async(url,options)=>{assert.equal(options.headers['User-Agent'],'pan.baidu.com');assert.equal(options.headers.Referer,'https://pan.baidu.com/');calls++;return calls===1?new Response(null,{status:302,headers:{location:'https://other.baidupcs.com/file'}}):new Response(bytes,{headers:{'content-length':String(bytes.length)}});}});
  const r=await fetch(f.url);assert.equal(r.status,200);assert.deepEqual(Buffer.from(await r.arrayBuffer()),bytes);assert.equal(calls,2);
});
test('untrusted redirect, upstream refusal and wrong range never become successful VPKs',async t=>{
  for(const response of [()=>new Response(null,{status:302,headers:{location:'http://127.0.0.1/private'}}),()=>new Response('token=SECRET',{status:403}),()=>new Response('error',{headers:{'content-type':'text/html'}}),()=>new Response(bytes,{status:206,headers:{'content-range':'bytes 0-11/999'}})]){
    const f=await fixture(t,{fetchImpl:async()=>response()});const r=await fetch(f.url,{headers:{Range:'bytes=0-11'}});assert.equal(r.status,502);assert.equal((await r.text()).includes('SECRET'),false);assert.equal(f.manager.activeCount(),0);
  }
});
test('concurrency limits are released when a client disconnects',async t=>{
  let started;const ready=new Promise(resolve=>started=resolve);let upstreamAborted=false;
  const f=await fixture(t,{maxConcurrent:1,fetchImpl:async(url,{signal})=>{started();return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{upstreamAborted=true;reject(signal.reason);},{once:true}));}});
  const controller=new AbortController();const first=fetch(f.url,{signal:controller.signal}).catch(()=>null);await ready;
  const second=await fetch(f.url);assert.equal(second.status,429);await second.text();controller.abort();await first;
  for(let n=0;n<100&&f.manager.activeCount();n++)await new Promise(resolve=>setTimeout(resolve,10));assert.equal(f.manager.activeCount(),0);assert.equal(upstreamAborted,true);
});
test('declared oversized and truncated bodies fail instead of returning complete downloads',async t=>{
  const mismatch=await fixture(t,{fetchImpl:async()=>new Response(bytes,{headers:{'content-length':'999'}})});assert.equal((await fetch(mismatch.url)).status,502);
  const short=await fixture(t,{fetchImpl:async()=>new Response(bytes.subarray(0,4),{headers:{'content-type':'application/octet-stream'}})});
  await assert.rejects(async()=>{const r=await fetch(short.url);await r.arrayBuffer();});assert.equal(short.manager.activeCount(),0);
});
