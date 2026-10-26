# L4D2-Control · 今天一定要活下去

![L4D2-Control · 今天一定要活下去](assets/Project%20poster%20desktop.webp)

> **QQ 交流群：1002677414** · 在 QQ 搜索群号即可加入，交流地图、插件与开服经验。
> 登录页和面板“关于项目”均可一键复制群号。

[电脑横版海报](assets/Project%20poster%20desktop.png) · [手机竖版海报](assets/Project%20poster%20mobile.png)

[关于与 QQ 交流群](docs/Project%20Preview/About.png) · [服务器设置与操作日志](docs/Project%20Preview/Settings.png)

> 项目原创部分仅限非商业使用，商业使用需事先取得书面授权。参见 [LICENSE](LICENSE) 与[来源指纹说明](docs/Project%20Provenance.md)。


> [!IMPORTANT]
> **如果本项目对你有帮助别忘了点一下star⭐**
> 点击仓库右上角的 **Star**，支持项目继续更新。

**英文名：L4D2-Control** · **中文名：今天一定要活下去**。

一个为《求生之路 2》专用服务器打造的网页管理面板，提供地图、插件、创意工坊/GameMaps 内容下载和内容专用代理管理。

> **网盘适配说明：** 本项目的云端地图备份与直连下载导出功能当前适配 **OpenList 挂载的百度网盘**。随项目提供的 Chrome/Edge 下载助手也专用于百度网盘直链；其他网盘驱动尚未完成同等验证。基础地图与插件管理不依赖网盘。
>
> **Cloud-drive compatibility:** Map cloud backup and direct-download export are currently adapted and tested with **Baidu Netdisk mounted through OpenList**. The bundled Chrome/Edge download helper is specific to Baidu direct links. Other storage drivers have not received equivalent validation. Basic map and plugin management does not require a cloud drive.

> **百度网盘 SVIP 测试说明：** 本项目已验证的百度网盘账号已开通 **SVIP**。尚未验证未开通 SVIP 的账号，是否会影响下载服务暂不确定。
>
> The Baidu Netdisk account used for validation has **SVIP** enabled. Download behavior for accounts without SVIP has not been tested; whether this affects the download service remains unknown.

**English** · [English README](README%20English.md)<br>
**简体中文** · [中文 README](README%20Chinese.md)<br>
服务器部署： [中文部署教程](docs/Server%20Deployment.md#简体中文部署教程) · [English deployment guide](docs/Server%20Deployment.md#english-server-deployment-guide)

> 仓库公开不代表项目已部署到任意服务器。部署者须自行配置游戏路径、登录凭据、HTTPS 和所需的第三方服务。本仓库不包含服务器地址、账户、密码、订阅或证书。

## 快速上手

将本仓库地址交给 AI，并参考[服务器部署教程](docs/Server%20Deployment.md)，即可协助完成安装与配置。

> ### ⭐ 如果本项目对你有帮助别忘了点一下star⭐

## 项目预览

[电脑 / 手机登录页效果](docs/Project%20Preview/Community.png) · [手机登录页预览](docs/Project%20Preview/Login%20mobile.png)

以下为当前面板的实际页面预览。服务器地址、连接端口及其他私人信息已作不可逆遮盖，公开图片不包含原始敏感像素。

| 普通 / 授权登录 | 游戏模式 |
| --- | --- |
| ![普通 / 授权登录](https://raw.githubusercontent.com/Z1og/L4D2-Control/200a958e860dacaf8c7b6f77f032f288ae828479/docs/Project%20Preview/Login.png) | ![游戏模式](https://raw.githubusercontent.com/Z1og/L4D2-Control/793f96b31fb4f850f895460b391b8c71fea33f8d/docs/Project%20Preview/Gameplay.png) |

| 总览 | 地图管理 |
| --- | --- |
| ![总览](https://raw.githubusercontent.com/Z1og/L4D2-Control/793f96b31fb4f850f895460b391b8c71fea33f8d/docs/Project%20Preview/Overview.png) | ![地图管理](https://raw.githubusercontent.com/Z1og/L4D2-Control/793f96b31fb4f850f895460b391b8c71fea33f8d/docs/Project%20Preview/Maps.png) |

| 插件管理 | 内容下载 |
| --- | --- |
| ![插件管理](https://raw.githubusercontent.com/Z1og/L4D2-Control/793f96b31fb4f850f895460b391b8c71fea33f8d/docs/Project%20Preview/Plugins.png) | ![内容下载](https://raw.githubusercontent.com/Z1og/L4D2-Control/793f96b31fb4f850f895460b391b8c71fea33f8d/docs/Project%20Preview/Downloads.png) |

---

### ⭐ 如果本项目对你有帮助别忘了点一下star⭐

你的支持能让更多服主发现这个项目，也欢迎提交问题与改进建议。



## 平台组件管理

「插件、平台管理」共享一个侧边栏入口，顶部切换“插件管理 / 平台管理”。平台页检查 MetaMod:Source、SourceMod、L4DToolZ 和 Stripper:Source 的磁盘安装及游戏内运行状态，并从官方渠道读取 Linux x86 稳定版和历史可用版本。安装、更新及回退需要二次确认；更新保留现有插件和配置，不会自动重启游戏。上一版文件保存在面板私有状态目录 `~/.local/state/dead-air-panel/platforms/`，每个组件仅保留一次可回退版本。

MetaMod 是 SourceMod、L4DToolZ 与 Stripper 的前置加载器；SourceMod 运行 SMX 并负责管理员/扩展接口；L4DToolZ 扩展多人上限；Stripper 通过地图规则调整实体。更新后二进制通常要重启游戏才载入，不应在比赛中随意替换，Stripper 规则也可能改变地图流程。自动组件安装仅支持 Linux x86 的 L4D2 服务端。

Left4DHooks 仍由“插件管理”导入、启停、删除和导出；平台页只显示其磁盘状态与 SourceMod 依赖关系，不创建第二套插件管理入口。

## 重启、踢出与限时拉黑

- 总览的“重启服务器”位于“快速切图”左侧，二次确认后才执行，并显示重启进度。支持面板与游戏同机同账号、Linux 上由 `srcds_run` 自动重启托管的唯一游戏进程；不支持 `-norestart` 或未识别的托管方式时会拒绝操作。
- 当前在线玩家可单独或勾选批量踢出。确认框提供“仅踢出服务器”“踢出和拉黑”“取消”；选择踢出并拉黑后再选择时长并确认。
- 玩家记录可按 SteamID 拉黑，时长为 **1、3、7、30、180、3650 天**。已拉黑页面支持修改时长和取消拉黑，也支持批量操作；每批最多 100 位。修改时长从本次确认重新计时。
- 黑名单由 SourceMod 插件在玩家加入时校验，到期自动失效，重启后继续生效；不依赖浏览器保持打开。面板只管理自己的黑名单，不会撤销其他插件的封禁。
- 升级后需要重新编译并重载 **L4D2 Control Players 1.4.0+**，仅刷新网页不能升级游戏插件。黑名单、白名单和处置审计位于私有目录 `left4dead2/addons/sourcemod/data/l4d2 control/`，不应上传到公共仓库。

## 玩家管理白名单

玩家管理支持使用 SteamID2 / SteamID3 / SteamID64、数字资料链接或自定义 `/id/` 资料链接添加白名单；自定义短链解析要求服务器可访问 Steam Community。白名单名单可在准入限制关闭时预先维护；开启后，SourceMod 插件会拒绝名单外真人进入，SourceMod 管理员自动放行并登记。关闭模式会保留记录。需要编译并热重载 SourceMod 玩家插件 **1.4.0+**。

## Restart, kick and timed bans

- The Overview restart button sits before Quick Map and requires confirmation. It reports progress and supports a single Linux game process supervised by `srcds_run` with automatic restart, under the same account and host as the panel. Unsupported supervisors and `-norestart` are rejected.
- Kick current players individually or with batch selection. The confirmation offers kick only, kick and ban, or cancel; kick and ban opens a duration selector before submission.
- Ban recorded Steam identities for **1, 3, 7, 30, 180 or 3650 days**. The banned-player tab supports changing durations and unbanning, including batches of up to 100 identities. Changing a duration restarts its countdown from confirmation time.
- The SourceMod bridge enforces bans when players join. Bans expire automatically and survive server restarts without an open browser. Only panel-owned bans are changed; other plugins' bans are preserved.
- Recompile and reload **L4D2 Control Players 1.4.0+** after upgrading. A page refresh does not update the game plugin. Private bans, whitelist and audit files live in `left4dead2/addons/sourcemod/data/l4d2 control/`; never publish these records.

## Player management whitelist

Add players by SteamID2/3/64, numeric Steam profile URL, or custom `/id/` profile URL (the panel host must reach Steam Community to resolve custom URLs). Entries can be maintained while admission restrictions are off. When enabled, the SourceMod bridge rejects non-bot players not on the list after admin checks complete; SourceMod administrators are automatically allowed and recorded. Disabling the mode preserves records. Compile and hot-reload the SourceMod bridge **1.4.0+**.

## 授权登录与普通登录

- **授权登录**使用服主配置的 `PANEL_USER` / `PANEL_PASSWORD`，拥有服务器管理权限；不是 Steam 授权。
- **普通登录**使用数字 Steam 资料链接（`steamcommunity.com/profiles/<SteamID64>`）或 SteamID64，以及独立的面板密码。首次使用点击“设置面板密码”；不接入 Steam OpenID/OAuth，不收集 Steam 密码。自定义 `/id/` 短链接暂不支持。
- 资料链接为用户自行申报，**不验证 Steam 账号归属**，也不会因此授予游戏管理员权限。
- 普通账号只可查看总览、地图、插件状态与无线广播，获取已备份地图的直连下载信息；代理、玩法控制、玩家记录、安装、上传、删除、服务器中转导出和系统接口由后端拒绝访问。
- “玩家管理 → 面板账号”显示注册用户与登录记录。本面板有效 SteamID 黑名单同时阻止登录，已有会话在下次请求时失效。
- 账号密码以随机盐 scrypt 哈希保存在私有目录。面板登录/操作 IP、日志与最近游戏连接 IP 保留 **30 天**，仅授权账号可见。省份由本地离线 IP 库估计，可能不准确，不把用户 IP 发送给定位服务。SteamID、账号与封禁记录持续保留；日志期限不等于账号期限。
- 会话使用 HttpOnly Cookie，变更操作校验 CSRF。面板重启后需重新登录。应用公网访问应使用 HTTPS。

## 游戏模式与多人房间

侧栏“游戏模式”位于“地图管理”上方。授权账号可以选择合作、写实、对抗、生存或清道夫模式，调整难度、开放直连，检测并配置扩展多人合作与开局 Bot 数量。

扩展人数需要正在运行的 `l4d2_sv_maxplayers` 与 `bots` 插件；页面按游戏实际 ConVar 上限显示可选范围，不自动安装插件或修改启动参数。当前适配的是 `bots_limit` / `bots_join_limit` 接口，其他多人插件将显示不可用。人数不能低于当前在线真人数。关闭扩展多人恢复标准房间上限（合作/写实/生存 4，对抗/清道夫 8）。

保存前二次确认，写入后读回游戏值，不一致则恢复原值。配置保存在 SourceMod 私有 `data/l4d2 control/gameplay.txt`，由 **1.3.0 或更新的本项目玩家桥接插件**在地图配置执行后恢复。模式和开局 Bot 数量可能需要切图才能影响本局；单独的“重载当前地图”再次确认并会重置进度。地图必须支持所选玩法。部署新面板不会自动更改正在进行的游戏设置。


## Authorized and ordinary sign-in

**授权登录 (Authorized sign-in)** uses the operator's `PANEL_USER` / `PANEL_PASSWORD`. **普通登录 (Ordinary sign-in)** uses a numeric Steam profile URL or SteamID64 plus a separate panel password, registered on first use. No Steam OpenID/OAuth or Steam password is involved. Vanity `/id/` URLs are not supported. Profile linkage is **self-declared, not proof of Steam account ownership**, and never grants game administrator privileges.

Ordinary accounts can view public status, maps and plugins and request direct-download information for backed-up maps. The backend denies proxy, gameplay, player records, system tools, uploads, deletion, installation and server-relayed export. The Panel Accounts tab shows accounts and login/operation records to authorized users. Active panel SteamID bans prevent sign-in and revoke existing sessions on the next request.

Passwords use salted scrypt hashes in private server storage. Login/operation IPs, access logs and recent game IPs are retained for **30 days**. Province-level labels use an offline local database and are approximate; user IPs are never sent to a geolocation API. Accounts, SteamIDs and ban records persist beyond the IP retention period. Sessions use HttpOnly cookies with CSRF checks; restarting the panel requires signing in again. Use HTTPS for public access.

## Gameplay and multiplayer rooms

Game Mode appears above Maps in the sidebar. Authorized users can select campaign, realism, versus, survival or scavenge, adjust difficulty, permit direct joining, and configure expanded co-op slots and initial bots.

Expanded rooms require running `l4d2_sv_maxplayers` and `bots` plugins. Limits are read from live ConVars, not assumed. This adapter uses `bots_limit` / `bots_join_limit`; unsupported plugins remain unavailable. Capacity cannot be reduced below the online human count. Disabling expanded rooms restores standard capacity: 4 for co-op/realism/survival and 8 for versus/scavenge.

Changes require confirmation and read-back; mismatches restore previous values. Settings persist in SourceMod's private `data/l4d2 control/gameplay.txt`, restored after map configs by version **1.3.0+** of this project's player bridge. Mode and initial bot changes may require a map reload. Reload has separate confirmation and resets current progress; the chosen map must support the mode. Deploying the panel does not change live gameplay settings.

## 浏览状态与玩家备注

- 同一浏览器标签页内刷新时，保留当前页面、插件分类、搜索词、地图展开状态、玩家页签，以及各页面和侧栏的滚动位置。
- 直连下载通过检查并提交浏览器后，弹窗自动关闭；检查失败时继续保留错误说明。
- 授权管理员可为玩家添加、编辑、搜索和清除备注。备注按 SteamID 保存，改名或离线仍保留，普通账号不可查看或修改。
- 登录页精简为登录和权限说明；既有私有登录与操作记录处理方式见部署教程。

## 普通账号密码管理

- 普通用户登录后，可点击面板顶部的“修改密码”，输入当前密码并两次确认新密码。
- 授权管理员可在“玩家管理 → 面板账号”找到玩家，点击“清除面板密码”并勾选确认。清除后本人需使用同一 SteamID 重新注册；昵称、玩家记录、备注、游戏权限和拉黑状态继续保留。
- 修改或清除成功后，该 SteamID 的全部现有面板登录失效；其他账号保持登录。新密码为 8–128 个字符，仅保存加盐哈希，不写入操作日志。
- 忘记密码需联系服主清除密码后重新注册。登录页的“首次使用？设置面板密码”使用醒目按钮进入注册。

普通登录页提供已隐去示例账号信息的 Steam 资料链接图示。清除密码会删除 salt/hash 凭据，不设置临时密码；重新注册后保存新的随机盐 scrypt 哈希，保留原账号记录。项目指纹只识别核心代码与页面，不识别访客设备；公开源码中的标记仍可被移除。

### 内置项目介绍与来源标识
“系统 → 关于”提供项目简介、QQ 交流群和许可说明，由服务器内置身份信息生成，没有隐藏开关。正式构建会检查关于入口、来源与身份元信息是否保留；缺失或不一致时拒绝生成构建指纹。哈希校验用于发现文件变化，不是发布签名或 DRM，不能阻止持有源码的人同时修改校验逻辑。操作日志现位于“服务器设置”，自检入口统一为“服务检查”。

### 平台历史版本切换

在「插件、平台管理 → 平台管理」点击“获取 / 刷新版本”，按分支或兼容构建选择目标版本。列表来自官方仍可下载的 MetaMod / SourceMod Source 1 Linux 构建和 L4DToolZ / Stripper 发行包；不包含 Source 2、Windows 或官方已删除的文件。历史混合 ZIP 仅提取 L4D2 Linux 文件。

选择版本只更新预览与对应注意事项，不会自动安装。确认“安装所选版本”或“切换 / 修复所选版本”后才写入文件，支持升级和降级；完成后手动重启游戏并核验运行版本。官方未提供逐构建说明的版本会明确提示，不代表已验证所有旧版兼容性。保留已有配置和 SMX，切换时清理不再使用的受管二进制，上一轮文件变更可回退一次；请先在测试服验证旧版依赖。


### 外观主题

在服务器设置 → 外观偏好，或点击右上角调色盘，可切换「经典 COUI / Cupertino」界面风格与六种强调配色。明暗模式独立控制，支持自定义日出日落时段；偏好仅保存在当前浏览器，登录页与控制台共用，不影响服务器或其他用户。Cupertino 为原创网页风格实现，设计参考 compose-cupertino，并未嵌入其 Kotlin 组件或改变业务操作。

## 无线广播

“玩家管理”下方的“无线广播”面向所有已登录用户开放，分为“地图资讯”和“攻略与答疑”。管理员可维护经典推荐，收录 B 站、小黑盒等公开链接与摘要，记录问题、解决步骤、关联地图、适用条件与验证日期；普通账号只读。提供标签/全文搜索、置顶、分页、当前浏览器会话收藏和收录 JSON 导出。

网络资讯使用现有内容代理。管理员点击“更新地图资讯”后，读取 Steam 最近更新的最多 90 个 `Campaigns` 战役条目，校验 L4D2 应用身份、真实更新时间与地图说明，再筛选近一个日历月；新发布与旧图更新分开标注，分包按工坊条目显示。混合脚本、音效等分类且缺少地图特征的项目进入仅管理员可见的“待核验”，可移除或人工收录为经典；元数据筛选不等于已下载核验地图文件。网络攻略读取 Steam 简体中文标签的高评分指南并筛选含中文标题或摘要的内容，最多检查 90 条、展示 30 条。自动收录的摘要来自作者，未经过人工验证。B 站提供关键词搜索，小黑盒提供社区入口；管理员粘贴原文链接并填写标题/摘要收录，不依赖登录 Cookie 或封闭平台爬虫。

页面刷新、切换标签只读取已存内容，不自动请求外站；手动采集失败保留原数据并显示错误，过期地图自动移出“近一个月”。经典默认清单与项目整理答疑可编辑或删除，自动资讯可移除或另存补充。私有数据默认为 `~/.local/state/dead-air-panel/broadcast/broadcast.json`，可用 `BROADCAST_STATE_DIR` 修改位置；请备份该目录，不要将含私人记录的数据提交公共仓库。导出收录不包含自动资讯缓存或面板账号信息。
