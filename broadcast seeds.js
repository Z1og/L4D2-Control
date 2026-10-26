const search = title => `https://steamcommunity.com/workshop/browse/?appid=550&searchtext=${encodeURIComponent(title)}&requiredtags%5B%5D=Campaigns`;
const classics = [
  ['back-to-school', '重返校园', 'Back to School', '长篇战役候选，适合预留完整时间组队游玩。下载时核对全部分包与必需项目。', ['长篇战役', '组队']],
  ['urban-flight', '城市航班', 'Urban Flight', '城市撤离题材战役候选，可作为好友联机的拓展路线。', ['城市', '战役']],
  ['suicide-blitz-2', '自杀闪电战 2', 'Suicide Blitz 2', '社区老牌战役候选，收录时请核对适用于 L4D2 的版本。', ['经典战役', '组队']],
  ['i-hate-mountains-2', '我恨山 2', 'I Hate Mountains 2', '山林题材社区战役候选，请核对版本及作者依赖说明。', ['山林', '探索']],
  ['day-break', '黎明', 'Day Break', '社区战役候选；同名项目较多，选择下载项前核对作者与介绍。', ['战役', '撤离']],
  ['warcelona', 'Warcelona', 'Warcelona', '以巴塞罗那为题材的社区战役候选，适合收录游玩体验与路线攻略。', ['城市', '战役']],
  ['yama', 'Yama', 'Yama', '日本题材社区战役候选，可关联路线、机关与补给点攻略。', ['日本题材', '探索']],
  ['dark-wood', '黑暗森林', 'Dark Wood', '森林题材社区战役候选，适合组队探索。具体难度以所选版本与游戏设置为准。', ['森林', '组队']]
].map(([id, title, english, summary, tags]) => ({ id: `classic-${id}`, kind: 'classic', title, english, summary, content: '', url: search(english), source: 'Steam 战役搜索', author: '', tags, map: english, pinned: false, publishedAt: null, updatedAt: null, linkType: 'search' }));

const guides = [
  ['install-map', '好友进服前，怎样安装同一套自定义地图？', '地图安装', '先确认服务器使用的战役名称、版本及完整分包。每位玩家在本地安装相同版本；工坊订阅要包含作者列出的必需项目，手动下载的 VPK 放进游戏 left4dead2/addons 目录。\n\n发现缺图或版本不一致时，先退出游戏，核对旧版与新版是否同时存在，再按作者说明处理重复包。面板的“直连下载导出”可分享已备份的服务器地图。', 'https://developer.valvesoftware.com/wiki/L4D2_Campaign_Add-on_Tutorial'],
  ['missing-texture', '出现紫黑贴图或 ERROR 模型，先检查什么？', '地图故障', '先看原地图说明中的必需项目，并确认全部分包已下载完成。再检查是否同时启用了修改相同资源的其他地图或模组。\n\n可以在面板“服务检查”中检查地图包资源冲突；检测到重名资源不等于一定会崩溃，需结合地图作者说明与游戏现象判断。保留原文件，逐个停用疑似冲突项后复测，并记录最终可用组合。', 'https://developer.valvesoftware.com/wiki/L4D2_Campaign_Add-on_Tutorial'],
  ['connect', '好友如何用连接地址进入游戏？', '联机', '从面板左上角复制 connect 命令，在游戏开发者控制台中执行。游戏需要启用开发者控制台，服务器必须运行且对应游戏端口可达。\n\n连不上时，先核对游戏地址和端口，再检查服务器进程、防火墙及服务器的准入设置。若已开启白名单，管理员需要先添加好友的 SteamID。不要把面板网页端口当成游戏端口。', 'https://developer.valvesoftware.com/wiki/Left_4_Dead_2/Dedicated_Server_Configuration'],
  ['multiplayer', '多人合作为什么不等于只修改人数上限？', '多人玩法', '扩展真人槽位、幸存者数量和 Bot 管理是不同环节。先在“平台管理”核对组件运行状态，再在“游戏模式”查看面板识别到的实际能力。\n\n不同多人插件的配置命令可能不同；不要直接套用其他整合包参数。修改模式或开局 Bot 数量后，可能需要切图才影响本局。记录可用的插件组合、平台版本与人数设置，方便以后复现。', 'https://github.com/accelerator74/l4dtoolz'],
  ['plugin-error', '插件在磁盘里，为什么游戏里不能用？', '插件排错', '文件存在只表示已安装，不代表 SourceMod 加载成功。在“服务检查”查看实际运行状态与失败原因，并核对插件依赖和平台版本。\n\n常见检查项包括依赖插件、扩展、gamedata 与游戏更新兼容性。先阅读插件作者说明，再处理明确的缺项；不要把客户端模组当作服务器 SourceMod 插件。', 'https://wiki.alliedmods.net/Managing_your_sourcemod_installation'],
  ['record-solution', '怎样记录一条以后还能复用的解决方案？', '问题记录', '建议记录：问题现象、游戏与平台版本、触发步骤、相关日志、实际解决操作，以及验证结果。\n\n不要写入账号密码、订阅链接、令牌、玩家 IP 或服务器私密配置。解决后补充适用版本和验证日期；版本更新后重新测试，再更新记录。', 'https://github.com/Z1og/L4D2-Control']
].map(([id, title, tag, content, url]) => ({ id: `builtin-${id}`, kind: 'qa', title, english: '', summary: content.split('\n')[0], content, url, source: '项目整理 · 参考资料', author: 'L4D2-Control', tags: [tag], map: '', pinned: false, publishedAt: null, updatedAt: null, verifiedAt: '', applicability: '按实际游戏、地图与插件版本核对', linkType: 'article' }));
module.exports = { classics, guides };
