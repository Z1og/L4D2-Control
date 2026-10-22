// L4D2-Control project identity: l4d2-control-bf312edc896c79baad5c | SPDX-License-Identifier: LicenseRef-L4D2-Control-NonCommercial-1.0
(() => {
  'use strict';
  const GROUP = '1002677414', dialog = document.getElementById('projectAboutDialog');
  const posters = {
    desktop: {image:'/assets/Project%20poster%20desktop.webp',alt:'L4D2-Control 电脑横版宣传海报，QQ 交流群 1002677414'},
    mobile: {image:'/assets/Project%20poster%20mobile.webp',alt:'L4D2-Control 手机竖版宣传海报，QQ 交流群 1002677414'}
  };
  let returnFocus = null;
  function selectPoster(format) {
    const item = posters[format]; if (!item || !dialog) return;
    const img=dialog.querySelector('[data-project-poster]');
    img.src=item.image;img.alt=item.alt;img.dataset.format=format;
    dialog.querySelectorAll('[data-poster-format]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.posterFormat===format)));
  }
  document.querySelectorAll('[data-open-project]').forEach(button=>button.addEventListener('click',()=>{
    if(!dialog || dialog.open)return;returnFocus=button;
    selectPoster(button.dataset.openProject || (matchMedia('(max-width: 980px)').matches?'mobile':'desktop'));
    dialog.showModal();dialog.querySelector('[data-close-project]').focus();
  }));
  dialog?.querySelector('[data-close-project]').addEventListener('click',()=>dialog.close());
  dialog?.addEventListener('close',()=>{if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});});
  dialog?.querySelectorAll('[data-poster-format]').forEach(button=>button.addEventListener('click',()=>selectPoster(button.dataset.posterFormat)));
  document.querySelectorAll('[data-copy-group]').forEach(button=>button.addEventListener('click',async()=>{
    if(button.disabled)return;button.disabled=true;
    const scope=button.closest('[data-community]'),status=scope?.querySelector('[data-community-status]'),fallback=scope?.querySelector('[data-group-fallback]');
    if(status)status.textContent='正在复制…';
    try{
      let copied=false;
      if(navigator.clipboard?.writeText){try{await navigator.clipboard.writeText(GROUP);copied=true;}catch{}}
      if(!copied){
        const field=document.createElement('textarea');field.value=GROUP;field.setAttribute('aria-hidden','true');field.style.cssText='position:fixed;left:-9999px;top:0;';
        const host=button.closest('dialog') || document.body;host.append(field);field.select();
        try{copied=typeof document.execCommand==='function'&&document.execCommand('copy');}catch{copied=false;}finally{field.remove();button.focus({preventScroll:true});}
      }
      if(copied){if(status)status.textContent='群号已复制，在 QQ 搜索群号即可加入。';if(fallback)fallback.hidden=true;}
      else {if(fallback){fallback.hidden=false;fallback.value=GROUP;fallback.focus();fallback.select();}if(status)status.textContent='未能自动复制，请复制下方群号后在 QQ 搜索加入。';}
    }finally{button.disabled=false;}
  }));
})();
