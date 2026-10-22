// L4D2-Control project identity: l4d2-control-bf312edc896c79baad5c | SPDX-License-Identifier: LicenseRef-L4D2-Control-NonCommercial-1.0
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const repository = 'https://github.com/Z1og/L4D2-Control';
const PROJECT = Object.freeze({name:'L4D2-Control',chineseName:'今天一定要活下去',projectId:'l4d2-control-'+digest(repository).slice(0,20),repository,license:'LicenseRef-L4D2-Control-NonCommercial-1.0',copyright:'Copyright 2026 Z1og and original contributors'});
const SOURCE_FILES = Object.freeze(['access control.js','account password.js','app.js','index.html','login.html','login.js','login.css','panel accounts.js','players.js','server.js','styles.css','project fingerprint.js','Project identity.json','LICENSE','NOTICE.md','Build project fingerprint.js','assets/Steam profile guide.png','package.json'].sort());
function computeFingerprint(root = __dirname) {
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
module.exports={PROJECT,SOURCE_FILES,computeFingerprint,inspectFingerprint};
