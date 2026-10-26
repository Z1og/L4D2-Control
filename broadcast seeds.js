const { classics } = require('./broadcast classics');

const references = {
  steam: ['Steam 官方 · 文件完整性', 'https://help.steampowered.com/en/faqs/view/0C48-FCBD-DA71-93EB'],
  sm: ['SourceMod 官方 Wiki · 安装与排错', 'https://wiki.alliedmods.net/Managing_your_sourcemod_installation'],
  install: ['SourceMod 官方 Wiki · 安装核验', 'https://wiki.alliedmods.net/Installing_SourceMod'],
  upgrade: ['SourceMod 官方 Wiki · 升级说明', 'https://wiki.alliedmods.net/Upgrading_SourceMod'],
  meta: ['MetaMod 官方 Wiki · 安装说明', 'https://wiki.alliedmods.net/Installing_Metamod:Source'],
  admins: ['SourceMod 官方 Wiki · 管理员权限', 'https://wiki.alliedmods.net/Adding_Admins_(SourceMod)'],
  toolz: ['L4DToolZ 上游 · 人数配置', 'https://github.com/accelerator74/l4dtoolz'],
  journal: ['systemd 官方 · journalctl', 'https://www.freedesktop.org/software/systemd/man/latest/journalctl.html'],
  service: ['systemd 官方 · 服务退出与重启', 'https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html'],
  core: ['systemd 官方 · 崩溃转储', 'https://www.freedesktop.org/software/systemd/man/latest/coredumpctl.html'],
  oom: ['Linux 内核文档 · 内存事件', 'https://docs.kernel.org/admin-guide/cgroup-v2.html'],
  panel: ['项目实现 · 服务检查与管理流程', 'https://github.com/Z1og/L4D2-Control'],
  school: ['小黑盒 · 地图故障经验', 'https://www.xiaoheihe.cn/app/bbs/link/157363488']
};
// Console commands below are instructions for the reader, never executed by catalogue loading.
const rows = [
  ['install-map', '缺少自定义地图：好友怎样装齐同一套地图？', ['地图安装', '缺图'], '先统一战役版本和完整分包，再区分工坊包、手动 VPK 与松散 BSP；服务器地图不能代替玩家本地安装。', '服务器和所有参与玩家；第三方战役', 'panel', [
    '进服提示缺图，或好友看不到相同战役。',
    '记录服务器实际章节名和地图作者的发布版本，核对作者列出的全部 Part 与必需内容。相同中文名不代表同一包。',
    '退出游戏后，将同版本完整 VPK 放入客户端 left4dead2/addons；工坊方式等待所有分包下载完成。服务器也保留相同版本。暂时移出同地图的旧手动包，避免与工坊版本同时挂载。面板“直连下载导出”可取已备份地图；松散 BSP 包按作者目录结构安装。',
    '所有人从相同首章进入，完成一次跨章；只看下载完成或地图列表出现不足以验证。'
  ]],
  ['missing-texture', '紫黑贴图、ERROR 模型：怎样区分缺资源与模组冲突？', ['地图故障', '贴图', '模组冲突'], '先用完整地图包和最小模组组合复现，再修复明确缺失的资源；验证游戏文件不会补齐第三方依赖。', '客户端画面异常；Steam 版 L4D2', 'steam', [
    '地面紫黑、物体显示 ERROR，或只有部分玩家出现。',
    '先比较同一位置的其他玩家；只有自己异常时优先查客户端。核对地图分包、作者依赖和本地重复旧包；记录控制台报出的具体材料或模型路径。',
    '退出游戏，暂时停用该地图以外的附加内容后重试。缺第三方资源时按地图作者说明补齐；只有无附加包的官图也缺资源时，使用 Steam → 属性 → 已安装文件 → 验证游戏文件完整性。',
    '回到原出错位置并跨章复测，再分批恢复其他模组。若最小组合仍有同一路径缺失，把路径和版本反馈给地图作者。'
  ]],
  ['connect', '进不了服务器：先分清地址、端口、准入与网络', ['联机', '连接失败'], '游戏端口与面板网页端口不同；按报错区分网络不通、版本不一致、白名单或密码拒绝。', '好友通过公网连接游戏；只排查已获授权的服务器', 'panel', [
    'connect 超时，或收到密码、封禁、白名单等明确拒绝。',
    '从面板复制实际 connect 地址。检查游戏进程是否运行；若能收到明确拒绝，说明请求已抵达某个游戏服务，继续处理对应准入条件。',
    '超时时检查服务器监听的游戏 UDP 端口、云安全组和主机防火墙是否一致；不要用网页端口代替。白名单或封禁由服主在玩家管理中核对实际 SteamID；版本报错则先更新客户端和服务器。',
    '由公网好友实际加入并保持一局；网页能打开或 TCP 端口测试通过，都不能单独证明游戏 UDP 连接正常。'
  ]],
  ['multiplayer', '多人房间只有四个角色：人数、真人槽位与 Bot 分开排查', ['多人玩法', '依赖'], 'L4DToolZ 解锁真人槽位，与生成额外幸存者是两个环节；先确认实际加载的组件版本。', '合作模式多人服务器；各 L4DToolZ 分支命令以其发布说明为准', 'toolz', [
    '面板显示支持多人，但第五人进不来，或进来后没有可接管角色。',
    '在游戏服务端控制台查看 meta list、plugin_print、sm plugins list，并在游戏模式页核对实际能力。先判断卡在“无法连接”还是“没有角色”。',
    '使用已加载分支支持的人数命令。上游 MetaMod 版提供 sv_maxplayers；额外 Bot 需要相应生成或管理插件。保留一套人数控制方案，停用功能重叠的另一套；不要把原生版与 MetaMod 版配置直接混用。',
    '切图或按组件说明重启游戏后，让第五名真人实际加入并接管角色；仅看到人数上限变化不算完成。'
  ]],
  ['plugin-error', '插件文件存在却不能用：先取到加载失败的原文', ['插件排错', '日志'], '用服务端 sm plugins list 与 sm plugins info 定位失败原因，磁盘文件不等于正在运行。', '已安装 SourceMod 的游戏服务器', 'sm', [
    'SMX 显示已安装，但命令无效、菜单缺项或状态为 Failed。',
    '在游戏服务端控制台运行 sm plugins list，记下失败编号，再运行 sm plugins info PLUGIN_ID（用实际编号替换 PLUGIN_ID）。同时看 addons/sourcemod/logs/error_*.log 对应时间段。',
    '按错误分流：Native 缺失查提供者；translation 缺失补语言文件；gamedata/signature 错误核对版本；Wrong game 停用不适用插件。SourcePawn 源码 .sp 不会替代已编译 .smx。',
    '加载列表中目标插件不再 Failed，实际触发其功能，并确认同一错误不再新增。保留完整错误行，避免只截图最后一句。'
  ]],
  ['record-solution', '提交可复现的故障记录：需要哪些信息？', ['问题记录', '日志'], '保留准确时间、触发动作、组件版本、第一条错误与可用组合，让修复能够复测。', '客户端、游戏服务器与面板问题', 'sm', [
    '故障偶发，或换了插件后暂时好了但无法确认原因。',
    '记录最后正常时间、首次异常时间、涉及地图/章节与操作；列出游戏版本、meta version、sm version、sm plugins list 相关项及近期改动。',
    '保存首次错误前后的完整日志；每次只变更一个因素，比较官图与问题图、最小组合与完整组合。分享前去掉 RCON 密码、令牌、订阅、玩家 IP 和私有配置。崩溃转储只交给可信维护者。',
    '按原步骤至少再次复现或确认不再出现，写清仍存在的限制。只读文档不填写“实机验证日期”；实际复测后由管理员填写。'
  ]],
  ['addon-conflict', '附加包资源同名：怎样找出真正冲突的组合？', ['模组冲突', '地图故障'], '同路径是冲突线索；用最小组合和分组排除验证，不能按冲突条数直接删除地图。', 'VPK 地图与客户端模组；服务器扫描只覆盖服务器文件', 'panel', [
    '换模组后贴图、声音、脚本或地图行为异常。',
    '在服务检查查看重复资源路径及所属包。当前扫描主要覆盖含 BSP 的地图包，不是所有客户端皮肤/脚本的完整检测；未扫描和无法读取项不能视为无冲突。',
    '先保留问题地图完整分包，停用其他包确认最小组合。按资源路径优先检查脚本/同名 BSP，再将其余模组分成两组逐步恢复，找到最小可复现冲突对；保留原文件，不直接批量删除。',
    '同一地图、同一章节和同一操作下，单独启用 A、单独启用 B 正常，而 A+B 稳定异常，才可确认该组合冲突；记录最终保留项。'
  ]],
  ['duplicate-map-version', '地图更新后异常：手动包与工坊旧版重复', ['地图安装', '版本不一致'], '同时挂载旧版和新版会覆盖同名内容；统一来源和版本后跨章验证。', '同一战役既订阅工坊又手动放过 VPK', 'panel', [
    '更新后缺图、章节不一致，或只有部分人加载失败。',
    '比较 left4dead2/addons 与 addons/workshop 中相同战役的包；先核对作者、版本和 Part，不按文件名相似就删除。',
    '退出游戏，取消旧来源的订阅或移出手动旧包，只保留一套完整版本；所有玩家与服务器同步更新。必需 Part 之间有资源交集可能是作者设计，不应只留第一包。',
    '重新启动游戏，从首章进入并切换到此前失败章节；需要时比较双方文件哈希确认相同字节。'
  ]],
  ['map-not-found', 'Map not found / Missing map：列表有地图也不能加载', ['缺图', '服务器'], '先核对实际 BSP 章节名和服务器安装目录，不用中文战役名代替地图命令。', '服务器启动或切图报告缺图', 'panel', [
    '地图卡片存在，但启动或切图报告 Missing map、Map not found。',
    '查看服务端原始错误中的 MAP_NAME；在地图管理确认这个具体章节，不把战役标题或 VPK 文件名当作 BSP 名。',
    '确认安装到正在运行的游戏实例 left4dead2 目录，补齐全部地图分包；Linux 同时核对大小写和文件读取权限。包损坏则从相同作者来源重新取得后替换该包。',
    '让服务端加载同一个 MAP_NAME，并让客户端实际加入；只看到目录有 VPK 不足以证明包内含该 BSP。'
  ]],
  ['consistency-mismatch', 'Server is enforcing consistency：怎样处理文件不一致？', ['版本不一致', '模组冲突'], '按错误列出的文件定位客户端替换模组或服务端定制资源，优先恢复相同文件。', '连接时出现一致性检查拒绝', 'steam', [
    '进服被踢，并显示具体模型或其他文件不一致。',
    '保存完整文件路径，确认是否来自武器、角色、Tank 模型或地图附带资源；比较使用干净客户端的好友能否进入。',
    '客户端退出游戏后先停用修改该路径的模组；服务器有定制内容时统一版本。官图的原始资源也有问题时再验证游戏完整性。不要把全局关闭一致性检查当作通用修复，它会掩盖资源差异。',
    '重新连接并实际走到相关模型出现的位置；确认没有再次因同一路径被踢，也没有隐身模型或客户端崩溃。'
  ]],
  ['client-crash', '只有一个玩家闪退：先修客户端最小组合', ['客户端闪退', '模组冲突'], '单客户端退出而其他人继续游戏时，优先排查该玩家的附加内容与原始游戏文件。', 'Windows Steam 客户端；服务器仍在线', 'steam', [
    '某个玩家回到桌面，其他人仍在同一局。',
    '记录其崩溃时间、章节和画面位置，比较其他玩家；退出游戏后停用非必需附加内容，以相同地图重试。',
    '最小组合正常则逐批恢复模组，找出触发项；最小组合下官图也闪退时，在 Steam 验证完整性，再检查系统应用程序错误记录、显卡驱动与覆盖层的对应证据。验证不会移除所有第三方文件。',
    '同一场景重复游玩并跨章；一次偶然未闪退不能确认修复。若仍失败，提供应用错误中的模块名和版本给维护者。'
  ]],
  ['crash-location', '客户端闪退还是服务器崩溃：先确定谁退出了', ['客户端闪退', '服务器闪退', '日志'], '用游戏 PID、服务退出记录与受影响玩家范围区分故障，避免拿客户端修复处理服务器退出。', '任何突然断线或回桌面的情形', 'journal', [
    '有人闪退，或全员同时掉线，但面板网页仍能打开。',
    '单个客户端退出且其他人继续玩：走客户端排查。所有人掉线：检查游戏 PID 是否消失或变更、游戏服务退出时间；网页进程与游戏进程独立。',
    '服务端退出走“服务器突然退出”条目；PID 持续不变但全员卡住时先查网络、CPU 与磁盘等待。若当前没有日志，不把“网页在线”当作游戏在线的证据。',
    '保留断线时间与进程/服务记录，使受影响范围和日志时间相互吻合后再实施对应修复。'
  ]],
  ['chapter-crash', '只在换章节时服务器退出：如何定位地图或插件？', ['服务器闪退', '切图', '模组冲突'], '官图与问题章节对照，再用地图完整分包和最小插件组合判断触发层。', '特定地图、章节或救援后稳定复现', 'sm', [
    '同一张图过关或切到指定章节时游戏进程退出。',
    '记录目标 BSP 名、最后一条游戏日志及退出信号；先验证完整地图版本和分包。备份当前配置后，在测试实例比较官图换章。',
    '若官图正常，仅问题图失败，保留完整地图并暂时停用非必需插件/其他地图包；若最小组合仍失败，检查地图作者修复和依赖。最小组合正常时分组恢复插件，定位最小触发组合。',
    '实际重复同一过关/换章路径，确认目标章节可加载并可加入；不要只测直接进入首章，也不把更换地图误记为修好了原图。'
  ]],
  ['sm-unknown-command', 'Unknown command: sm 或 meta：平台根本没加载', ['平台管理', '插件排错'], '先核对 MetaMod，再核对 SourceMod，避免反复安装业务 SMX。', '在游戏服务端控制台执行命令；不是客户端普通控制台', 'install', [
    '服务端不认识 sm，或 meta list 没有响应。',
    '运行 meta version、meta list。meta 不存在先查 MetaMod；meta 正常但列表没有 SourceMod 时，查 addons/metamod/sourcemod.vdf 与 SourceMod 文件位置。',
    '按游戏和操作系统安装对应平台包到实际游戏目录。NOFILE/FAILED 时用 meta info PLATFORM_ID 读取详情；替换平台二进制前完整停止游戏进程，完成后启动游戏。',
    'meta list 正确列出 SourceMod，sm version 返回版本，sm plugins list 可读取；最后验证目标插件。'
  ]],
  ['missing-native', 'Native was not found / Required extension not running', ['插件排错', '依赖'], '缺的是运行时提供者；把 .inc 文件放进服务器不会解决缺 Native。', 'sm plugins info 或 error 日志明确报告缺 Native/扩展', 'sm', [
    '插件 Failed，错误包含 Native was not found 或 Required extension。',
    '记录完整 Native 名、插件名与所需最低版本；用 sm exts list 查看扩展，sm plugins list 查看依赖插件。',
    '按作者依赖列表安装或升级提供该 Native 的插件/扩展，连同其 gamedata 与 translations；.inc 供编译使用，不是运行时实现。Left4DHooks 等共享依赖只管理一份，不能靠重复安装同名 SMX 解决。',
    '提供者先正常加载，目标插件再加载并执行相关功能；日志中原 Native 错误不再出现。'
  ]],
  ['missing-translation', 'Could not find translation file：补的是语言文件', ['插件排错', '语言文件'], '按插件压缩包结构还原 translations 文件，不要改名猜测或只重装 SMX。', 'SourceMod 错误明确列出缺失 translation 文件', 'sm', [
    '插件加载失败或菜单触发时抛出翻译错误。',
    '记录所缺文件名；检查 addons/sourcemod/translations 及对应语言子目录，核对 Linux 文件名大小写。',
    '从相同插件版本的完整发布包恢复语言文件。升级 SourceMod 官方插件时同步其官方 translations；不要把其他插件的同名文件直接覆盖过来。',
    '加载插件并打开此前报错的菜单/提示，检查 error 日志不再新增同一缺文件或缺短语错误。'
  ]],
  ['gamedata-signature', '游戏更新后 signature / offset / gamedata 报错', ['游戏更新', 'gamedata', '插件排错'], '游戏更新可能改变签名与偏移；使用匹配版本的完整官方平台与插件发布包。', '明确出现 signature、offset、GameConf 或 SDKCall 初始化错误', 'upgrade', [
    '更新游戏后插件不加载，或调用某功能就崩溃。',
    '记录最早的错误及所属插件/扩展，核对游戏、SourceMod 和依赖版本；不要只根据“刚更新”推断所有崩溃都来自 gamedata。',
    '在测试实例停服，按发布说明同步升级对应二进制、gamedata 和 translations；第三方依赖使用其维护者给出的兼容版。没有兼容更新时暂时停用触发组件，不自行猜地址或套用别的游戏偏移。',
    '启动后确认平台、扩展与插件加载正常，再触发原来导致错误的功能并观察日志；仅重启成功不够。'
  ]],
  ['smx-bytecode', 'SMX 无法运行：编译版本与 SourceMod 运行时不匹配', ['插件排错', '版本不兼容'], '先读具体加载错误和最低运行版本，再选择匹配发布包或用兼容编译器构建。', '明确提示 SMX/code version 不支持或插件格式无效', 'sm', [
    '其他插件正常，某个新 SMX 报格式或代码版本不支持。',
    'sm version 核对运行时，sm plugins info PLUGIN_ID 读取加载错误，查目标插件的最低 SourceMod 要求与下载包是否完整。',
    '满足最低版本后按官方流程升级平台；有源码且作者支持当前运行时，才使用相应编译器和配套 include 编译。把 .sp 改成 .smx 或只换 .inc 不能改变字节码兼容性。',
    '插件正常加载并执行实际功能；如果错误转成缺 Native，则继续处理其运行依赖，不能宣称已完全修复。'
  ]],
  ['extension-architecture', 'wrong ELF class / invalid ELF header：扩展平台不匹配', ['Linux', '扩展', '版本不兼容'], '按实际游戏进程的系统、架构和引擎分支选择扩展，不按宿主机 64 位直接推断。', '原生 .so/.dll 加载错误；Linux 游戏服务', 'sm', [
    'meta info 或 sm exts list 显示 wrong ELF class、invalid ELF header。',
    '用 file GAME_BINARY 与 file EXTENSION_FILE 比较实际架构，替换为真实文件路径；同时确认下载的不是 HTML 错误页，也不是 Windows DLL。',
    '停服后安装与游戏进程、操作系统和 L4D2 引擎匹配的扩展包，保留其原始文件名与目录。不要通过重命名 DLL 为 SO 来尝试加载。',
    '重启游戏后对应组件加载成功，并执行依赖该扩展的插件功能；仅文件存在不算成功。'
  ]],
  ['wrong-game-plugin', 'Wrong game：插件不是为求生之路 2 编写的', ['插件排错', '版本不兼容'], '检查游戏支持范围和插件发布分支，不用关闭检测强行加载。', 'SourceMod 加载错误明确为 Wrong game 或不支持当前游戏', 'sm', [
    '插件能下载，但一加载就拒绝当前游戏。',
    '核对是否误装 TF2、CS:S、L4D1 专用版，以及页面提供的通用/专用分支。',
    '停用不适用的插件，寻找作者明确支持 L4D2 的版本；通用插件仍报错时向作者提供游戏与平台版本，不修改检测逻辑强行启用。',
    '正确版本正常加载，并验证命令/菜单在 L4D2 生效；插件商店可收录不等于每个版本都兼容。'
  ]],
  ['admin-permissions', '有面板授权却没有游戏内 sm_admin 权限', ['玩家权限', '插件排错'], '网页授权和 SourceMod 游戏权限分别核验；游戏权限按实际 SteamID、flags 与管理插件配置生效。', 'SourceMod 已运行，玩家无法打开游戏管理员菜单', 'admins', [
    '网页能管理服务器，但游戏内 sm_admin 无权限或菜单缺操作。',
    '先确认玩家管理中记录的是实际游戏 SteamID，查看管理员权限与 SourceMod 管理插件是否加载。不要用昵称代替 SteamID。',
    '在玩家管理授予需要的游戏权限，或按 SourceMod 配置核对 admins_simple.ini；服务端执行 sm_reloadadmins 后重新连接。只有确实需要最高权限的人才授予 z；命令 overrides 或免疫等级也可能限制操作。',
    '在该玩家客户端执行 sm_admin 并测试一项已授予的功能；同时确认普通玩家没有获得同等权限。'
  ]],
  ['duplicate-plugins', '同功能插件叠加：双倍生成、重复菜单或人数反复变化', ['模组冲突', '多人玩法', '插件排错'], '按实际加载文件定位重复实现，不以展示名称相同就判断插件相同。', '多个人数、装备、刷怪或管理插件同时启用', 'sm', [
    'Bot 反复生成、同一菜单出现两次、CVar 被改回。',
    '用 sm plugins list 与 sm plugins info 确认真实文件名，检查 plugins 根目录、子目录及旧版改名副本。',
    '保留一个功能控制者，暂时把另一套业务插件移入 plugins/disabled，保留其配置与数据；再按作者说明切图或重启测试。若其他插件依赖被停用项，先核对依赖关系。',
    '重复触发原动作，人数/菜单/物品只改变一次，且无新依赖错误；记录可共存组合。'
  ]],
  ['config-overwrite', '人数或模式改完又恢复：谁在后面覆盖配置？', ['配置', '多人玩法', '游戏模式'], '比较切图前后服务端实际值，找出配置文件或插件的后续写入者。', '设置当前生效，切图或重启后回退', 'panel', [
    '游戏模式、人数上限或 Bot 数量在下一局变回去。',
    '记下所改 CVar 的实际值与回退时点，检查 server.cfg、cfg/sourcemod、模式专用配置及人数插件；不要只比较面板输入框。',
    '按当前插件文档把设置写到其实际读取的配置，停用重复控制同一值的另一套方案。开局 Bot 和动态真人槽位可能不同；有些值需要下一张图才生效。',
    '分别在保存后、切图后和游戏进程重启后读取实际值并实测加入；明确哪些设置只影响下一局。'
  ]],
  ['server-exit', '服务器突然退出：先看退出信号和第一条错误', ['服务器异常退出', '日志', 'Linux'], '先分清正常停止、进程崩溃、内核杀进程和网络断线，再处理对应原因。', 'Linux；systemd 管理的游戏服务使用其实际 GAME_SERVICE 名', 'service', [
    '所有玩家同时掉线，游戏进程消失或 PID 改变。',
    '把 GAME_SERVICE 替换为实际游戏 unit：systemctl show GAME_SERVICE -p Result -p ExecMainCode -p ExecMainStatus -p NRestarts；journalctl -u GAME_SERVICE --since "30 minutes ago" -n 200 --no-pager。脚本启动器还要结合实际游戏子进程日志，不能只看启动器退出码。',
    '正常 stop/quit 查管理操作与维护任务；SEGV/ABRT 查崩溃转储和近期原生组件；KILL 查内核/容器内存事件；明确缺文件或端口错误走对应条目。screen、tmux、Docker 或面板进程托管时读取其自身日志，不套用不存在的 unit。',
    '修复对应原因后重新执行原触发步骤并监测 PID、退出记录与在线玩家；自动拉起只恢复可用性，不能代替原因确认。'
  ]],
  ['server-oom', '退出码 137 / SIGKILL：怎样确认是不是 OOM？', ['服务器异常退出', '内存不足', 'Linux'], '137 或 KILL 只说明被强制终止；需要对应时间的 OOM 记录或容器内存事件。', 'Linux 主机或容器内运行的游戏服务器', 'oom', [
    '进程突然消失，看到 137、SIGKILL 或 Killed，没有普通插件错误。',
    '查看 journalctl -k --since "30 minutes ago" --no-pager 中是否有 Out of memory、Killed process 及对应进程；用 free -h 了解当前内存，systemctl show GAME_SERVICE -p MemoryCurrent -p MemoryMax 查看服务限制。cgroup v2 的 memory.events 中 oom_kill 增量可作佐证；容器还应查看 OOMKilled 状态。',
    '有内存证据时，错开地图备份/解压与游戏高峰，减少高消耗并发、回退新增高耗组件，或在宿主资源足够时调整服务/容器限制。宿主空闲不代表容器未达上限。无 OOM 证据则继续查人工 kill、托管超时等原因，不直接认定内存不足。',
    '重跑相同地图与人数负载，监测内存峰值和 oom_kill 是否继续增长；一次空服启动正常不足以确认修复。'
  ]],
  ['server-segfault', 'Segmentation fault / SIGSEGV：原生崩溃怎么查？', ['服务器闪退', '崩溃转储', '扩展'], '保留崩溃时点与转储，按近期原生组件变更做可回退对照，不能只凭最后一个 SMX 日志定责。', 'Linux 游戏进程收到 SEGV/ABRT；可用时读取 systemd-coredump', 'core', [
    'srcds_linux 闪退，日志显示 SEGV、ABRT 或 Segmentation fault。',
    '查看 coredumpctl list srcds_linux，再按实际崩溃 PID 执行 coredumpctl info CRASH_PID；同时保存游戏、MetaMod、SourceMod 与扩展版本。未安装 coredumpctl、未保存转储或权限不足不代表没有崩溃。',
    '在测试实例回退最近更新的原生扩展/平台到已知可用版本，或停用明确触发功能并保留依赖关系；用官图和最小插件组合复现。栈顶模块只是线索，结合可复现对照或交给维护者分析。',
    '重复原触发动作，确认进程保持运行且没有新转储；将确认可用的组件版本与复测条件写入记录。'
  ]],
  ['server-restart-loop', '服务器反复重启 / start-limit-hit：先修首次失败', ['服务器异常退出', '反复重启', 'systemd'], '限速只是连续失败的结果；先看第一次启动错误，再恢复服务。', 'systemd 托管游戏进程；不适用于其他启动器', 'service', [
    '服务刚启动就退出，NRestarts 增长或提示 Start request repeated too quickly。',
    '查看 journalctl -u GAME_SERVICE --since "30 minutes ago" --no-pager，向前找到首次错误，核对实际退出进程；检查端口、工作目录、启动参数和必需文件。',
    '在维护窗口停止重启循环，修复首个明确错误。修好后才运行 systemctl reset-failed GAME_SERVICE，再启动服务；需要自动恢复时按托管方式设置 Restart=on-failure 与合理 RestartSec，不通过无限提高启动次数掩盖失败。',
    '确认服务稳定运行，NRestarts 不再持续增长，玩家可加入并完成换图；reset-failed 自身不修复崩溃。'
  ]],
  ['server-disk-full', 'No space left on device：容量没满也可能无法写入', ['服务器异常退出', '磁盘', '日志'], '同时检查磁盘容量与 inode；保留故障证据后清理已确认可移除的缓存和旧文件。', 'Linux 写日志、下载、解压或保存状态失败', 'journal', [
    '报 No space left on device，或下载/日志突然写入失败。',
    '对实际游戏/状态目录执行 df -h GAME_DIR 与 df -i GAME_DIR，分别确认容量和 inode；同时检查文件系统是否只读、目录是否可写。',
    '暂停产生大文件的下载/备份任务，保留最新故障日志后清理已确认不用的临时包、缓存和过期备份。若只读或 I/O 错误，先查磁盘/文件系统异常，不用递归放宽权限代替修复。',
    '容量与 inode 有余量，原失败操作能够写入，并确认游戏服务和广播状态保存正常。'
  ]],
  ['server-port-conflict', 'Address already in use：是不是启动了两个游戏服？', ['服务器启动失败', '端口', 'Linux'], '核对真实监听者和启动实例，避免反复杀掉不相关服务。', 'Linux 启动日志明确报告绑定端口失败', 'service', [
    '启动即退出，报 bind、Address already in use 或端口不可用。',
    '用 ss -lunp 查看 UDP 监听、ss -ltnp 查看 TCP 监听，并按实际游戏端口确认所属进程；权限不足可能看不到进程信息。检查 systemd、screen 和手动启动是否重复。',
    '确认重复实例归属后，通过其正常托管方式停止多余实例，或为第二个游戏服设置独立端口和目录配置。若监听地址不存在则修正实际绑定地址，不按“占用”处理。',
    '只保留预期实例，服务启动后端口由正确进程监听，公网玩家能够实际连接。'
  ]],
  ['server-missing-library', 'error while loading shared libraries：游戏进程启动不了', ['服务器启动失败', 'Linux', '依赖'], '按错误中的具体库名、游戏架构和发行版补依赖，不能复制随机 SO。', 'Linux 游戏或受信任原生扩展启动时报告共享库缺失', 'meta', [
    '运行即退出，日志出现 cannot open shared object file、not found 或 Permission denied。',
    '记录具体库名；file GAME_BINARY 确认架构。对可信官方二进制可用 ldd GAME_BINARY 查缺失项；核对执行权限、目录权限与 noexec 挂载，区分“缺库”和“没有执行权限”。',
    '通过当前发行版包管理器安装匹配架构依赖，或从官方发布包恢复缺失文件；只修正确需要的执行权限。不从论坛随机下载同名库覆盖系统，也不对整个游戏目录 chmod 777。',
    '依赖不再 not found，实际游戏进程启动且可加载地图；没有加载错误还要继续核对运行期功能。'
  ]],
  ['server-after-update', '更新游戏或平台后全服闪退：按变更层回退验证', ['游戏更新', '服务器闪退', '平台管理'], '保留版本和配置，先比较原生平台/扩展与业务插件的兼容性，再确认最小可用组合。', '故障紧随游戏、SourceMod、MetaMod 或扩展更新出现', 'upgrade', [
    '更新前稳定，更新后启动/加载地图或某功能即退出。',
    '记录更新内容、当前游戏/平台/扩展版本与首次错误。若崩溃在 SMX 加载前，优先查原生加载层；若固定功能触发，查对应插件与依赖。',
    '在测试实例使用同版本游戏与已知兼容平台组合，按官方要求整体同步二进制、gamedata、translations；保留管理员与插件配置。第三方兼容版未发布时暂时停用明确触发项。不能保证 Steam 支持任意回退游戏版本。',
    '测试启动、客户端加入、原触发功能及换图四个环节，确认无新崩溃记录；只看版本号更新成功不算修复。'
  ]],
  ['server-hang', '没有退出但全服卡死：先区别网络和进程阻塞', ['服务器卡死', '性能', '网络'], 'PID 未变不代表游戏健康；结合 CPU、内存、磁盘等待和受影响范围判断。', '游戏进程仍在，但玩家卡住或连接超时', 'journal', [
    '没有崩溃转储，进程还在，所有玩家同时停住或掉线。',
    '记录时点，检查进程 CPU、内存与主机负载，比较同机网页与其他服务；读取同一时段系统/游戏日志，关注磁盘 I/O 与同时进行的解压/备份。',
    '只对照停用近期新增的高频插件/任务，或错开重负载下载解压；若仅部分网络路径受影响，检查丢包和出口。需要恢复服务时在保存证据后重启游戏，但把它记录为临时恢复。',
    '在同样人数、地图和持续时间下观察响应与资源曲线；一次重启后能进服不能证明卡死根因消失。'
  ]],
  ['readonly-permission', 'Permission denied / 状态保存失败：检查运行用户和路径', ['Linux', '权限', '服务器启动失败'], '按真实运行用户修复具体目录的读取/写入权限，不扩大整个服务权限。', '插件、地图或面板日志明确显示 EACCES、Permission denied', 'service', [
    '文件明明存在，服务却读不到、插件无法保存数据或启动失败。',
    '确认实际进程用户和工作目录，检查出错文件及每级父目录权限；systemd 的沙箱、只读路径或挂载 noexec 也可能限制访问。',
    '只给运行用户所需目录访问权限，修正错误属主或不正确的状态路径；平台二进制由可信发布包恢复。不要把服务改成 root 或全目录 chmod 777 来掩盖问题。',
    '使用同一服务用户启动并复现原读取/保存动作，确认文件可正常访问且未新增权限错误。'
  ]],
  ['school-invisible-tank', '重返校园 Tank 隐身：核对地图自带模型与替换模组', ['地图故障', '模组冲突', '模型'], '社区测评报告过地图自带 Tank 模型与替换模组冲突；先在最小客户端组合验证。', 'Back to School 特定版本；不是所有地图隐身问题的通用结论', 'school', [
    '重返校园里 Tank 不可见，或模型异常而其他内容正常。',
    '核对地图完整版本与分包，确认客户端是否启用 Tank 模型替换；不同版本是否仍有该问题需复测。',
    '退出游戏后暂时停用 Tank 替换及其他非必需模型模组，只保留完整地图。原帖另提旧材质依赖，确实缺贴图时按地图当前作者说明补资源，不把材质补丁当作隐身问题的必然解法。',
    '回到同一章节观察 Tank 显示及战斗，再单独恢复原模组对照；记录实际冲突组合与地图版本。'
  ]],
  ['server-session-exit', '关闭 SSH 后游戏服也退出：运行方式不持久', ['服务器异常退出', 'SSH', '进程托管'], '先确认退出与 SSH 会话关联；把游戏交给持久托管器，而不是依赖当前终端前台进程。', 'Linux 手动前台启动游戏；退出 SSH 后停止', 'service', [
    '关掉终端或断开 SSH 后服务器同时掉线，重新登录发现进程已不在。',
    '记录 SSH 断开与游戏退出时间，确认游戏是否直接在该 shell 前台启动；检查当前是否已有 systemd、screen、tmux 或其他托管器，避免重复启动。',
    '选择一种持久运行方式：已有托管器就通过它启动；长期服务可配置 systemd 的 User、WorkingDirectory、ExecStart 与日志。临时使用 screen/tmux 时应正常分离会话；不要把 nohup 当作崩溃诊断或自动重启方案。',
    '在维护窗口重新连接测试：断开 SSH 后从另一个会话确认游戏进程仍在，好友仍能加入；确保没有第二个实例抢占端口。'
  ]],
  ['coredump-storage', '崩溃转储要全存吗：怎样保留证据而不撑满磁盘？', ['崩溃转储', '磁盘', '服务器闪退'], '保留首次可复现的转储、版本和日志即可开始分析，转储不是每局必做备份。', 'Linux 已配置 systemd-coredump 或其他崩溃收集器', 'core', [
    '反复闪退产生大量 core 文件，或 coredumpctl 只显示 missing。',
    '用 coredumpctl list 与 coredumpctl info CRASH_PID 查看实际记录、存储状态和大小；没有转储时先确认采集器与限制，不能据此否定崩溃。',
    '保留一份与日志、游戏和原生组件版本匹配的可复现样本，按维护者需求导出；在采集器设置合理的单文件/总存储限制，转储体积按进程内存而非普通日志估算。确认证据已保存后再整理旧样本。',
    '确认需要的样本仍可读取、磁盘保有余量、重复崩溃未无限占满磁盘；转储可能含内存中的私密数据，不上传公开仓库。'
  ]]
];
const legacy = new Set(['install-map', 'missing-texture', 'connect', 'multiplayer', 'plugin-error', 'record-solution']);
const guides = rows.map(([id, title, tags, summary, applicability, reference, steps]) => ({
  id: `builtin-${id}`, kind: 'qa', title, english: '', summary,
  content: ['现象：' + steps[0], '确认：' + steps[1], '处理：' + steps[2], '验证：' + steps[3]].join('\n\n'),
  url: references[reference][1], source: references[reference][0], author: 'L4D2-Control', tags,
  map: id === 'school-invisible-tank' ? 'Back to School' : '', pinned: id === 'server-exit' || id === 'addon-conflict', publishedAt: null, updatedAt: null,
  verifiedAt: '', applicability, linkType: 'article'
}));
const legacyGuideHashes = {
  "builtin-install-map": "1feac58abb191627c9ca926d01d4d26a4d8b9456c531c5391c51b254c323f2ca",
  "builtin-missing-texture": "ed9267f8e171dc4e910046c2a426c7dac4b5ccc01fca7bdbaf0f6bb7e8a498fc",
  "builtin-connect": "72e754444c5d4263cd84143d9c93088dd6dc17ae4b3991020983eaabc446e585",
  "builtin-multiplayer": "19cab5ce627c105559186f6cf3914eff706a0ecca03cafd594d804728883011f",
  "builtin-plugin-error": "f284e000fcbf289158cfb26e3c986a345e30c9c160ba8e5c6ec314e83003d69f",
  "builtin-record-solution": "8bffb4a1c89edad789ba2cb07cb2ca1d19afab9170e12da35a33e2479fea3605"
};
module.exports = { classics, guides, legacyGuideHashes, guideCatalogueRevision: 1, guideIntroducedRevision: Object.fromEntries(rows.map(([id]) => [`builtin-${id}`, legacy.has(id) ? 0 : 1])) };
