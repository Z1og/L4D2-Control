const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),{PUBLIC_FILES}=require('../access control');
test('community artwork preserves distinct desktop and mobile proportions and uses real images',()=>{
  for(const [name,width,height] of [['desktop',1672,941],['mobile',941,1672]]){
    const png=fs.readFileSync(path.join(root,`assets/Project poster ${name}.png`));assert.equal(png.subarray(1,4).toString(),'PNG');assert.equal(png.readUInt32BE(16),width);assert.equal(png.readUInt32BE(20),height);
    const webp=fs.readFileSync(path.join(root,`assets/Project poster ${name}.webp`));assert.equal(webp.subarray(0,4).toString(),'RIFF');assert.equal(webp.subarray(8,12).toString(),'WEBP');assert.ok(webp.length<png.length);
  }
});
test('public community resources are individually allowed without opening private asset directories',()=>{
  for(const file of ['/project community.js','/project community.css','/assets/Project poster desktop.webp','/assets/Project poster mobile.webp']){assert.ok(PUBLIC_FILES.has(file));assert.ok(PUBLIC_FILES.has(encodeURI(file)));}
  for(const file of ['/assets/panel accounts.json','/assets/.env','/assets/unknown.png','/project community.js/extra'])assert.equal(PUBLIC_FILES.has(file),false);
});
test('published community number and gallery are consistent across both login roles and project documentation',()=>{
  for(const file of ['login.html','index.html','README.md','README Chinese.md','README English.md'])assert.match(fs.readFileSync(path.join(root,file),'utf8'),/1002677414/);
  for(const file of ['login.html','index.html']){const html=fs.readFileSync(path.join(root,file),'utf8');assert.equal((html.match(/id="projectAboutDialog"/g)||[]).length,1);assert.match(html,/data-group-fallback/);assert.match(html,file==='login.html'?/data-open-project/:/data-view="about"/);}
});

test('Steam guide lives only in its dialog and activity log lives inside server settings',()=>{
 const login=fs.readFileSync(path.join(root,'login.html'),'utf8'),form=login.slice(login.indexOf('id="ordinaryForm"'),login.indexOf('</form>'));assert.match(form,/id="openProfileGuide"/);assert.doesNotMatch(form,/<img|<details/);assert.equal((login.match(/id="openProfileGuide"/g)||[]).length,1);
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),settings=html.slice(html.indexOf('id="settingsView"'),html.indexOf('id="aboutView"'));assert.match(settings,/id="logPanel"/);assert.doesNotMatch(html,/id="logsView"|data-view="logs"|服务器自检/);assert.match(html,/服务检查/);
});

test('poster galleries provide previews without original download controls or public PNG routes',()=>{
 for(const file of ['login.html','index.html']){const html=fs.readFileSync(path.join(root,file),'utf8');assert.doesNotMatch(html,/data-project-download|poster-download|下载高清海报/);assert.match(html,/data-project-poster/);assert.match(html,/data-poster-format="desktop"/);assert.match(html,/data-poster-format="mobile"/);}
 for(const format of ['desktop','mobile']){const url='/assets/Project poster '+format+'.png';assert.equal(PUBLIC_FILES.has(url),false);assert.equal(PUBLIC_FILES.has(encodeURI(url)),false);}
 const js=fs.readFileSync(path.join(root,'project community.js'),'utf8');assert.doesNotMatch(js,/data-project-download|\.png|download\.href/);assert.match(js,/img\.src=item\.image/);
 assert.doesNotMatch(fs.readFileSync(path.join(root,'project about.js'),'utf8'),/查看与下载项目海报/);
});
