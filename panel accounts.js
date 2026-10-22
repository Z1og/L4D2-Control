// L4D2-Control project identity: l4d2-control-bf312edc896c79baad5c | SPDX-License-Identifier: LicenseRef-L4D2-Control-NonCommercial-1.0
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { steamIdentity } = require('./player manager');
const { normalizeIP } = require('./ip regions');
const scrypt = promisify(crypto.scrypt), RETENTION = 30 * 86400000;
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
function profileIdentity(value) {
  if (typeof value !== 'string' || value.length > 250) throw fail('请输入 Steam 数字资料链接或 SteamID64');
  const text = value.trim();
  if (/^\d{17}$/.test(text)) return steamIdentity(text);
  let url; try { url = new URL(text); } catch { throw fail('资料链接格式无效'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.hostname !== 'steamcommunity.com' || url.port || url.username || url.password || url.search || url.hash) throw fail('请使用 steamcommunity.com/profiles/数字 SteamID 的资料链接');
  const match = /^\/profiles\/(\d{17})\/?$/.exec(url.pathname);
  if (!match) throw fail('自定义 /id/ 短链接暂不支持，请填写数字资料链接或 SteamID64');
  return steamIdentity(match[1]);
}
function createAccounts({ directory, regions, isBanned = async () => false, now = Date.now } = {}) {
  const file = path.join(directory, 'panel accounts.json'), auditDir = path.join(directory, 'access logs'); let pending = Promise.resolve(), queued = 0;
  async function read() {
    let handle; try { handle = await fs.promises.open(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)); } catch (error) { if (error.code === 'ENOENT') return {version:1,accounts:{}}; throw error; }
    try { const stat = await handle.stat(); if (!stat.isFile() || stat.size > 8*1024*1024) throw fail('面板账号存储异常',503); const data=JSON.parse(await handle.readFile('utf8')); if(data.version!==1||!data.accounts||typeof data.accounts!=='object'||Array.isArray(data.accounts)) throw fail('面板账号存储异常',503); return data; } finally {await handle.close();}
  }
  async function write(data) {
    await fs.promises.mkdir(directory,{recursive:true,mode:0o700});
    for(const a of Object.values(data.accounts)) if(now()-(a.lastLoginAt||0)>RETENTION){delete a.lastLoginIp;delete a.lastLoginRegion;}
    const temp=file+'.'+crypto.randomUUID()+'.tmp';try{await fs.promises.writeFile(temp,JSON.stringify(data),{flag:'wx',mode:0o600});await fs.promises.rename(temp,file);}finally{await fs.promises.rm(temp,{force:true});}
  }
  function serial(fn){const job=pending.then(fn);pending=job.catch(()=>{});return job;}
  async function audit(event) {
    await fs.promises.mkdir(auditDir,{recursive:true,mode:0o700});
    const at=now(), date=new Date(at).toISOString().slice(0,10), ip=normalizeIP(event.ip),region=await regions.locate(ip);
    const row={at,actor:String(event.actor||'').slice(0,64),role:event.role==='admin'?'admin':'guest',steam64:event.steam64||'',action:String(event.action||'').slice(0,80),target:String(event.target||'').slice(0,250),ok:Boolean(event.ok),ip,region};
    await fs.promises.appendFile(path.join(auditDir,date+'.jsonl'),JSON.stringify(row)+'\n',{mode:0o600});
    for(const name of await fs.promises.readdir(auditDir)) if(/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)&&Date.parse(name.slice(0,10))<at-RETENTION)await fs.promises.rm(path.join(auditDir,name),{force:true});
  }
  function authenticate(payload,ip,register=false){if(queued>=16)return Promise.reject(fail('登录请求较多，请稍后再试',429));queued++;return serial(async()=>{
    const id=profileIdentity(payload.profile), password=payload.password;
    if(typeof password!=='string'||password.length<8||password.length>128)throw fail('面板密码需为 8–128 个字符，请勿使用 Steam 密码');
    if(await isBanned(id.steam64))throw fail('此 SteamID 已被拉黑，暂时禁止登录',403);
    const data=await read(), existing=data.accounts[id.steam64];let account;
    if(register){
      if(payload.acceptPrivacy!==true)throw fail('请阅读并勾选登录与记录说明');
      if(existing && existing.registrationRequired !== true)throw fail('该 SteamID 已注册，请使用原面板密码登录',409);
      if(!existing && Object.keys(data.accounts).length>=5000)throw fail('账号数量已达上限，请联系管理员',503);
      const salt=crypto.randomBytes(16).toString('hex'),hash=(await scrypt(password,salt,64,{N:16384,r:8,p:1,maxmem:64*1024*1024})).toString('hex');
      account=existing ? {...existing,...id,salt,hash,registrationRequired:false,credentialVersion:crypto.randomUUID(),reregisteredAt:now()} : {...id,name:String(payload.nickname||'').trim().slice(0,40)||'面板访客',salt,hash,createdAt:now(),identityVerified:false,registrationRequired:false};
    }else{
      if(existing?.registrationRequired===true)throw fail('该账号密码已清除，请点击“首次使用？设置面板密码”，使用同一 SteamID 重新注册',409);
      const salt=existing?.salt||'00000000000000000000000000000000';const actual=await scrypt(password,salt,64,{N:16384,r:8,p:1,maxmem:64*1024*1024});
      if(!existing||!/^[a-f0-9]{128}$/.test(existing.hash)||!crypto.timingSafeEqual(actual,Buffer.from(existing.hash,'hex')))throw fail('资料链接或面板密码不正确',401);account=existing;
    }
    account.lastLoginAt=now();account.lastLoginIp=normalizeIP(ip);account.lastLoginRegion=await regions.locate(account.lastLoginIp);account.loginCount=(account.loginCount||0)+1;
    data.accounts[id.steam64]=account;await write(data);
    await audit({actor:account.name,role:'guest',steam64:id.steam64,action:register?'register':'login',ok:true,ip});
    return {...id,name:account.name,identityVerified:false,credentialVersion:account.credentialVersion || ''};
  }).finally(()=>{queued--;});}
  function validatePasswordChange(payload) {
    if (!payload || typeof payload.newPassword !== 'string' || payload.newPassword.length < 8 || payload.newPassword.length > 128 || !payload.newPassword.trim()) throw fail('新密码需为 8–128 个字符，请勿使用 Steam 密码');
    if (payload.newPassword !== payload.confirmPassword) throw fail('两次输入的新密码不一致');
  }
  function updatePassword(steamId, payload, clear) {
    if (queued >= 16) return Promise.reject(fail('账号请求较多，请稍后再试',429));
    queued++;
    return serial(async () => {
      const identity=steamIdentity(steamId);
      if(clear){
        if(payload?.confirmed!==true)throw fail('请确认清除该普通账号密码，之后需要重新注册');
        if(payload.newPassword!==undefined||payload.confirmPassword!==undefined)throw fail('重置功能已改为清除密码，请刷新面板后重新操作');
      }else validatePasswordChange(payload);
      const data=await read(),account=data.accounts[identity.steam64];
      if(!account)throw fail('普通面板账号不存在，请刷新列表',404);
      if(clear){
        delete account.salt;delete account.hash;
        Object.assign(account,{registrationRequired:true,passwordClearedAt:now(),credentialVersion:crypto.randomUUID()});
      }else{
        if(await isBanned(identity.steam64))throw fail('此 SteamID 已被拉黑，暂时禁止登录',403);
        if(account.registrationRequired===true)throw fail('该账号密码已清除，请重新注册',409);
        if(typeof payload.currentPassword!=='string'||payload.currentPassword.length<8||payload.currentPassword.length>128)throw fail('当前密码不正确');
        const actual=await scrypt(payload.currentPassword,account.salt,64,{N:16384,r:8,p:1,maxmem:64*1024*1024});
        if(!/^[a-f0-9]{128}$/.test(account.hash)||!crypto.timingSafeEqual(actual,Buffer.from(account.hash,'hex')))throw fail('当前密码不正确');
        if(payload.newPassword===payload.currentPassword)throw fail('新密码不能与当前密码相同');
        const salt=crypto.randomBytes(16).toString('hex'),hash=(await scrypt(payload.newPassword,salt,64,{N:16384,r:8,p:1,maxmem:64*1024*1024})).toString('hex');
        Object.assign(account,{salt,hash,credentialVersion:crypto.randomUUID(),passwordChangedAt:now()});
      }
      await write(data);return {steam64:identity.steam64,registrationRequired:clear};
    }).finally(()=>{queued--;});
  }
  async function sessionCurrent(session) {
    const data = await read(), account = data.accounts[session.steam64];
    return Boolean(account && account.registrationRequired !== true && /^[a-f0-9]{128}$/.test(account.hash || '') && (account.credentialVersion || '') === (session.credentialVersion || ''));
  }
  const changePassword = (steamId, payload) => updatePassword(steamId, payload, false);
  const resetPassword = (steamId, payload) => updatePassword(steamId, payload, true);
  async function list(){const data=await read();return Object.values(data.accounts).map(({steam2,steam3,steam64,name,createdAt,lastLoginAt,lastLoginIp,lastLoginRegion,loginCount,registrationRequired})=>({steam2,steam3,steam64,name,createdAt,lastLoginAt,loginCount,registrationRequired:registrationRequired===true,identityVerified:false,...(now()-lastLoginAt<=RETENTION?{lastLoginIp,lastLoginRegion}:{})}));}
  async function events(limit=100){let names;try{names=await fs.promises.readdir(auditDir);}catch(error){if(error.code==='ENOENT')return [];throw error;}const rows=[];for(const name of names.filter(n=>/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(n)&&Date.parse(n.slice(0,10))>=now()-RETENTION).sort().reverse()){const handle=await fs.promises.open(path.join(auditDir,name),fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));let buf;try{const stat=await handle.stat();if(!stat.isFile())continue;const length=Math.min(stat.size,1024*1024),bytes=Buffer.alloc(length);await handle.read(bytes,0,length,stat.size-length);buf=bytes.toString('utf8');if(stat.size>length)buf=buf.slice(buf.indexOf('\n')+1);}finally{await handle.close();}for(const line of buf.trim().split('\n').reverse()){if(line){try{const row=JSON.parse(line);if(row.at>=now()-RETENTION)rows.push(row);}catch{}}if(rows.length>=limit)return rows;} }return rows;}
  function cleanup(){return serial(async()=>{const data=await read();if(Object.keys(data.accounts).length)await write(data);let names=[];try{names=await fs.promises.readdir(auditDir);}catch(e){if(e.code!=='ENOENT')throw e;}for(const name of names)if(/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)&&Date.parse(name.slice(0,10))<now()-RETENTION)await fs.promises.rm(path.join(auditDir,name),{force:true});});}
  return {authenticate,list,events,audit,cleanup,changePassword,resetPassword,sessionCurrent};
}
module.exports={createAccounts,profileIdentity};
