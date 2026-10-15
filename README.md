# Dead Air Server Control

求生之路 2 专用服务器管理面板。中文界面，支持地图、插件、内容下载和内容专用代理管理。

## 功能

- 地图按战役折叠展示章节；导入 VPK/ZIP、导出原始 VPK、删除自定义地图包。
- 插件按功能分类，支持启停、导入、导出 SMX 和删除。导入插件默认停用；配置、翻译、扩展和依赖需另行安装。
- Steam 创意工坊与 GameMaps 搜索、安装、下载进度、取消、重试及删除任务记录。删除任务不会删除已安装内容。
- Mihomo 节点导入、导出、切换、订阅刷新；可选 MetaCubeXD 同源管理桥。代理只用于内容请求，不修改游戏和系统全局代理。
- 浅色/深色主题、可设置日出日落时段、移动端布局。

## 安装与启动

需要 Node.js 20.6 或更新版本。游戏控制使用 Linux、GNU screen 和已运行的 L4D2 服务；插件管理需要 SourceMod。

1. 安装依赖：

   ~~~sh
   npm ci
   cp .env.example .env
   ~~~

2. 编辑 .env，填写自己的游戏目录、screen 会话名和连接地址。密码、订阅、节点、证书均由部署者自行配置，仓库不包含这些数据。
3. 启动：

   ~~~sh
   node --env-file=.env server.js
   ~~~

默认访问 http://127.0.0.1:4174 。npm start 适用于环境变量已经由终端或服务管理器提供的情况；它不会自动读取 .env。

## 连接配置

| 配置 | 用途 |
| --- | --- |
| L4D2_EXEC_MODE | local：部署在游戏服务器上；ssh：远程控制 |
| L4D2_SERVER_ROOT | 游戏安装根目录，默认 /srv/l4d2 |
| L4D2_SCREEN_SESSION | 已运行的 screen 会话名，默认 l4d2 |
| L4D2_GAME_HOST / L4D2_GAME_PORT | 界面展示及复制的游戏地址，默认端口 27015 |
| L4D2_SSH_HOST / L4D2_SSH_USER / L4D2_SSH_PASSWORD | SSH 模式必须自行填写 |
| L4D2_PLUGIN_PATH | 可选的 SourceMod 插件目录覆盖 |
| PANEL_USER / PANEL_PASSWORD | 面板登录账号和密码 |
| PANEL_AUTH_TOKEN | 可选 API 令牌，通过 Bearer 或 X-Panel-Token 使用 |
| PANEL_TLS_KEY / PANEL_TLS_CERT | 自行配置的 TLS 私钥和证书路径 |
| BIND_HOST / PORT | 面板监听地址与端口，与游戏端口独立 |

公网部署时设置登录凭据，并配置 HTTPS 或 HTTPS 反向代理。未设置登录凭据时仅允许回环监听访问。仓库不包含任何现成账户或证书续期配置。

## 下载与代理依赖

内容导入、导出和安装要求 local 模式。Steam 优先使用官方元数据中的 HTTPS 文件地址；无公开文件时使用 SteamCMD。SteamCMD、curl 和兼容其架构的 proxychains4 需自行安装，STEAMCMD_PATH 指定可执行脚本。

WORKSHOP_SOCKS_PROXY 可设为 socks5h://127.0.0.1:10808。代理失败不会自动直连。Mihomo 需要独立安装、私有配置目录内的 secret.txt，以及可重启的 dead-air-workshop-proxy.service；设置 WORKSHOP_MIHOMO_HOME 和 WORKSHOP_MIHOMO_BIN。MetaCubeXD 为可选外部组件，部署其静态资源并设置 WORKSHOP_DASHBOARD_DIR。仓库不打包这些可执行文件、服务配置、节点或订阅。旧 Xray 适配器通过 WORKSHOP_PROXY_ENGINE 留空选择，路径由 WORKSHOP_XRAY_CONFIG / WORKSHOP_XRAY_BIN 提供。

GameMaps 可使用浏览器适配器：设置 GAMEMAPS_BROWSER_BIN 指向已安装的 Chrome；无显示环境的 Linux 还需要 Xvfb。网站验证、代理连通性和上游规则可能影响搜索与下载；项目不保证所有条目均可安装。

下载任务默认保存在用户状态目录，DOWNLOAD_STATE_DIR 可覆盖。删除的库文件保留在私有恢复目录，LIBRARY_STATE_DIR 可覆盖。VPK/ZIP 安装有格式、路径和大小检查，禁止覆盖冲突文件；不会自动重启游戏。地图导出包含该 VPK 内全部章节，插件导出仅包含 SMX 本体。

## 测试

~~~sh
npm test
~~~

测试使用临时目录和模拟数据，不连接实际游戏服务。Windows 会跳过 Linux 专用检查；完整运行环境为 Linux。

## 界面参考

视觉风格参考 [COUI](https://github.com/suqi8/coui)，本项目使用原生 HTML、CSS 和 JavaScript，并非 COUI 的 Compose 组件实现。
