// L4D2-Control project identity: l4d2-control-bf312edc896c79baad5c | SPDX-License-Identifier: LicenseRef-L4D2-Control-NonCommercial-1.0
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const repository = 'https://github.com/Z1og/L4D2-Control';
const PROJECT = Object.freeze({name:'L4D2-Control',chineseName:'今天一定要活下去',projectId:'l4d2-control-'+digest(repository).slice(0,20),repository,license:'LicenseRef-L4D2-Control-NonCommercial-1.0',copyright:'Copyright 2026 Z1og and original contributors',communityGroup:'1002677414',description:'面向求生之路 2 好友联机的服务器管理面板，集中管理地图、插件、玩家与服务器状态，让开服和分享地图更方便。'});
const SOURCE_FILES = Object.freeze(['project about.js','access control.js','account password.js','panel dialogs.js','app.js','index.html','login.html','login.js','login.css','panel accounts.js','players.js','player manager.js','player whitelist.js','platform manager.js','platform versions.js','platforms.js','server.js','sourcemod/L4D2 Control Players.sp','styles.css','project fingerprint.js','Project identity.json','LICENSE','NOTICE.md','Build project fingerprint.js','assets/Steam profile guide.png','package.json',"project community.js","project community.css","assets/Project poster desktop.png","assets/Project poster mobile.png","assets/Project poster desktop.webp","assets/Project poster mobile.webp","assets/Project mobile banner.webp"].sort());
function validateAttribution(root = __dirname) {
  const identity=JSON.parse(fs.readFileSync(path.join(root,'Project identity.json'),'utf8'));
  for(const [key,value] of Object.entries(PROJECT))if(identity[key]!==value)throw Error('Project attribution mismatch: '+key);
  const index=fs.readFileSync(path.join(root,'index.html'),'utf8'),login=fs.readFileSync(path.join(root,'login.html'),'utf8');
  if(!/id="aboutView"/.test(index)||!index.includes('__L4D2_ABOUT_CONTENT__')||!/<button class="nav-item" data-view="about">/.test(index))throw Error('Required project About entry is missing');
  for(const html of [index,login])if(!html.includes(PROJECT.projectId)||!html.includes(PROJECT.repository)||!html.includes(PROJECT.license)||!html.includes('__L4D2_ABOUT_SUMMARY__'))throw Error('Required page attribution is missing');
  for(const file of ['LICENSE','NOTICE.md'])if(!fs.readFileSync(path.join(root,file),'utf8').includes(PROJECT.name))throw Error('Required license attribution is missing');
  return true;
}
function computeFingerprint(root = __dirname) {
  validateAttribution(root);
  const base=fs.realpathSync(root);
  const files=SOURCE_FILES.map(file=>{
    const target=path.join(root,file),stat=fs.lstatSync(target),relative=path.relative(base,fs.realpathSync(target));
    if(stat.isSymbolicLink()||!stat.isFile()||stat.size>8*1024*1024||relative.startsWith('..')||path.isAbsolute(relative))throw Error('Invalid project source: '+file);
    return {path:file,sha256:digest(fs.readFileSync(target))};
  });
  return {schema:1,projectId:PROJECT.projectId,fingerprint:digest(files.map(file=>file.path+'\0'+file.sha256).join('\n')),files};
}
function inspectFingerprint(root = __dirname) {
  const result={...PROJECT,schema:1,sourceFingerprint:null,releaseFingerprint:null,integrity:'incomplete',fileCount:SOURCE_FILES.length};
  try {
    const actual=computeFingerprint(root);result.sourceFingerprint=actual.fingerprint;
    const filename=path.join(root,'Project fingerprint.json'),stat=fs.lstatSync(filename);
    if(stat.isSymbolicLink()||!stat.isFile()||stat.size>65536)return result;
    const release=JSON.parse(fs.readFileSync(filename,'utf8'));
    if(release.schema!==1||release.projectId!==PROJECT.projectId||!/^[a-f0-9]{64}$/.test(release.fingerprint))return result;
    result.releaseFingerprint=release.fingerprint;
    result.integrity=release.fingerprint===actual.fingerprint&&JSON.stringify(release.files)===JSON.stringify(actual.files)?'verified':'modified';
  } catch {}
  return result;
}
module.exports={PROJECT,SOURCE_FILES,computeFingerprint,inspectFingerprint,validateAttribution};
