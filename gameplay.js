let gameplayState=null,gameplayBusy=false;
function gameplayInputs(){
  const coop=['coop','realism'].includes($('#gameplayMode').value),supported=Boolean(gameplayState?.maxPlayersSupported);
  $('#gameplayMultiplayer').disabled=!coop||!supported;
  if(!coop)$('#gameplayMultiplayer').checked=false;
  const multi=coop&&supported&&$('#gameplayMultiplayer').checked;
  $('#gameplayMaxPlayers').disabled=$('#gameplayBotCount').disabled=!multi;
  $('#gameplayBotCount').max=String(Math.min(gameplayState?.maxSlots||4,Number($('#gameplayMaxPlayers').value)||4));
}
function renderGameplay(data){
  gameplayState=data;
  $('#gameplayMode').innerHTML=data.modes.map(x=>'<option value="'+escapeHtml(x.id)+'">'+escapeHtml(x.name)+'</option>').join('');
  if(!data.modes.some(x=>x.id===data.mode))$('#gameplayMode').insertAdjacentHTML('beforeend','<option value="" disabled selected>当前为其他模式：'+escapeHtml(data.mode)+'</option>');
  else $('#gameplayMode').value=data.mode;
  $('#gameplayDifficulty').innerHTML=data.difficulties.map(x=>'<option value="'+escapeHtml(x.id)+'">'+escapeHtml(x.name)+'</option>').join('');
  $('#gameplayDifficulty').value=data.difficulty;
  $('#gameplayMaxPlayers').max=String(data.maxSlots);
  $('#gameplayMaxPlayers').value=String(Math.max(4,data.maxPlayers||4));
  $('#gameplayBotCount').value=String(data.botCount||4);
  $('#gameplayMultiplayer').checked=['coop','realism'].includes(data.mode)&&data.maxPlayers>4;
  $('#gameplayAllowDirect').checked=data.allowDirect;
  $('#gameplayCapability').textContent=data.capabilityMessage;
  $('#gameplayStatus').textContent='读取于 '+new Date(data.updatedAt).toLocaleTimeString()+' · '+(data.saved?'已保存跨地图配置':'当前游戏实时配置，尚未保存本页设置');
  $('#gameplayFields').disabled=false;$('#reloadGameplayMap').disabled=false;
  gameplayInputs();
}
async function loadGameplay(){
  if(isGuest||gameplayBusy)return;gameplayBusy=true;$('#refreshGameplay').disabled=true;$('#gameplayFields').disabled=true;
  try{renderGameplay(await api('/api/gameplay'));}catch(error){gameplayState=null;$('#reloadGameplayMap').disabled=true;$('#gameplayStatus').textContent='读取失败：'+error.message;}
  finally{gameplayBusy=false;$('#refreshGameplay').disabled=false;}
}
$('#refreshGameplay').onclick=loadGameplay;
$('#gameplayMode').onchange=$('#gameplayMultiplayer').onchange=$('#gameplayMaxPlayers').oninput=gameplayInputs;
$('#gameplayForm').onsubmit=async event=>{
  event.preventDefault();if(gameplayBusy||!gameplayState||!$('#gameplayForm').reportValidity())return;
  const payload={mode:$('#gameplayMode').value,difficulty:$('#gameplayDifficulty').value,multiplayer:$('#gameplayMultiplayer').checked,maxPlayers:Number($('#gameplayMaxPlayers').value),botCount:Number($('#gameplayBotCount').value),allowDirect:$('#gameplayAllowDirect').checked,confirmed:true};
  if(!confirm('确认保存玩法设置？\n模式：'+$('#gameplayMode').selectedOptions[0].textContent+'\n难度：'+$('#gameplayDifficulty').selectedOptions[0].textContent+'\n'+(payload.multiplayer?'扩展多人：'+payload.maxPlayers+' 人，开局 '+payload.botCount+' 个 Bot':'标准房间人数')+'\n新模式和开局 Bot 数量在切图后生效。'))return;
  gameplayBusy=true;$('#gameplayFields').disabled=true;$('#refreshGameplay').disabled=true;
  try{const result=await post('/api/gameplay',payload);renderGameplay(result);$('#gameplayStatus').textContent=result.message;record('保存游戏模式与多人房间设置');toast('玩法设置已保存并核验');}
  catch(error){$('#gameplayStatus').textContent='未完成保存：'+error.message;toast('保存失败，请重新读取设置');gameplayState=null;$('#gameplayFields').disabled=true;}
  finally{gameplayBusy=false;$('#refreshGameplay').disabled=false;}
};
$('#reloadGameplayMap').onclick=async()=>{
  if(gameplayBusy||!gameplayState)return;
  try{const live=await api('/api/status');if(!live.mapConfirmed||!live.currentMap)throw Error('无法确认当前地图');
    if(!confirm('确认重载当前地图 '+live.currentMap+'？\n当前进度会丢失。请确认这张地图支持所选玩法。'))return;
    gameplayBusy=true;$('#reloadGameplayMap').disabled=true;await post('/api/map',{map:live.currentMap});record('重载地图以应用玩法设置');$('#gameplayStatus').textContent='切图请求已发送，请稍后读取实时设置确认。';
  }catch(error){toast(error.message);}finally{gameplayBusy=false;$('#reloadGameplayMap').disabled=false;}
};
