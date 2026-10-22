const fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto');
const fail = (message, status = 409) => Object.assign(new Error(message), { status });
const MODES = [{id:'coop',name:'合作战役'},{id:'realism',name:'写实战役'},{id:'versus',name:'对抗模式'},{id:'survival',name:'生存模式'},{id:'scavenge',name:'清道夫模式'}];
const DIFFICULTIES = [{id:'Easy',name:'简单'},{id:'Normal',name:'普通'},{id:'Hard',name:'高级'},{id:'Impossible',name:'专家'}];
const VARS = ['mp_gamemode','z_difficulty','sv_maxplayers','sv_visiblemaxplayers','sv_allow_lobby_connect_only','bots_limit','bots_join_limit','bots_version'];
function cvarValue(output, name) {
  for(const line of String(output).split('\n')){
    const match = /\[SM\] Value of cvar "([a-z0-9_]+)": "([^"\r\n]*)"/i.exec(line) || /^\s*"([a-z0-9_]+)"\s*=\s*"([^"\r\n]*)"/i.exec(line);
    if(match?.[1] === name) return match[2];
  }
  return null;
}
function createGameplayController({capture, directory, onlineCount = async()=>0, now=Date.now}) {
  const file = path.join(directory,'gameplay.txt'); let busy=false;
  async function read() {
    const output = await capture([...VARS.map(name=>'sm_cvar '+name),'bots_limit','sv_maxplayers','sm plugins list']);
    const values = Object.fromEntries(VARS.map(name=>[name,cvarValue(output,name)]));
    if(!values.mp_gamemode || !values.z_difficulty) throw fail('未取得游戏实时设置，请确认 SourceMod 已加载');
    const engineMax = /"bots_limit"[^\n]*max\.\s*([\d.]+)/.exec(output), extensionMax=/"sv_maxplayers"[^\n]*max\.\s*([\d.]+)/.exec(output);
    const slotPlugin = output.split('\n').some(line=>/^\s*\d+\s+"l4d2_sv_maxplayers"/.test(line));
    const supported = slotPlugin && values.bots_version !== null && engineMax && extensionMax;
    const maxSlots = supported ? Math.min(31,Math.floor(+engineMax[1]),Math.floor(+extensionMax[1])) : 4;
    let saved=false;try{saved=(await fs.stat(file)).isFile();}catch(e){if(e.code!=='ENOENT')throw e;}
    return {mode:values.mp_gamemode,difficulty:values.z_difficulty,maxPlayers:values.sv_maxplayers===null?null:+values.sv_maxplayers,
      botCount:values.bots_limit===null?null:+values.bots_limit,allowDirect:values.sv_allow_lobby_connect_only==='0',maxPlayersSupported:Boolean(supported),
      maxSlots,modes:MODES,difficulties:DIFFICULTIES,saved,updatedAt:now(),values,
      capabilityMessage:supported?'已检测到扩展人数与 bots 插件；当前引擎支持最多 '+maxSlots+' 人':'未检测到可用的扩展人数 / bots 插件，人数设置不可修改'};
  }
  async function apply(body) {
    if(busy)throw fail('设置正在保存，请勿重复提交');
    if(!body||Array.isArray(body)||typeof body!=='object')throw fail('设置格式无效',400);
    if(body.confirmed!==true)throw fail('请先确认玩法变更',400);
    if(!MODES.some(x=>x.id===body.mode)||!DIFFICULTIES.some(x=>x.id===body.difficulty)||typeof body.allowDirect!=='boolean')throw fail('模式、难度或加入设置无效',400);
    if(typeof body.multiplayer!=='boolean')throw fail('多人设置无效',400);
    busy=true;
    try{
      const before=await read(), changes={mp_gamemode:body.mode,z_difficulty:body.difficulty,sv_allow_lobby_connect_only:body.allowDirect?'0':'1'};
      const cooperative=['coop','realism'].includes(body.mode);
      if(body.multiplayer&&!cooperative)throw fail('扩展多人设置仅用于合作或写实战役',400);
      if(body.multiplayer&&!before.maxPlayersSupported)throw fail(before.capabilityMessage);
      if(body.multiplayer){
        if(!Number.isInteger(body.maxPlayers)||body.maxPlayers<4||body.maxPlayers>before.maxSlots||!Number.isInteger(body.botCount)||body.botCount<1||body.botCount>body.maxPlayers)throw fail('人数须为 4–'+before.maxSlots+' 的整数；开局 Bot 数不能超过房间人数',400);
        changes.sv_maxplayers=String(body.maxPlayers);changes.sv_visiblemaxplayers=String(body.maxPlayers);changes.bots_limit=String(body.botCount);changes.bots_join_limit=String(body.maxPlayers);
      }else if(before.maxPlayersSupported){
        const slots=['versus','scavenge'].includes(body.mode)?8:4;
        changes.sv_maxplayers=String(slots);changes.sv_visiblemaxplayers=String(slots);changes.bots_limit='4';changes.bots_join_limit=cooperative?'4':'-1';
      }
      if(changes.sv_maxplayers && await onlineCount()>+changes.sv_maxplayers)throw fail('目标人数低于当前在线人数，请等待玩家离开后再调整');
      const changed=Object.entries(changes).filter(([key,value])=>before.values[key]!==value);
      for(const [key] of changed)if(before.values[key]===null)throw fail('游戏不支持设置 '+key);
      const original={};for(const [key] of changed)original[key]=before.values[key];
      const set = entries=>entries.map(([key,value])=>'sm_cvar '+key+' '+value);
      try{
        if(changed.length)await capture(set(changed));
        const after=await read();
        if(Object.entries(changes).some(([key,value])=>after.values[key]!==value))throw fail('游戏读回值不一致，可能被其他插件接管');
        await fs.mkdir(directory,{recursive:true,mode:0o700});
        const data='"PanelGameplay"\n{\n'+Object.entries(changes).map(([key,value])=>'  "'+key+'" "'+value+'"').join('\n')+'\n}\n';
        const temp=file+'.'+crypto.randomUUID()+'.tmp';
        try{await fs.writeFile(temp,data,{flag:'wx',mode:0o600});await fs.rename(temp,file);}finally{await fs.rm(temp,{force:true});}
        return {...after,values:undefined,saved:true,applied:true,requiresMapChange:before.mode!==body.mode,botCountDeferred:before.botCount!==after.botCount,
          message:'配置已保存并读回核验。模式与开局 Bot 数量请在下一次切图后核验。'};
      }catch(error){
        if(changed.length){try{await capture(set(Object.entries(original)));const restored=await read();if(Object.entries(original).some(([key,value])=>restored.values[key]!==value))throw Error('rollback mismatch');}catch{throw fail('保存失败且未确认恢复，请刷新并检查游戏控制台',502);}}
        throw error;
      }
    }finally{busy=false;}
  }
  return {read:async()=>{const result=await read();delete result.values;return result;},apply};
}
module.exports={createGameplayController,MODES,DIFFICULTIES,cvarValue};
