// L4D2-Control project identity: l4d2-control-bf312edc896c79baad5c | SPDX-License-Identifier: LicenseRef-L4D2-Control-NonCommercial-1.0
const fs=require('node:fs'),path=require('node:path');
const {computeFingerprint,inspectFingerprint}=require('./project fingerprint');
if(process.argv.slice(2).some(arg=>arg!=='--check')){console.error('Usage: node "Build project fingerprint.js" [--check]');process.exitCode=2;}
else if(process.argv.includes('--check')){const result=inspectFingerprint();console.log(JSON.stringify(result));if(result.integrity!=='verified')process.exitCode=1;}
else{const manifest=computeFingerprint(),file=path.join(__dirname,'Project fingerprint.json'),temporary=file+'.tmp';fs.writeFileSync(temporary,JSON.stringify(manifest,null,2)+'\n');fs.renameSync(temporary,file);console.log(JSON.stringify({projectId:manifest.projectId,fingerprint:manifest.fingerprint,files:manifest.files.length}));}
