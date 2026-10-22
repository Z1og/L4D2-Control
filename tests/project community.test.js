const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),{PUBLIC_FILES}=require('../access control');
test('community artwork preserves distinct desktop and mobile proportions and uses real images',()=>{
  for(const [name,width,height] of [['desktop',1672,941],['mobile',941,1672]]){
    const png=fs.readFileSync(path.join(root,`assets/Project poster ${name}.png`));assert.equal(png.subarray(1,4).toString(),'PNG');assert.equal(png.readUInt32BE(16),width);assert.equal(png.readUInt32BE(20),height);
    const webp=fs.readFileSync(path.join(root,`assets/Project poster ${name}.webp`));assert.equal(webp.subarray(0,4).toString(),'RIFF');assert.equal(webp.subarray(8,12).toString(),'WEBP');assert.ok(webp.length<png.length);
  }
});
test('public community resources are individually allowed without opening private asset directories',()=>{
  for(const file of ['/project community.js','/project community.css','/assets/Project poster desktop.png','/assets/Project poster mobile.webp']){assert.ok(PUBLIC_FILES.has(file));assert.ok(PUBLIC_FILES.has(encodeURI(file)));}
  for(const file of ['/assets/panel accounts.json','/assets/.env','/assets/unknown.png','/project community.js/extra'])assert.equal(PUBLIC_FILES.has(file),false);
});
test('published community number and gallery are consistent across both login roles and project documentation',()=>{
  for(const file of ['login.html','index.html','README.md','README Chinese.md','README English.md'])assert.match(fs.readFileSync(path.join(root,file),'utf8'),/1002677414/);
  for(const file of ['login.html','index.html']){const html=fs.readFileSync(path.join(root,file),'utf8');assert.equal((html.match(/id="projectAboutDialog"/g)||[]).length,1);assert.match(html,/data-group-fallback/);assert.match(html,/data-open-project/);}
});
