# L4D2-Control

[首页](README.md) · [English](README%20English.md) · [服务器部署教程](docs/Server%20Deployment.md#简体中文部署教程)

求生之路 2 专用服务器网页管理面板。使用原生 HTML/CSS/JavaScript 和 Node.js，界面以中文为主。部署在游戏服务器上后，可直接通过浏览器管理，不需要在自己的电脑运行后端。

## 项目预览

预览图中的服务器地址已打码；项目不包含真实服务器地址、账号或密码。

| 总览 | 地图管理 |
| --- | --- |
| ![总览](docs/Project%20Preview/Overview.png) | ![地图管理](docs/Project%20Preview/Maps.png) |

| 插件管理 | 内容下载 |
| --- | --- |
| ![插件管理](docs/Project%20Preview/Plugins.png) | ![内容下载](docs/Project%20Preview/Downloads.png) |

## 功能

| 模块 | 支持的操作 |
| --- | --- |
| 地图管理 | 扫描基础游戏、DLC 和自定义 VPK，按战役折叠显示章节，切图、导入 VPK/ZIP、导出原始 VPK、删除自定义地图包 |
| 插件管理 | 按功能分类，启用/停用、导入/导出 SMX、删除；导入插件默认停用，核心管理插件受保护 |
| 内容下载 | 分为“地图下载”和“插件下载”；面板内搜索 Steam 创意工坊、GameMaps 与 LaoYutang 插件商店，显示字节进度、取消/重试/删除任务记录；插件目录和已编译 SMX 默认每 6 小时同步到服务器 |
| 文件分享 | 可选接入 OpenList；可先把 VPK 上传到你配置的网盘存储，再生成分享链接；令牌仅由后端读取 |
| 内容代理 | Mihomo 节点/订阅导入、节点导出、删除、切换、订阅刷新，可选 MetaCubeXD 高级面板 |
| 界面 | 中文名称优先、浅色/深色、按自设日出日落时段切换、移动端布局 |

仅订阅 Steam 项目不会自动安装到专用服务器。这里的安装是服务器端操作。删除下载任务不会删除已经安装的地图或插件。

## 快速开始

推荐 Linux 服务器、Node.js 22 LTS 或更新的受支持 LTS 版本、GNU screen，以及已经运行的 L4D2 服务。面板运行账号须与游戏 screen 会话所属账号一致。插件管理需要 MetaMod/SourceMod。

```sh
git clone https://github.com/Z1og/L4D2-Control.git
cd L4D2-Control
npm ci
cp .env.example .env
chmod 600 .env
# 编辑 .env，配置游戏目录、screen 会话和登录密码
node --env-file=.env server.js
```

默认地址为 `http://127.0.0.1:4174`，仅能从服务器本机访问。完整的开机自启、公网 HTTPS、端口设置、代理初始化与排错步骤见[服务器部署教程](docs/Server%20Deployment.md)。`npm start` 不自动读取 `.env`，适用于环境变量已由终端或服务管理器注入的情况。

## 主要配置

| 环境变量 | 说明 |
| --- | --- |
| `L4D2_EXEC_MODE` | 推荐 `local`，在游戏服务器本机运行；`ssh` 仅用于有限的远程状态与控制，不提供完整库管理 |
| `L4D2_SERVER_ROOT` | 游戏根目录，默认 `/srv/l4d2`，其下应有 `left4dead2/` |
| `L4D2_SCREEN_SESSION` | 已运行的 screen 会话名，默认 `l4d2` |
| `L4D2_GAME_HOST` / `L4D2_GAME_PORT` | 显示和复制用的游戏地址及端口，默认端口 `27015`；不会修改游戏本身的监听配置 |
| `L4D2_PLUGIN_PATH` | 可选 SourceMod 插件目录覆盖 |
| `BIND_HOST` / `PORT` | 面板监听地址与端口，默认 `127.0.0.1:4174` |
| `PANEL_USER` / `PANEL_PASSWORD` | 浏览器登录账号/密码；公网部署必须设置 |
| `PANEL_AUTH_TOKEN` | 可选 API 令牌，支持 Bearer 或 X-Panel-Token |
| `PANEL_TLS_KEY` / `PANEL_TLS_CERT` | TLS 私钥与完整证书链路径 |
| `WORKSHOP_SOCKS_PROXY` | 仅内容请求使用的本机 SOCKS5h 代理，例如 `socks5h://127.0.0.1:10808` |
| `WORKSHOP_PROXY_ENGINE` | `mihomo`；留空使用旧 Xray 适配器，均需独立配置运行环境 |
| `STEAMCMD_PATH` | SteamCMD 脚本路径，默认 `/opt/steamcmd/steamcmd.sh` |
| `GAMEMAPS_BROWSER_BIN` | 可选 Chrome 路径；无图形界面的 Linux 还需 Xvfb |
| `PLUGIN_STORE_REFRESH_SECONDS` | 插件目录及 SMX 文件的自动同步间隔，默认 21600 秒（6 小时），允许 60 秒至 7 天 |
| `PLUGIN_STORE_SYNC_ENABLED` | 是否启用启动时与定时同步，默认 `true`；手动刷新仍可用 |
| `PLUGIN_STORE_CACHE_DIR` | 插件商店私有缓存目录，默认 `~/.local/state/dead-air-panel/plugin store` |
| `OPENLIST_URL` | 可选 OpenList 网页地址；只允许无凭据的 HTTPS 地址，留空则隐藏分享能力 |
| `OPENLIST_SHARE_TOKEN` | 限定地图存储权限的 OpenList 专用账号令牌，仅保存在服务器环境文件；面板不返回浏览器 |
| `OPENLIST_MAPS_PATH` | OpenList 中地图存储的公开路径，默认 `/l4d2-maps`；上传模式下必须是可写网盘存储 |
| `OPENLIST_UPLOAD` | `true`/`1` 允许手动及自动备份 VPK；`false` 仅浏览与分享已存在的云端文件 |

`.env.example` 只提供空白配置模板。Mihomo、MetaCubeXD、Chrome、游戏、插件和节点订阅不随仓库分发。`package.json` 的 `private: true` 防止误发 npm 包，与 GitHub 仓库的公开状态无关。

## 行为与限制

- 地图导出包含原 VPK 的所有章节；插件导出仅含 SMX，不包含配置、翻译、gamedata 或扩展依赖。
- 先在“云端地图”执行备份，再生成单文件分享。仅复用已有成功备份记录且大小、修改时间未变的文件；遇到未知同名文件时生成独立指纹版本，不覆盖云端原文件。首次备份仍使用服务器上行。
- 好友后续下载是否不经过游戏服务器，取决于网盘驱动是否支持直链以及 OpenList 是否启用代理下载；请在 OpenList 存储设置中优先关闭代理/启用直链，并用无登录窗口验证分享链接。
- 地图导入和内容安装支持 VPK/ZIP，不支持 RAR/7z、分卷 VPK 或可执行安装器；上传、路径、包头、大小和文件名冲突均有检查。
- 当前地图所在的自定义包及官方基础地图受删除保护。删除文件保留在私有恢复目录中，恢复需要管理员手动处理。
- 下载与安装串行处理；无总大小时显示不定进度。服务重启后中断任务标记失败，不自动断点续传，也不自动重启游戏。
- Steam 优先使用官方 HTTPS 文件，无公开文件地址时尝试 SteamCMD 匿名下载；并非所有项目都允许匿名下载。
- GameMaps 站点验证、限流和节点连通性可能导致失败。浏览器适配器不是保证通过站点验证的机制。
- 插件商店从 GitHub API/Raw 内容服务同步所选仓库中启用目录的已编译 `.smx` 文件，缓存 SHA 与文件大小均校验；上游不可用时保留上次成功目录。安装仅导入 `.smx` 到停用目录，不会自动安装插件配置、翻译、gamedata、扩展或其他依赖，启用前应阅读上游目录说明。服务器需能直接访问 `api.github.com` 和 `raw.githubusercontent.com`；此同步不使用只供 Steam/GameMaps 的内容代理。
- OpenList 是网盘虚拟文件层，不会自动提高百度网盘速度。若下载经 OpenList 中转，速度受百度上游、OpenList 主机出口和客户端线路中最慢的一段限制；只有驱动返回可访问的直链/302 且客户端能直连时，数据才可能绕过 OpenList 主机。首次把地图备份到网盘仍占用游戏服务器上行；反复下载使用服务器缓存只能减少重复读取上游，不能加速首次百度传输。
- 配置内容代理后，相关下载失败不会回退直连；不接管系统、游戏或 SSH 流量。订阅抓取是独立 HTTPS 请求，不使用内容 SOCKS 代理。
- 当前代码直接按请求的 TLS 状态验证 Origin。推荐直连 HTTPS；简单的 HTTPS → HTTP 反向代理可能导致写操作被拒绝。
- 界面仍以中文为主，双语 README 不代表已实现界面语言切换。在线玩家页和活动日志不是完整的玩家管理/持久审计系统。

## 测试与维护

```sh
npm test
```

测试使用临时文件和模拟数据，不连接真实游戏服务器。Windows 会跳过 Linux 专项测试；完整回归应在 Linux 上运行。升级前备份私有配置与状态目录，使用 `git pull --ff-only`、`npm ci` 更新，然后重启面板服务；不会自动重启游戏。

默认状态目录仍沿用 `~/.local/state/dead-air-panel/`，代理配置目录沿用 `~/.config/dead-air-mihomo/`。保留这些内部名称是为了兼容既有部署，避免改名后丢失记录。

## 致谢

视觉设计参考 [COUI](https://github.com/suqi8/coui)，不是其 Compose 组件实现。图标使用 [Lucide](https://lucide.dev/)，目前从 unpkg 加载。Steam 和 GameMaps 为独立第三方内容服务，本项目并非其官方产品。

## 服务器自检

在侧栏打开“服务器自检”，点击“开始检查”。地图与插件结果分别显示；游戏控制台暂时不可用时，地图扫描仍可完成。结果带检查时间，是当次快照；安装、删除、启停插件或切图后应重新检查。

- 地图检查读取 `addons` 与其 `workshop` 子目录中的 VPK 目录索引，只比较含 BSP 地图的包。不读取完整资源、不解压或备份地图；不检查官方基础包、散装资源、其他目录和实际挂载顺序。同路径也可能是共享素材，不能直接认定为故障；包自身的说明和预览图不计入重叠。
- 插件检查需要面板与游戏在同一台 Linux 主机、同一账号下使用 GNU screen。通过本次 `sm plugins list` 和 `sm plugins info` 的文件名核对管理目录与 `disabled` 目录；其他运行条目单独展示。显示名不同不会造成误判。未取到完整响应、列表变化或无法确定身份时显示“待确认”。
- 检查不会自动修复、启停插件或重启游戏。单包索引上限 8 MiB、单包 10 万条路径、每次最多 512 个包和 25 万条地图包路径；超限或读取失败会注明检查不完整。页面最多列出 200 条重叠路径；插件列表超过 256 条时标记不完整。

### 控制台内的云端地图与自动备份

“云端地图”直接列出专用 OpenList 存储内的 VPK，无需跳转。可搜索文件、查看容量与服务器备份状态、生成单文件分享链接；高级存储设置仍由 OpenList 管理。

点击“开启自动备份”后，服务器每 5 分钟检查 `addons` 和其 `workshop` 子目录中的 VPK，包含地图资源分包；不复制官方游戏目录或插件。顺序流式上传，文件成功上传并核对大小后才记录完成；已备份且未变化的文件跳过。文件变化或遇到已有同名文件时保留独立指纹版本，不覆盖、不联动删除。关闭网页后继续运行；“停止本轮并关闭自动备份”可取消当前任务。

推荐专用普通账号：基本路径 `/l4d2-maps`，仅开启写入内容与分享权限，关闭删除/移动/管理权限；访客继续停用。服务器环境设置 `OPENLIST_USER` / `OPENLIST_PASSWORD`，并设 `OPENLIST_API_PATH=/`（相对于专用账号的基本路径）。保留 `OPENLIST_MAPS_PATH=/l4d2-maps` 作为公开挂载路径；配置后重启面板。也支持已有 `OPENLIST_SHARE_TOKEN`，但其权限须由部署者限制。自动备份记录存于私有状态目录，可用 `CLOUD_MAPS_STATE_DIR` 自定义；勿把凭据或备份记录提交到 Git。

首次备份仍使用游戏服务器上行；后续下载是否直连取决于网盘驱动及代理设置。下载速度并不由“内嵌列表”功能改变。

同机部署 OpenList 时，可选 `OPENLIST_CONNECT_ADDRESS=127.0.0.1`，上传连接走本机回环，仍校验 `OPENLIST_URL` 的 HTTPS 证书。进度到“云盘正在保存”表示 OpenList 已接收文件，须等网盘完成后才计为备份成功。百度上传较慢时可在驱动中设置单线程、4 MiB 分片、每片超时 600 秒；这些仅为部署建议，面板不会自动改动网盘设置。

## 在线玩家与游戏内管理员

“在线玩家”展示真人在线人数、机器人数量、队伍、延迟、连接时长及 SteamID2 / SteamID3 / SteamID64。支持搜索、复制 ID、玩家记录与管理员列表。服务器自检位于侧栏“系统”分组。

需要安装本项目的只读 SourceMod 采集插件 `sourcemod/L4D2 Control Players.sp`，编译/安装方式见部署教程。记录从插件启用时开始，不追溯过去玩家，不记录 IP。采集超过 20 秒未更新时显示状态未知并禁止权限修改。

可按 SteamID 授予、调整或撤销本面板管理的 SourceMod 权限。插件管理员预设为 `bfn`，游戏管理员为 `bcdfgjk`，也可自定义 `a–t` 与 `z`；最高权限须单独确认。游戏内可用 `!admin` / `/admin` 打开已安装的管理菜单；每个插件的命令与所需权限仍以其配置为准，权限不等于安装插件。

面板只维护 `admins_simple.ini` 中带 `L4D2 CONTROL MANAGED ADMINS` 标记的配置块，保留外部配置和其他插件的授权；外部管理员只读。保存后重载管理员缓存，在线玩家核对实际权限，失败则恢复原配置。离线授权只报告配置已保存/重载。不会自动给任何真实玩家提权。

仅保留一份修改前管理员配置，不备份整服；身份历史、审计和权限配置不得提交 Git。

### 云端地图下载

云端地图的「下载到电脑」自动处理百度网盘需要的 `User-Agent: pan.baidu.com`，以流式方式传给浏览器，不先保存到服务器磁盘。支持单段 Range 和断点续传，最多两个并发下载；取消浏览器下载会停止上游传输。进度与暂停使用浏览器下载列表。

此方式经过游戏服务器，速度受服务器带宽影响。「下载器直连」可生成 Windows 自带 curl 或 aria2 的 PowerShell 命令，已带正确请求头；在自己的电脑执行可绕过服务器中转。直链具有时效，过期后重新打开窗口生成。无需修改现有 OpenList 直连/代理设置。
