# L4D2-Control · 今天一定要活下去

![L4D2-Control · 今天一定要活下去](assets/Project%20poster%20desktop.webp)

> **QQ 交流群：1002677414** · 在 QQ 搜索群号即可加入，交流地图、插件与开服经验。
> 登录页和面板“关于项目”均可一键复制群号。

[电脑横版海报](assets/Project%20poster%20desktop.png) · [手机竖版海报](assets/Project%20poster%20mobile.png)

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
| ![普通 / 授权登录](https://raw.githubusercontent.com/Z1og/L4D2-Control/931e00bd37135e413f7ad12172236d02bd0acab8/docs/Project%20Preview/Login.png) | ![游戏模式](https://raw.githubusercontent.com/Z1og/L4D2-Control/793f96b31fb4f850f895460b391b8c71fea33f8d/docs/Project%20Preview/Gameplay.png) |

| 总览 | 地图管理 |
| --- | --- |
| ![总览](https://raw.githubusercontent.com/Z1og/L4D2-Control/793f96b31fb4f850f895460b391b8c71fea33f8d/docs/Project%20Preview/Overview.png) | ![地图管理](https://raw.githubusercontent.com/Z1og/L4D2-Control/793f96b31fb4f850f895460b391b8c71fea33f8d/docs/Project%20Preview/Maps.png) |

| 插件管理 | 内容下载 |
| --- | --- |
| ![插件管理](https://raw.githubusercontent.com/Z1og/L4D2-Control/793f96b31fb4f850f895460b391b8c71fea33f8d/docs/Project%20Preview/Plugins.png) | ![内容下载](https://raw.githubusercontent.com/Z1og/L4D2-Control/793f96b31fb4f850f895460b391b8c71fea33f8d/docs/Project%20Preview/Downloads.png) |

---

### ⭐ 如果本项目对你有帮助别忘了点一下star⭐

你的支持能让更多服主发现这个项目，也欢迎提交问题与改进建议。

## 重启、踢出与限时拉黑

- 总览的“重启服务器”位于“快速切图”左侧，二次确认后才执行，并显示重启进度。支持面板与游戏同机同账号、Linux 上由 `srcds_run` 自动重启托管的唯一游戏进程；不支持 `-norestart` 或未识别的托管方式时会拒绝操作。
- 当前在线玩家可单独或勾选批量踢出。确认框提供“仅踢出服务器”“踢出和拉黑”“取消”；选择踢出并拉黑后再选择时长并确认。
- 玩家记录可按 SteamID 拉黑，时长为 **1、3、7、30、180、3650 天**。已拉黑页面支持修改时长和取消拉黑，也支持批量操作；每批最多 100 位。修改时长从本次确认重新计时。
- 黑名单由 SourceMod 插件在玩家加入时校验，到期自动失效，重启后继续生效；不依赖浏览器保持打开。面板只管理自己的黑名单，不会撤销其他插件的封禁。
- 升级后需要重新编译并重载 **L4D2 Control Players 1.1.0**，仅刷新网页不能升级游戏插件。黑名单和处置审计位于私有目录 `left4dead2/addons/sourcemod/data/l4d2 control/` 中的 `bans.txt`、`moderation audit.jsonl`，不应上传到公共仓库。

## Restart, kick and timed bans

- The Overview restart button sits before Quick Map and requires confirmation. It reports progress and supports a single Linux game process supervised by `srcds_run` with automatic restart, under the same account and host as the panel. Unsupported supervisors and `-norestart` are rejected.
- Kick current players individually or with batch selection. The confirmation offers kick only, kick and ban, or cancel; kick and ban opens a duration selector before submission.
- Ban recorded Steam identities for **1, 3, 7, 30, 180 or 3650 days**. The banned-player tab supports changing durations and unbanning, including batches of up to 100 identities. Changing a duration restarts its countdown from confirmation time.
- The SourceMod bridge enforces bans when players join. Bans expire automatically and survive server restarts without an open browser. Only panel-owned bans are changed; other plugins' bans are preserved.
- Recompile and reload **L4D2 Control Players 1.1.0** after upgrading. A page refresh does not update the game plugin. Private `bans.txt` and `moderation audit.jsonl` files live in `left4dead2/addons/sourcemod/data/l4d2 control/`; never publish these records.

## 授权登录与普通登录

- **授权登录**使用服主配置的 `PANEL_USER` / `PANEL_PASSWORD`，拥有服务器管理权限；不是 Steam 授权。
- **普通登录**使用数字 Steam 资料链接（`steamcommunity.com/profiles/<SteamID64>`）或 SteamID64，以及独立的面板密码。首次使用点击“设置面板密码”；不接入 Steam OpenID/OAuth，不收集 Steam 密码。自定义 `/id/` 短链接暂不支持。
- 资料链接为用户自行申报，**不验证 Steam 账号归属**，也不会因此授予游戏管理员权限。
- 普通账号只可查看总览、地图、插件状态，获取已备份地图的直连下载信息；代理、玩法控制、玩家记录、安装、上传、删除、服务器中转导出和系统接口由后端拒绝访问。
- “在线玩家 → 面板账号”显示注册用户与登录记录。本面板有效 SteamID 黑名单同时阻止登录，已有会话在下次请求时失效。
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

- 同一浏览器标签页内刷新时，保留当前页面、插件分类、搜索词、地图展开状态、玩家页签，以及各页面和侧栏的滚动位置。内容下载恢复上次结果，不自动重新请求第三方搜索。
- 直连下载通过检查并提交浏览器后，弹窗自动关闭；检查失败时继续保留错误说明。
- 授权管理员可为玩家添加、编辑、搜索和清除备注。备注按 SteamID 保存，改名或离线仍保留，普通账号不可查看或修改。
- 登录页精简为登录和权限说明；既有私有登录与操作记录处理方式见部署教程。

## 普通账号密码管理

- 普通用户登录后，可点击面板顶部的“修改密码”，输入当前密码并两次确认新密码。
- 授权管理员可在“在线玩家 → 面板账号”找到玩家，点击“清除面板密码”并勾选确认。清除后本人需使用同一 SteamID 重新注册；昵称、玩家记录、备注、游戏权限和拉黑状态继续保留。
- 修改或清除成功后，该 SteamID 的全部现有面板登录失效；其他账号保持登录。新密码为 8–128 个字符，仅保存加盐哈希，不写入操作日志。
- 忘记密码需联系服主清除密码后重新注册。登录页的“首次使用？设置面板密码”使用醒目按钮进入注册。

普通登录页提供已隐去示例账号信息的 Steam 资料链接图示。清除密码会删除 salt/hash 凭据，不设置临时密码；重新注册后保存新的随机盐 scrypt 哈希，保留原账号记录。项目指纹只识别核心代码与页面，不识别访客设备；公开源码中的标记仍可被移除。
