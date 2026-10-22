# L4D2-Control · 今天一定要活下去

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

以下为当前面板的实际页面预览。服务器地址、连接端口及其他私人信息已作不可逆遮盖，公开图片不包含原始敏感像素。

| 总览 | 地图管理 |
| --- | --- |
| ![总览](https://raw.githubusercontent.com/Z1og/L4D2-Control/647db7a87df4d731e2168d00117d50695278cb0c/docs/Project%20Preview/Overview.png) | ![地图管理](https://raw.githubusercontent.com/Z1og/L4D2-Control/c5e295112d77ab696e363cfd41b64343a9736644/docs/Project%20Preview/Maps.png) |

| 插件管理 | 内容下载 |
| --- | --- |
| ![插件管理](https://raw.githubusercontent.com/Z1og/L4D2-Control/4131b3917d552be06b09acc44d4b14ab036f5c09/docs/Project%20Preview/Plugins.png) | ![内容下载](https://raw.githubusercontent.com/Z1og/L4D2-Control/4131b3917d552be06b09acc44d4b14ab036f5c09/docs/Project%20Preview/Downloads.png) |

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
