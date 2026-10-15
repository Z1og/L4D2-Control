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
| 内容下载 | 面板内搜索 Steam 创意工坊和 GameMaps，安装、字节进度、取消、重试、删除任务记录 |
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

`.env.example` 只提供空白配置模板。Mihomo、MetaCubeXD、Chrome、游戏、插件和节点订阅不随仓库分发。`package.json` 的 `private: true` 防止误发 npm 包，与 GitHub 仓库的公开状态无关。

## 行为与限制

- 地图导出包含原 VPK 的所有章节；插件导出仅含 SMX，不包含配置、翻译、gamedata 或扩展依赖。
- 地图导入和内容安装支持 VPK/ZIP，不支持 RAR/7z、分卷 VPK 或可执行安装器；上传、路径、包头、大小和文件名冲突均有检查。
- 当前地图所在的自定义包及官方基础地图受删除保护。删除文件保留在私有恢复目录中，恢复需要管理员手动处理。
- 下载与安装串行处理；无总大小时显示不定进度。服务重启后中断任务标记失败，不自动断点续传，也不自动重启游戏。
- Steam 优先使用官方 HTTPS 文件，无公开文件地址时尝试 SteamCMD 匿名下载；并非所有项目都允许匿名下载。
- GameMaps 站点验证、限流和节点连通性可能导致失败。浏览器适配器不是保证通过站点验证的机制。
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
