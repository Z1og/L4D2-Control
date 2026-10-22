const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const {PROJECT,SOURCE_FILES,computeFingerprint,inspectFingerprint}=require('../project fingerprint');
test('release fingerprint matches the selected source and exposes no private deployment data',()=>{
 const result=inspectFingerprint();assert.equal(result.integrity,'verified');assert.match(result.sourceFingerprint,/^[a-f0-9]{64}$/);assert.equal(result.projectId,PROJECT.projectId);assert.equal(result.fileCount,SOURCE_FILES.length);
 for(const file of SOURCE_FILES)assert.ok(!/\.env|panel accounts\.json|node_modules|state|subscriptions/.test(file),file);
 assert.deepEqual(Object.keys(result).sort(),['chineseName','communityGroup','description','copyright','fileCount','integrity','license','name','projectId','releaseFingerprint','repository','schema','sourceFingerprint'].sort());
});
test('source modifications are detected and checking never silently rewrites the manifest',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'Provenance test '));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 for(const file of [...SOURCE_FILES,'Project fingerprint.json']){const dest=path.join(root,file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(__dirname,'..',file),dest);}
 const manifest=fs.readFileSync(path.join(root,'Project fingerprint.json'));assert.equal(inspectFingerprint(root).integrity,'verified');
 fs.writeFileSync(path.join(root,'.env'),'PRIVATE_NOT_PART_OF_FINGERPRINT');assert.equal(inspectFingerprint(root).integrity,'verified');
 fs.appendFileSync(path.join(root,'app.js'),'\n// explicit local modification\n');assert.equal(inspectFingerprint(root).integrity,'modified');
 const check=spawnSync(process.execPath,[path.join(root,'Build project fingerprint.js'),'--check'],{encoding:'utf8'});assert.equal(check.status,1);assert.ok(fs.readFileSync(path.join(root,'Project fingerprint.json')).equals(manifest));assert.ok(!check.stdout.includes('PRIVATE_NOT_PART_OF_FINGERPRINT'));
});
test('missing or malformed manifests report incomplete without disabling application code',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'Missing provenance '));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));assert.equal(inspectFingerprint(root).integrity,'incomplete');
 assert.throws(()=>computeFingerprint(root));assert.ok(!JSON.stringify(inspectFingerprint(root)).includes(root));
});
test('guide is a real image and source identifiers and license appear in shipped pages',()=>{
 const root=path.join(__dirname,'..'),png=fs.readFileSync(path.join(root,'assets/Steam profile guide.png'));assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
 for(const file of ['index.html','login.html']){const html=fs.readFileSync(path.join(root,file),'utf8');assert.ok(html.includes(PROJECT.projectId));assert.match(html,/name="l4d2-fingerprint"/);assert.match(html,/非商业使用/);}
 assert.match(fs.readFileSync(path.join(root,'login.html'),'utf8'),/profileGuideDialog/);assert.match(fs.readFileSync(path.join(root,'LICENSE'),'utf8'),/Commercial permission/);
});

test('official build refuses removed About attribution and changed community metadata',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'Attribution retention '));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 for(const f of [...SOURCE_FILES,'Project fingerprint.json']){const p=path.join(root,f);fs.mkdirSync(path.dirname(p),{recursive:true});fs.copyFileSync(path.join(__dirname,'..',f),p);}
 const original=fs.readFileSync(path.join(root,'index.html'),'utf8');fs.writeFileSync(path.join(root,'index.html'),original.replace('__L4D2_ABOUT_CONTENT__',''));assert.throws(()=>computeFingerprint(root),/About entry/);
 const attempt=spawnSync(process.execPath,[path.join(root,'Build project fingerprint.js')],{encoding:'utf8'});assert.equal(attempt.status,1);assert.match(attempt.stderr,/About entry/);
 fs.writeFileSync(path.join(root,'index.html'),original);const p=path.join(root,'Project identity.json'),identity=JSON.parse(fs.readFileSync(p));identity.communityGroup='changed';fs.writeFileSync(p,JSON.stringify(identity));assert.throws(()=>computeFingerprint(root),/communityGroup/);
});
test('server-rendered About uses built-in identity and treats untrusted provenance as text',()=>{
 const {renderProjectAbout}=require('../project about');const html=renderProjectAbout({name:'fake',communityGroup:'fake',sourceFingerprint:'<script>alert(1)</script>',integrity:'modified'});
 for(const v of [PROJECT.name,PROJECT.chineseName,PROJECT.repository,PROJECT.communityGroup])assert.ok(html.includes(v));assert.doesNotMatch(html,/<script>|fake/);assert.match(html,/请核对版本/);assert.match(html,/非商业使用 · 商用需授权/);
});
