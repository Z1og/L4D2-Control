const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createAccess}=require('../access control'),{createAccounts,profileIdentity}=require('../panel accounts'),{requestIP,createRegions}=require('../ip regions');
const id='76561197960265729',password='independent test password';
const request=(method='GET',cookie='',bodyHeaders={})=>({method,headers:{host:'panel.example',...(cookie?{cookie}:{}),...bodyHeaders},socket:{remoteAddress:'192.0.2.10',encrypted:true}});
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;}});
function temp(t){const p=fs.mkdtempSync(path.join(os.tmpdir(),'Panel access test '));t.after(()=>fs.rmSync(p,{recursive:true,force:true}));return p;}
function post(cookie='',csrf=''){return request('POST',cookie,{'content-type':'application/json',origin:'https://panel.example','x-csrf-token':csrf});}
test('numeric profiles normalize without rounding; vanity, alternate hosts and injections fail',()=>{
 assert.equal(profileIdentity('https://steamcommunity.com/profiles/'+id+'/').steam64,id);
 for(const v of ['https://steamcommunity.com.evil.example/profiles/'+id,'https://steamcommunity.com/id/name',{},'1;quit'])assert.throws(()=>profileIdentity(v));
});
test('registration stores only salted hash, logs private IP, and custom password is required thereafter',async t=>{
 const dir=temp(t),regions=createRegions({lookup:()=> '中国|浙江省|杭州|ISP|CN'}),accounts=createAccounts({directory:dir,regions});
 const identity=await accounts.authenticate({profile:id,password,acceptPrivacy:true,nickname:'Test'},'192.0.2.10',true);
 assert.equal(identity.identityVerified,false);const raw=fs.readFileSync(path.join(dir,'panel accounts.json'),'utf8');assert.equal(raw.includes(password),false);
 assert.equal((await accounts.list())[0].lastLoginRegion.province,'浙江省');assert.equal('hash' in (await accounts.list())[0],false);
 assert.equal((await accounts.events())[0].action,'register');
 await assert.rejects(()=>accounts.authenticate({profile:id,password:'wrong-password'},'192.0.2.10'),/不正确/);
 await accounts.authenticate({profile:id,password},'192.0.2.10');assert.equal((await accounts.list())[0].loginCount,2);
 await assert.rejects(()=>accounts.authenticate({profile:id,password,acceptPrivacy:true},'',true),/已注册/);
});
test('registration needs disclosure consent; blocked IDs cannot register or log in',async t=>{
 let banned=false;const accounts=createAccounts({directory:temp(t),regions:createRegions(),isBanned:async()=>banned});
 await assert.rejects(()=>accounts.authenticate({profile:id,password},'',true),/说明/);
 banned=true;await assert.rejects(()=>accounts.authenticate({profile:id,password,acceptPrivacy:true},'',true),/拉黑/);
});
test('IP and audit retention expire after 30 days and bounded logs skip torn rows',async t=>{
 let now=Date.now();const dir=temp(t),accounts=createAccounts({directory:dir,regions:createRegions(),now:()=>now});
 await accounts.authenticate({profile:id,password,acceptPrivacy:true},'192.0.2.10',true);
 fs.appendFileSync(path.join(dir,'access logs',new Date(now).toISOString().slice(0,10)+'.jsonl'),'torn row\n');
 assert.equal((await accounts.events()).length,1);
 now+=32*86400000;await accounts.cleanup();assert.equal((await accounts.events()).length,0);
 assert.equal((await accounts.list())[0].lastLoginIp,undefined);assert.deepEqual(fs.readdirSync(path.join(dir,'access logs')),[]);
});
test('forwarded client IP is only accepted through explicitly trusted proxies',()=>{
 const req=request();req.headers['x-forwarded-for']='8.8.8.8, 192.0.2.11';
 assert.equal(requestIP(req), '192.0.2.10');assert.equal(requestIP(req,['192.0.2.10']), '192.0.2.11');
 assert.equal(requestIP(req,['192.0.2.10','192.0.2.11']),'8.8.8.8');
});
test('province service never exposes city and works without network/database',async()=>{
 let calls=0;const regions=createRegions({lookup:()=>{calls++;return '中国|广东省|深圳市|ISP|CN';}});
 assert.deepEqual(await regions.locate('203.0.113.10'),{country:'中国',province:'广东省',label:'中国 · 广东省',approximate:true});
 assert.equal((await regions.locate('127.0.0.1')).label,'内网 / 本机');assert.equal(calls,1);
 assert.equal((await createRegions().locate('203.0.113.10')).label,'未知省份');
});
test('ordinary session whitelist denies management, raw downloads, assets and CSRF-less mutations',async()=>{
 const access=createAccess({password:'admin-password',authenticateGuest:async()=>({steam64:id,name:'Test'})}),res=response();
 const session=await access.auth(post(),res,'/api/auth/guest',{}),cookie=res.headers['set-cookie'].split(';')[0];
 assert.match(res.headers['set-cookie'],/HttpOnly; SameSite=Strict/);assert.match(res.headers['set-cookie'],/Secure/);
 for(const url of ['/api/config','/api/status','/api/maps','/api/plugins','/api/gameplay','/api/broadcast','/'])assert.equal((await access.authorize(request('GET',cookie),url)).role,'guest');
 for(const url of ['/api/players','/api/proxy/export','/api/diagnostics','/api/maps/export','/api/openlist/download','/server.js','/mihomo/configs'])await assert.rejects(()=>access.authorize(request('GET',cookie),url),e=>e.status===403);
 for(const url of ['/api/gameplay','/api/map','/api/broadcast/save','/api/broadcast/delete','/api/broadcast/refresh'])await assert.rejects(()=>access.authorize(post(cookie,session.csrf),url),e=>e.status===403);
 await assert.rejects(()=>access.authorize(post(cookie),'/api/openlist/map-download-info'),/刷新/);
 assert.equal((await access.authorize(post(cookie,session.csrf),'/api/openlist/map-download-info')).role,'guest');
 for(let i=0;i<19;i++)await access.authorize(post(cookie,session.csrf),'/api/openlist/map-download-info');
 await assert.rejects(()=>access.authorize(post(cookie,session.csrf),'/api/openlist/map-download-info'),e=>e.status===429);
});
test('banning SteamID revokes existing sessions on next request',async()=>{
 let banned=false;const access=createAccess({authenticateGuest:async()=>({steam64:id}),isBanned:async()=>banned}),res=response();
 await access.auth(post(),res,'/api/auth/guest');const cookie=res.headers['set-cookie'].split(';')[0];
 banned=true;await assert.rejects(()=>access.authorize(request('GET',cookie),'/api/maps'),e=>e.status===401);
 banned=false;await assert.rejects(()=>access.authorize(request('GET',cookie),'/api/maps'),e=>e.status===401);
});
test('logout is final even when browser cached Basic credentials exist; ordinary cookie wins',async()=>{
 const access=createAccess({username:'admin',password:'admin-password',authenticateGuest:async()=>({steam64:id})}),res=response();
 const login=await access.auth(post(),res,'/api/auth/guest'),cookie=res.headers['set-cookie'].split(';')[0],authorization='Basic '+Buffer.from('admin:admin-password').toString('base64');
 assert.equal(access.identify(request('GET',cookie,{authorization})).role,'guest');
 const out=response();await access.auth(post(cookie,login.csrf),out,'/api/auth/logout');
 assert.equal(access.identify(request('GET',out.headers['set-cookie'].split(';')[0],{authorization})),null);
});
test('authorized login, expiry, same-origin and brute force limits',async()=>{
 let now=1000;const access=createAccess({username:'admin',password:'good',now:()=>now}),res=response();
 const s=await access.auth(post(),res,'/api/auth/login',{username:'admin',password:'good'}),cookie=res.headers['set-cookie'].split(';')[0];
 assert.equal((await access.authorize(post(cookie,s.csrf),'/api/gameplay')).role,'admin');
 await assert.rejects(()=>access.auth(request('POST','',{'content-type':'application/json',origin:'https://evil.example'}),response(),'/api/auth/login',{}),/来源/);
 now+=9*3600000;await assert.rejects(()=>access.authorize(request('GET',cookie),'/api/maps'),e=>e.status===401);
 for(let i=0;i<8;i++)await assert.rejects(()=>access.auth(post(),response(),'/api/auth/login',{}));
 await assert.rejects(()=>access.auth(post(),response(),'/api/auth/login',{username:'admin',password:'good'}),e=>e.status===429);
});
test('new login naming and no Steam authorization redirects',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../login.html'),'utf8'),js=fs.readFileSync(path.join(__dirname,'../login.js'),'utf8');
 assert.match(html,/授权登录/);assert.match(html,/普通登录/);assert.doesNotMatch(html,/游客登录|管理员登录/);assert.doesNotMatch(js,/openid|oauth/i);
});
