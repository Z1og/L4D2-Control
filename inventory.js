const fs = require('fs');
const path = require('path');
const VPK = require('valve-vpk').default;
const { parse } = require('@node-steam/vdf');

const official = [
  ['死亡中心', 'Death Center'], ['黑色狂欢节', 'Dark Carnival'], ['沼泽激战', 'Swamp Fever'],
  ['暴风骤雨', 'Hard Rain'], ['教区', 'The Parish'], ['消逝', 'The Passing'],
  ['牺牲', 'The Sacrifice'], ['毫不留情', 'No Mercy'], ['坠机险途', 'Crash Course'],
  ['死亡丧钟', 'Death Toll'], ['寂静时分', 'Dead Air'], ['嗜血丰收', 'Blood Harvest'],
  ['冷流', 'Cold Stream'], ['最后一站', 'The Last Stand']
];
const chapterNames = {
  c1m1_hotel: '旅馆', c1m2_streets: '街道', c1m3_mall: '购物中心', c1m4_atrium: '中庭',
  c2m1_highway: '高速公路', c2m2_fairgrounds: '游乐场', c2m3_coaster: '过山车', c2m4_barns: '谷仓', c2m5_concert: '音乐会',
  c3m1_plankcountry: '乡间小路', c3m2_swamp: '沼泽', c3m3_shantytown: '棚户区', c3m4_plantation: '庄园',
  c4m1_milltown_a: '小镇', c4m2_sugarmill_a: '糖厂', c4m3_sugarmill_b: '糖厂回程', c4m4_milltown_b: '小镇回程', c4m5_milltown_escape: '逃离小镇',
  c5m1_waterfront: '河岸', c5m2_park: '公园', c5m3_cemetery: '墓地', c5m4_quarter: '街区', c5m5_bridge: '大桥',
  c6m1_riverbank: '河岸', c6m2_bedlam: '地下通道', c6m3_port: '港口',
  c7m1_docks: '码头', c7m2_barge: '驳船', c7m3_port: '港口',
  c8m1_apartment: '公寓', c8m2_subway: '地铁', c8m3_sewers: '下水道', c8m4_interior: '医院', c8m5_rooftop: '屋顶',
  c9m1_alleys: '小巷', c9m2_lots: '停车场',
  c10m1_caves: '洞穴', c10m2_drainage: '排水沟', c10m3_ranchhouse: '农庄', c10m4_mainstreet: '大街', c10m5_houseboat: '船屋',
  c11m1_greenhouse: '温室', c11m2_offices: '办公楼', c11m3_garage: '车库', c11m4_terminal: '航站楼', c11m5_runway: '跑道',
  c12m1_hilltop: '山顶', c12m2_traintunnel: '火车隧道', c12m3_bridge: '大桥', c12m4_barn: '谷仓', c12m5_cornfield: '玉米田',
  c13m1_alpinecreek: '高山溪谷', c13m2_southpinestream: '南松溪', c13m3_memorialbridge: '纪念大桥', c13m4_cutthroatcreek: '激流溪谷',
  c14m1_junkyard: '废车场', c14m2_lighthouse: '灯塔',
  msd1_town: '小镇', msd2_gasstation: '加油站', msdnew_tccity_newway: '城市新路', msd3_square: '广场'
};

function openVpk(file) {
  const vpk = new VPK(file);
  return vpk.load().then(() => vpk);
}

function closeVpk(vpk) {
  vpk.destroy();
  fs.closeSync(vpk.fileReader.fileDef);
}

function mapId(file) {
  const match = String(file).match(/(?:^|\/)maps\/([a-z0-9_]+)\.bsp$/i);
  return match?.[1]?.toLowerCase() || null;
}

function missionData(source) {
  const parsed = parse(source.replace(/^\uFEFF/, ''));
  const mission = parsed.mission || parsed.Mission || Object.values(parsed)[0] || {};
  const modes = mission.modes || mission.Modes || {};
  const coop = modes.coop || modes.Coop || {};
  const entries = Object.entries(coop).filter(([key]) => /^\d+$/.test(key)).sort((a, b) => Number(a[0]) - Number(b[0]));
  return {
    name: String(mission.DisplayTitle || mission.displaytitle || '自定义战役'),
    chapters: entries.map(([, value]) => ({
      id: String(value.Map || value.map || '').toLowerCase(),
      name: String(value.DisplayName || value.displayname || value.Map || value.map || '')
    })).filter(chapter => /^[a-z0-9_]+$/.test(chapter.id))
  };
}

async function mapInventory(serverRoot) {
  const gameRoot = path.join(serverRoot, 'left4dead2');
  const addonDir = path.join(gameRoot, 'addons');
  const gameDirs = fs.readdirSync(serverRoot).filter(name => name === 'update' || name.startsWith('left4dead2'));
  const base = new Set();
  for (const directory of gameDirs) {
    const mapDir = path.join(serverRoot, directory, 'maps');
    if (fs.existsSync(mapDir)) for (const file of fs.readdirSync(mapDir)) { const id = mapId(`maps/${file}`); if (id) base.add(id); }
    const gameVpk = path.join(serverRoot, directory, 'pak01_dir.vpk');
    if (!fs.existsSync(gameVpk)) continue;
    const vpk = await openVpk(gameVpk);
    try { for (const file of vpk.fileList) { const id = mapId(file); if (id) base.add(id); } }
    finally { closeVpk(vpk); }
  }
  const campaigns = official.map(([name, english], index) => {
    const prefix = `c${index + 1}m`;
    const chapters = [...base].filter(id => new RegExp(`^${prefix}\\d+_`).test(id) && !id.endsWith('_sndscape'))
      .sort((a, b) => Number(a.match(/^c\d+m(\d+)/)[1]) - Number(b.match(/^c\d+m(\d+)/)[1]))
      .map((id, chapterIndex) => ({ id, name: chapterNames[id] || id.split('_').slice(1).join(' ').replace(/\b\w/g, letter => letter.toUpperCase()), number: chapterIndex + 1 }));
    return { id: `c${index + 1}`, name, english, type: 'official', chapters };
  }).filter(campaign => campaign.chapters.length);
  const customMapIds = new Set();
  const addons = fs.existsSync(addonDir) ? fs.readdirSync(addonDir).filter(file => file.toLowerCase().endsWith('.vpk')) : [];
  for (const file of addons) {
    let vpk;
    try {
      vpk = await openVpk(path.join(addonDir, file));
      const present = new Set(vpk.fileList.map(mapId).filter(Boolean));
      const included = new Set();
      for (const missionFile of vpk.fileList.filter(entry => /^missions\/[^/]+\.txt$/i.test(entry))) {
        let mission;
        try { mission = missionData(vpk.readFileSync(missionFile).toString('utf8')); } catch { continue; }
        const chapters = mission.chapters.filter(chapter => present.has(chapter.id) || base.has(chapter.id));
        if (!chapters.length) continue;
        for (const chapter of chapters) { customMapIds.add(chapter.id); included.add(chapter.id); }
        campaigns.push({ id: `addon-${campaigns.length + 1}`, name: mission.name === 'Farewell Chenming' ? '告别晨茗' : mission.name, english: mission.name, type: 'custom', package: file,
          chapters: chapters.map((chapter, index) => ({ ...chapter, name: chapterNames[chapter.id] || chapter.name, number: index + 1 })) });
      }
      const remaining = [...present].filter(id => !included.has(id)).sort();
      if (remaining.length) {
        for (const id of remaining) customMapIds.add(id);
        campaigns.push({ id: `addon-${campaigns.length + 1}`, name: file.replace(/\.vpk$/i, ''), english: file, type: 'custom', package: file,
          chapters: remaining.map((id, index) => ({id, name: chapterNames[id] || id.replace(/_/g, ' '), number: index + 1})) });
      }
    } catch (error) {
      console.error(`Unable to inspect addon ${file}: ${error.message || error}`);
    } finally { if (vpk) closeVpk(vpk); }
  }
  const represented = new Set(campaigns.flatMap(campaign => campaign.chapters.map(chapter => chapter.id)));
  const standalone = [...base].filter(id => !represented.has(id) && !/(?:_sndscape$|^credits$|^curling_stadium$|^motionpriming|^navigationtest|^styleguide|^test_|^tutorial_|^zoo_)/i.test(id))
    .sort().map((id, index) => ({ id, name: id.replace(/_/g, ' '), number: index + 1 }));
  if (standalone.length) campaigns.push({ id: 'standalone', name: '其他地图', english: 'Standalone maps', type: 'other', chapters: standalone });
  return { campaigns, chapterCount: campaigns.reduce((sum, campaign) => sum + campaign.chapters.length, 0),
    scannedBaseMaps: base.size, customChapters: customMapIds.size, standaloneCount: standalone.length, addonCount: addons.length };
}

const pluginLabels = {
  'l4d2 control players': ['面板玩家采集', 'players'],
  adminmenu: ['管理菜单', 'admin'], adminhelp: ['管理员帮助', 'admin'], 'admin-flatfile': ['管理员权限', 'admin'],
  basecommands: ['基础命令', 'admin'], basebans: ['封禁管理', 'admin'], basecomm: ['聊天限制', 'admin'],
  basechat: ['基础聊天', 'admin'], basevotes: ['基础投票', 'vote'], funvotes: ['娱乐投票', 'vote'],
  l4d2_map_vote: ['地图投票', 'vote'], l4d2_nativevote: ['原生投票', 'vote'], map_changer: ['地图切换', 'vote'],
  reservedslots: ['预留位置', 'players'], playercommands: ['玩家管理', 'players'], bots: ['机器人管理', 'players'],
  l4d2_sv_maxplayers: ['扩展人数', 'players'], clientprefs: ['玩家偏好', 'players'],
  funcommands: ['娱乐指令', 'gameplay'], sounds: ['声音指令', 'gameplay'], rygive: ['物品发放', 'gameplay'],
  WeaponHandling: ['武器处理', 'gameplay'], l4d2_more_medical: ['医疗物资', 'gameplay'],
  left4dhooks: ['扩展接口', 'framework'], sourcescramble_manager: ['运行时管理', 'framework'],
  l4d2_source_keyvalues: ['配置解析支持', 'framework'], command_buffer: ['指令缓冲', 'framework'],
  'admin-sql-prefetch': ['SQL 管理员预加载', 'admin'], 'admin-sql-threaded': ['SQL 管理员查询', 'admin'], 'sql-admin-manager': ['SQL 管理员管理', 'admin'],
  mapchooser: ['地图选择器', 'vote'], nominations: ['地图提名', 'vote'], randomcycle: ['随机地图循环', 'vote'], rockthevote: ['发起换图投票', 'vote'],
  antiflood: ['聊天防刷屏', 'admin'], basetriggers: ['基础触发指令', 'admin'],
  l4d2_kick_survivor: ['幸存者管理', 'players'], l4d2_spotlight: ['探照灯效果', 'gameplay'],
  l4d2_vocalizebasedmodel: ['角色语音模型', 'gameplay'], survivor_chat_select: ['聊天选择角色', 'players'],
  l4d2_tickrate_enabler: ['游戏帧率优化', 'fix'], l4d2_acid_damage_fix: ['酸液伤害修复', 'fix'],
  l4d2_healthbuffer_fix: ['临时生命修复', 'fix'], l4d2_inputkill_block: ['自杀指令保护', 'fix'],
  l4d2_ladder_patch: ['梯子修复', 'fix'], l4d2_parseline_fix: ['配置解析修复', 'fix'],
  l4d2_transition_info_fix: ['关卡过渡修复', 'fix'], l4d2_weapon_drop_glow_fix: ['武器高亮修复', 'fix'],
  l4d2_witch_damage_fix: ['女巫伤害修复', 'fix'], l4d_reload_fix: ['换弹修复', 'fix'],
  l4d_revive_reload_interrupt: ['救援中断修复', 'fix'], transition_restore_fix: ['过渡状态修复', 'fix'],
  lfd_both_fixSG552: ['SG552 修复', 'fix'], Charger_Collision_patch: ['冲锋者碰撞修复', 'fix'], Defib_Fix: ['电击器修复', 'fix']
};
const categories = { admin: '管理权限', vote: '地图与投票', players: '玩家与人数', gameplay: '玩法与物品', fix: '修复与优化', framework: '框架依赖' };
function classifyPlugin(id) {
  const known = pluginLabels[id] || pluginLabels[id.toLowerCase()];
  if (known) return { name: known[0], type: known[1] };
  if (/fix|patch|restore|interrupt|tickrate|sg552/i.test(id)) return { name: `${id.replace(/_/g, ' ')} 修复`, type: 'fix' };
  if (/vote|nomination/i.test(id)) return { name: id.replace(/_/g, ' '), type: 'vote' };
  if (/admin|ban|flood|comm|trigger/i.test(id)) return { name: id.replace(/_/g, ' '), type: 'admin' };
  if (/survivor|kick|player|bot/i.test(id)) return { name: id.replace(/_/g, ' '), type: 'players' };
  return { name: id.replace(/_/g, ' '), type: 'gameplay' };
}
function pluginInventory(pluginPath) {
  const disabledPath = path.join(pluginPath, 'disabled');
  const list = [];
  for (const [folder, enabled] of [[pluginPath, true], [disabledPath, false]]) {
    if (!fs.existsSync(folder)) continue;
    for (const file of fs.readdirSync(folder).filter(name => name.toLowerCase().endsWith('.smx'))) {
      if (!fs.lstatSync(path.join(folder, file)).isFile() || fs.lstatSync(path.join(folder, file)).isSymbolicLink()) continue;
      const id = file.slice(0, -4);
      const label = classifyPlugin(id);
      list.push({ id, name: label.name, type: label.type, category: categories[label.type], enabled });
    }
  }
  return list.sort((a, b) => a.category.localeCompare(b.category, 'zh') || a.name.localeCompare(b.name, 'zh'));
}

module.exports = { mapInventory, pluginInventory, categories };
