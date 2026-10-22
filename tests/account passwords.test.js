const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createAccounts}=require('../panel accounts'),{createAccess}=require('../access control');
const id='76561197960265729',other='76561197960265730',original='fixture-old-password',next='fixture-new-password',reset='fixture-reset-password';
const body=(password=next)=>({newPassword:password,confirmPassword:password});
function fixture(t,options={}){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'Panel password test '));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const accounts=createAccounts({directory,regions:{locate:async()=>({label:'测试'})},...options});
 const access=createAccess({username:'admin',password:'fixture-admin-password',authenticateGuest:(b,ip,r)=>accounts.authenticate(b,ip,r),changeGuestPassword:(i,b)=>accounts.changePassword(i,b),resetGuestPassword:(i,b)=>accounts.resetPassword(i,b),validateGuestSession:s=>accounts.sessionCurrent(s),audit:e=>accounts.audit(e),...options});
 return {directory,accounts,access};
}
function req(cookie='',csrf='',extra={}){return {method:'POST',headers:{host:'panel.example',origin:'https://panel.example','content-type':'application/json',cookie,'x-csrf-token':csrf,...extra},socket:{remoteAddress:'192.0.2.10',encrypted:true}};}
async function auth(access,url,data={},session={},extra={}){const headers={},result=await access.auth(req(session.cookie,session.csrf,extra),{setHeader(k,v){headers[k]=v;}},url,data);return {...result,cookie:headers['set-cookie']?.split(';')[0]};}
const login=(a,profile=id,password=original)=>auth(a,'/api/auth/guest',{profile,password});
const register=(a,profile=id)=>auth(a,'/api/auth/register',{profile,password:original,nickname:'测试玩家',acceptPrivacy:true});
const admin=a=>auth(a,'/api/auth/login',{username:'admin',password:'fixture-admin-password'});
const read=(access,session)=>access.authorize({...req(session.cookie,session.csrf),method:'GET'},'/api/maps');
test('own password requires the current value and remains salted and persistent',async t=>{
 const {accounts,directory}=fixture(t);await accounts.authenticate({profile:id,password:original,acceptPrivacy:true},'',true);
 const file=path.join(directory,'panel accounts.json'),before=fs.readFileSync(file,'utf8');
 for(const payload of [{...body(),currentPassword:'incorrect-password'},{...body(),confirmPassword:'different-password',currentPassword:original},{...body('short'),currentPassword:original},{...body(original),currentPassword:original}])await assert.rejects(()=>accounts.changePassword(id,payload),e=>e.status===400);
 assert.equal(fs.readFileSync(file,'utf8'),before);
 await accounts.changePassword(id,{...body(),currentPassword:original});
 const after=JSON.parse(fs.readFileSync(file,'utf8')).accounts[id],old=JSON.parse(before).accounts[id];assert.notEqual(after.salt,old.salt);assert.notEqual(after.hash,old.hash);assert.ok(after.credentialVersion);assert.equal(after.name,old.name);
 const reopened=createAccounts({directory,regions:{locate:async()=>({})}});await assert.rejects(()=>reopened.authenticate({profile:id,password:original},''),e=>e.status===401);await reopened.authenticate({profile:id,password:next},'');
 for(const value of [original,next])assert.ok(!fs.readFileSync(file,'utf8').includes(value));const publicData=JSON.stringify(await reopened.list());assert.ok(!publicData.includes(after.hash));assert.ok(!publicData.includes(after.credentialVersion));
});
test('administrator reset needs confirmation and preserves bans and account identity',async t=>{
 let banned=false;const {accounts,directory}=fixture(t,{isBanned:async()=>banned});const identity=await accounts.authenticate({profile:id,password:original,nickname:'保留昵称',acceptPrivacy:true},'',true);
 const before=fs.readFileSync(path.join(directory,'panel accounts.json'),'utf8');await assert.rejects(()=>accounts.resetPassword(id,body(reset)),e=>e.status===400);assert.equal(fs.readFileSync(path.join(directory,'panel accounts.json'),'utf8'),before);
 await assert.rejects(()=>accounts.resetPassword(other,{confirmed:true}),e=>e.status===404);
 banned=true;await accounts.resetPassword(id,{confirmed:true});assert.equal(await accounts.sessionCurrent(identity),false);
 await assert.rejects(()=>accounts.authenticate({profile:id,password:reset},''),e=>e.status===403);banned=false;await assert.rejects(()=>accounts.authenticate({profile:id,password:reset},''),e=>e.status===409);assert.equal((await accounts.authenticate({profile:id,password:reset,acceptPrivacy:true,nickname:'不覆盖昵称'},'',true)).name,'保留昵称');
});
test('change password is bound to the current account and revokes every matching session',async t=>{
 const {accounts,access}=fixture(t),a=await register(access),b=await login(access),c=await register(access,other);
 await assert.rejects(()=>auth(access,'/api/auth/password',{...body(),currentPassword:original},a,{'x-csrf-token':''}),e=>e.status===403);
 await assert.rejects(()=>auth(access,'/api/auth/password',{...body(),currentPassword:original},a,{origin:'https://elsewhere.example'}),e=>e.status===403);
 const result=await auth(access,'/api/auth/password',{...body(),currentPassword:original,steamId:other},a);assert.equal(result.reauthenticate,true);assert.match(result.cookie,/signed-out/);
 for(const session of [a,b])await assert.rejects(()=>read(access,session),e=>e.status===401);assert.equal((await read(access,c)).role,'guest');
 await assert.rejects(()=>login(access,id,original),e=>e.status===401);await login(access,id,next);await login(access,other,original);
 const events=await accounts.events();assert.ok(events.some(e=>e.action==='password-change'&&e.target===id));assert.ok(!JSON.stringify(events).includes(next));
});
test('reset is administrator-only, CSRF protected and leaves other users and admin logged in',async t=>{
 const {access,accounts}=fixture(t),guest=await register(access),another=await register(access,other),manager=await admin(access),payload={steamId:id,confirmed:true};
 await assert.rejects(()=>auth(access,'/api/auth/reset-password',payload),e=>e.status===401);
 await assert.rejects(()=>auth(access,'/api/auth/reset-password',payload,guest),e=>e.status===403);
 await assert.rejects(()=>auth(access,'/api/auth/password',{...body(),currentPassword:original},manager),e=>e.status===403);
 await assert.rejects(()=>auth(access,'/api/auth/reset-password',payload,manager,{'x-csrf-token':''}),e=>e.status===403);
 await assert.rejects(()=>auth(access,'/api/auth/reset-password',{...payload,confirmed:false},manager),e=>e.status===400);
 assert.equal((await auth(access,'/api/auth/reset-password',payload,manager)).reauthenticate,false);
 await assert.rejects(()=>read(access,guest),e=>e.status===401);assert.equal((await read(access,another)).role,'guest');assert.equal((await read(access,manager)).role,'admin');
 await assert.rejects(()=>login(access),e=>e.status===409);await auth(access,'/api/auth/register',{profile:id,password:reset,acceptPrivacy:true});await login(access,id,reset);assert.ok((await accounts.events()).some(e=>e.action==='password-clear'&&e.target===id));
});
test('current password attempts are bounded across sessions and expire',async t=>{
 let clock=1000;const {access}=fixture(t,{now:()=>clock}),a=await register(access),b=await login(access);
 for(let i=0;i<8;i++)await assert.rejects(()=>auth(access,'/api/auth/password',{...body(),currentPassword:'incorrect-password'},i%2?a:b),e=>e.status===400);
 await assert.rejects(()=>auth(access,'/api/auth/password',{...body(),currentPassword:original},b),e=>e.status===429);
 clock+=15*60000+1;assert.equal((await auth(access,'/api/auth/password',{...body(),currentPassword:original},a)).ok,true);
});
test('a login racing a reset cannot retain a session for an old credential version',async t=>{
 const {accounts}=fixture(t);await accounts.authenticate({profile:id,password:original,acceptPrivacy:true},'',true);
 let release,ready;const gate=new Promise(r=>release=r),started=new Promise(r=>ready=r);
 const access=createAccess({authenticateGuest:async()=>{const identity=await accounts.authenticate({profile:id,password:original},'');ready();await gate;return identity;},validateGuestSession:s=>accounts.sessionCurrent(s)});
 const pending=login(access);await started;await accounts.resetPassword(id,{confirmed:true});release();const session=await pending;
 await assert.rejects(()=>read(access,session),e=>e.status===401);
});
test('password controls and registration action stay explicit and password data is not remembered',()=>{
 const root=path.join(__dirname,'..'),js=fs.readFileSync(path.join(root,'account password.js'),'utf8'),html=fs.readFileSync(path.join(root,'index.html'),'utf8'),login=fs.readFileSync(path.join(root,'login.html'),'utf8');
 assert.match(html,/passwordResetConfirm/);assert.match(js,/currentPassword/);assert.doesNotMatch(js,/localStorage|sessionStorage|console\.log/);assert.match(login,/registration-cta/);assert.match(login,/registrationLabel/);assert.match(login,/忘记面板密码/);
});

test('clear deletes only credentials, re-registration preserves history, notes and game permissions',async t=>{
 const {accounts,directory}=fixture(t);const identity=await accounts.authenticate({profile:id,password:original,nickname:'原有昵称',acceptPrivacy:true},'192.0.2.10',true);
 const file=path.join(directory,'panel accounts.json'),before=JSON.parse(fs.readFileSync(file)).accounts[id];
 const extra={note:'保留玩家备注',flags:'b',immunity:10,firstSeen:12345};const retained=path.join(directory,'independent player records.json');fs.writeFileSync(retained,JSON.stringify(extra));const bytes=fs.readFileSync(retained);
 await assert.rejects(()=>accounts.resetPassword(id,{...body(reset),confirmed:true}),e=>e.status===400);
 await accounts.resetPassword(id,{confirmed:true});const cleared=JSON.parse(fs.readFileSync(file)).accounts[id];assert.equal(cleared.hash,undefined);assert.equal(cleared.salt,undefined);assert.equal(cleared.registrationRequired,true);assert.equal(cleared.name,before.name);assert.equal(cleared.createdAt,before.createdAt);assert.equal(cleared.loginCount,before.loginCount);assert.equal(await accounts.sessionCurrent(identity),false);
 await accounts.authenticate({profile:id,password:next,nickname:'不能覆盖原有昵称',acceptPrivacy:true},'',true);const after=JSON.parse(fs.readFileSync(file)).accounts[id];assert.equal(after.name,before.name);assert.equal(after.createdAt,before.createdAt);assert.equal(after.loginCount,before.loginCount+1);assert.equal(after.registrationRequired,false);assert.ok(after.hash);assert.notEqual(after.salt,before.salt);assert.ok(fs.readFileSync(retained).equals(bytes));
 await assert.rejects(()=>accounts.authenticate({profile:id,password:next,acceptPrivacy:true},'',true),e=>e.status===409);
});
