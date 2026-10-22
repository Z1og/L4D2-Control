# L4D2-Control Server Deployment / 服务器部署教程

Replace placeholders such as `<GAME_USER>`, `<GAME_ROOT>`, `<SCREEN_SESSION>`, `<PANEL_DOMAIN>` and `<PUBLIC_GAME_HOST>` with your own values. Never commit passwords, subscription links, private keys or real credentials.

请将 `<GAME_USER>`、`<GAME_ROOT>`、`<SCREEN_SESSION>`、`<PANEL_DOMAIN>`、`<PUBLIC_GAME_HOST>` 等占位符替换为自己的值。切勿提交密码、订阅链接、私钥或真实凭据。

## 简体中文部署教程

### 0. 让 AI 协助部署（可选）

如果你不熟悉 Linux，可以把公开项目地址交给一个你信任、能够操作服务器终端的 AI 助手，请它按照本教程部署：

~~~text
请根据 L4D2-Control 项目和服务器部署教程，帮我在这台我有权限管理的 Linux 服务器上完成部署。
项目地址：https://github.com/Z1og/L4D2-Control
教程：https://github.com/Z1og/L4D2-Control/blob/main/docs/Server%20Deployment.md
请先检查 Node.js、screen、L4D2 游戏目录和权限，再逐步执行；每一步报告结果，遇到错误先停下来说明原因。
请使用安全的随机面板密码、HTTPS 和最小权限，不要把密码、私钥、令牌、订阅链接或服务器凭据写入公开聊天、代码或 Git 提交。
~~~

只把项目地址和必要的非敏感环境信息提供给 AI；密码、私钥、令牌、订阅链接等应在服务器上的私密环境文件中直接填写，不能粘贴到公开内容。AI 需要你明确授予终端或 SSH 操作权限，且应由你审核每条会改变服务器状态的命令。

### 1. 前置条件

推荐直接部署在运行 L4D2 的 Linux 主机上，并使用与游戏 screen 会话相同的 Unix 账号运行面板。需要已运行的 L4D2 专用服务器、GNU screen。插件管理还需要 MetaMod:Source 和 SourceMod。完整地图/插件管理及内容安装需要 L4D2_EXEC_MODE=local。

确认目录和游戏会话：

~~~sh
GAME_ROOT=/srv/l4d2  # 换成你的游戏根目录
screen -ls
test -d "$GAME_ROOT/left4dead2"
~~~

使用受支持的 Node.js LTS（快速开始示例为 Node.js 22 LTS）、一个自己的面板域名、有效 HTTPS 证书和强随机面板密码。

### 2. 安装依赖和项目

以下以 Debian/Ubuntu 为例。SteamCMD、Chrome、Mihomo 需要另行安装；SteamCMD 可能还需 32 位运行库。若不使用 GameMaps 浏览器功能，可不安装 Chrome/Xvfb；若不经 SOCKS 代理运行 SteamCMD，可不安装 proxychains4。

~~~sh
sudo apt update
sudo apt install -y ca-certificates curl git screen unzip xvfb proxychains4
node --version
npm --version
GAME_USER=replace-with-game-user  # 换成拥有 screen 会话的账号
id "$GAME_USER"
sudo mkdir -p /opt/L4D2-Control
sudo chown "$GAME_USER:$GAME_USER" /opt/L4D2-Control
sudo -H -u "$GAME_USER" git clone https://github.com/Z1og/L4D2-Control.git /opt/L4D2-Control
sudo -H -u "$GAME_USER" npm --prefix /opt/L4D2-Control ci
~~~

Node.js 请按其官方文档安装当前受支持的 LTS。

### 3. 创建私密环境配置

将配置放在项目目录以外，并限制读取权限：

~~~sh
GAME_USER=replace-with-game-user
sudo install -o "$GAME_USER" -g "$GAME_USER" -m 600 /dev/null /etc/l4d2-control.env
sudoedit /etc/l4d2-control.env
~~~

本机模式示例（替换所有尖括号占位符）：

~~~text
PORT=4174
BIND_HOST=0.0.0.0
L4D2_EXEC_MODE=local
L4D2_SERVER_ROOT=<GAME_ROOT>
L4D2_SCREEN_SESSION=<SCREEN_SESSION>
L4D2_GAME_HOST=<PUBLIC_GAME_HOST>
L4D2_GAME_PORT=27015
PANEL_USER=admin
PANEL_PASSWORD=<LONG_RANDOM_PANEL_PASSWORD>
PANEL_AUTH_TOKEN=
PANEL_TLS_KEY=/etc/l4d2-control/tls/key.pem
PANEL_TLS_CERT=/etc/l4d2-control/tls/fullchain.pem
STEAMCMD_PATH=/opt/steamcmd/steamcmd.sh
GAMEMAPS_BROWSER_BIN=/usr/bin/google-chrome-stable
PLUGIN_STORE_REFRESH_SECONDS=21600
PLUGIN_STORE_SYNC_ENABLED=true
PLUGIN_STORE_CACHE_DIR=
~~~

L4D2_GAME_HOST 仅供界面显示/复制，不会更改游戏监听地址。首次本机测试可用 BIND_HOST=127.0.0.1 并清空 TLS 路径。公网运行必须设置 PANEL_PASSWORD 或 PANEL_AUTH_TOKEN，并启用 HTTPS。不要把配置文件或密码放入 Git。

插件下载使用 LaoYutang/l4d2-plugins-store 的启用目录中的已编译 `.smx`。服务启动及每 6 小时（可用 `PLUGIN_STORE_REFRESH_SECONDS` 配置）从 `api.github.com` 与 `raw.githubusercontent.com` 同步目录和文件到私有服务器缓存；无需手动把插件放进仓库。初次同步大约只拉取数 MiB，但服务器必须能访问 GitHub API 与 Raw 域名。安装只导入所选 `.smx`，并放入停用目录；依赖扩展、配置、翻译不会自动安装，需查看上游说明后手动确认启用。可用 `PLUGIN_STORE_SYNC_ENABLED=false` 关闭自动同步，仍可手动刷新；`PLUGIN_STORE_CACHE_DIR` 可改私有缓存目录。

### 4. 配置 HTTPS

使用 DNS 指向自己服务器的域名 `<PANEL_DOMAIN>`。Certbot standalone 示例需要 TCP 80 暂时可用：

~~~sh
GAME_USER=replace-with-game-user
PANEL_DOMAIN=panel.example.com  # 换成你的域名
sudo apt install -y certbot
sudo certbot certonly --standalone -d "$PANEL_DOMAIN"
sudo install -d -o "$GAME_USER" -g "$GAME_USER" -m 700 /etc/l4d2-control/tls
sudo install -o "$GAME_USER" -g "$GAME_USER" -m 600 "/etc/letsencrypt/live/$PANEL_DOMAIN/privkey.pem" /etc/l4d2-control/tls/key.pem
sudo install -o "$GAME_USER" -g "$GAME_USER" -m 644 "/etc/letsencrypt/live/$PANEL_DOMAIN/fullchain.pem" /etc/l4d2-control/tls/fullchain.pem
~~~

续期时也必须复制新证书并重启面板。使用由 root 管理的 Certbot deploy hook 执行复制及 systemctl restart l4d2-control.service，并用 certbot renew --dry-run 验证。若 80 端口不可用，使用 DNS-01 或自己的证书系统。私钥不可提交到仓库。

### 5. 配置 systemd 开机自启

先运行 command -v node 确认 Node 路径。创建 /etc/systemd/system/l4d2-control.service：

~~~ini
[Unit]
Description=L4D2-Control server panel
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=<GAME_USER>
Group=<GAME_USER>
WorkingDirectory=/opt/L4D2-Control
ExecStart=/usr/bin/node --env-file=/etc/l4d2-control.env /opt/L4D2-Control/server.js
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true
ProtectSystem=full
ReadWritePaths=/opt/L4D2-Control <GAME_ROOT>


[Install]
WantedBy=multi-user.target
~~~

若 Node 不在 /usr/bin/node，替换 ExecStart 中的路径。服务账号必须能写入实际游戏目录的 left4dead2/addons/。不要设置 ProtectHome=read-only：游戏目录或面板状态目录可能在用户 home 下。启动并检查：

~~~sh
sudo systemctl daemon-reload
sudo systemctl enable --now l4d2-control.service
sudo systemctl status l4d2-control.service --no-pager
sudo journalctl -u l4d2-control.service -n 100 --no-pager
~~~

浏览器访问 `https://<PANEL_DOMAIN>:4174/` 并登录。日志应显示 HTTPS；若显示 HTTP，检查环境变量、证书路径和权限，不要让公网面板长期使用明文 HTTP。

### 6. 防火墙

同时检查云平台安全组和系统防火墙。示例只开放 SSH、面板 HTTPS 与常见游戏 UDP 端口；实际游戏端口按服务器配置调整。

~~~sh
sudo ufw allow OpenSSH
sudo ufw allow 4174/tcp
sudo ufw allow 27015/udp
sudo ufw status verbose
~~~

不要将 Mihomo 控制端口 9090 或 SOCKS 10808 暴露到公网，它们应仅监听 127.0.0.1。

### 7. 可选内容代理

代理只用于面板显式发起的 Steam Workshop/GameMaps 内容请求，不代理游戏、系统、SSH 或订阅获取。需单独安装 Mihomo，使 SOCKS 和控制器只监听回环地址，然后配置：

~~~text
WORKSHOP_PROXY_ENGINE=mihomo
WORKSHOP_SOCKS_PROXY=socks5h://127.0.0.1:10808
WORKSHOP_MIHOMO_HOME=/var/lib/l4d2-control/mihomo
WORKSHOP_MIHOMO_BIN=/usr/local/bin/mihomo
WORKSHOP_DASHBOARD_DIR=/opt/MetaCubeXD
~~~

**现有代码不会从空目录自动初始化 Mihomo。** 在启用以上变量前，需先由管理员准备可运行的 Mihomo 服务、同目录的 config.json、nodes.json、secret.txt，以及名为“内容下载”的代理组与匹配节点。面板的导入/切换操作依赖这些现有文件和正在运行的控制器。若没有完整 Mihomo 环境，保持 WORKSHOP_SOCKS_PROXY 为空，暂不使用代理管理页。订阅/节点不应提交到仓库。MetaCubeXD 是可选组件，需另行下载静态文件。GameMaps 浏览器功能需另外安装 Chrome、配置 GAMEMAPS_BROWSER_BIN；无图形界面的 Linux 需 Xvfb。上游站点仍可能要求验证。

### 8. 可选 OpenList 地图分享

OpenList 是独立的文件列表/分享服务，不会被 L4D2-Control 自动替你选择网盘或填写第三方授权。使用 OpenList 官方发布包或 Docker 单独运行；在 OpenList 管理页添加你的网盘驱动，公开路径设为 `/l4d2-maps`，不要把整个游戏根目录暴露给访客。关闭访客的存储目录浏览，并使用只对该存储有写入、访问及分享权限的专用账号。启用 HTTPS 后，在 `/etc/l4d2-control.env` 增加（令牌只放服务器环境文件，不要提交仓库）：

~~~text
OPENLIST_URL=https://files.example.com
OPENLIST_SHARE_TOKEN=replace-with-openlist-token
OPENLIST_MAPS_PATH=/l4d2-maps
OPENLIST_UPLOAD=true
~~~

`OPENLIST_MAPS_PATH` 是 OpenList 中网盘存储的公开路径，不是服务器文件系统路径。启用 `OPENLIST_UPLOAD=true` 后，在“云端地图”备份 VPK，完成后可通过 `/api/share/create` 创建单文件分享；令牌只在服务器端使用，不返回浏览器。首次上传占用游戏服务器上行，好友下载能否走网盘直链取决于该驱动的直链/代理设置。同名不同大小的文件不会被覆盖。OpenList 地址必须是 HTTPS 且不能带账号、密码、查询参数或令牌。

### 9. 验收、更新与排错

登录后依次检查总览/当前地图、地图导入导出、插件清单、一个公开下载及可选代理。安装内容后可能要手动重启游戏；面板不会自动重启游戏。

升级前备份 /etc/l4d2-control.env、TLS 文件、游戏 left4dead2/addons/，以及 ~/.local/state/dead-air-panel/ 和 ~/.config/dead-air-mihomo/。更新：

~~~sh
sudo systemctl stop l4d2-control.service
GAME_USER=replace-with-game-user
sudo -H -u "$GAME_USER" git -C /opt/L4D2-Control pull --ff-only
sudo -H -u "$GAME_USER" npm --prefix /opt/L4D2-Control ci
sudo -H -u "$GAME_USER" npm --prefix /opt/L4D2-Control test
sudo systemctl start l4d2-control.service
~~~

状态/地图为空：确认面板和游戏使用同一账号且 screen 会话名正确。导入/删除失败：检查 local 模式及游戏目录写权限。systemd 退出：查看 journalctl、Node 路径及环境文件权限。GameMaps 验证失败：检查 Chrome/Xvfb，切换节点或改用 Steam 搜索。Origin 校验按实际 TLS 状态工作；简单的 HTTPS 反向代理到 HTTP 可能导致写入被拒绝，建议由 Node 直接提供 HTTPS。

## English server deployment guide

### 0. Let an AI assistant help (optional)

If you are not comfortable with Linux, give the public project URL to a trusted AI assistant that can operate a server terminal, and ask it to follow this guide:

~~~text
Please deploy L4D2-Control on this Linux server, which I am authorized to manage, using the project and deployment guide below.
Project: https://github.com/Z1og/L4D2-Control
Guide: https://github.com/Z1og/L4D2-Control/blob/main/docs/Server%20Deployment.md
Check Node.js, screen, the L4D2 directory and permissions first. Execute one step at a time and report the result; stop and explain any error before continuing.
Use a strong random panel password, HTTPS and least privilege. Never put passwords, private keys, tokens, subscription URLs or server credentials in public chat, source code or Git commits.
~~~

Provide only the project URL and necessary non-sensitive environment details. Enter passwords, private keys, tokens and subscription URLs directly in a private server-side environment file, never in public content. The AI must have your explicit permission to use the terminal or SSH, and you should review every command that changes server state.

### 1. Prerequisites

Deploy on the Linux L4D2 host, using the **same Unix user that owns the game's screen session**. You need a running dedicated server and GNU screen. Plugin management requires MetaMod:Source and SourceMod. Full library/content operations require L4D2_EXEC_MODE=local.

~~~sh
GAME_ROOT=/srv/l4d2  # replace with your game root
screen -ls
test -d "$GAME_ROOT/left4dead2"
~~~

Replace all angle-bracket placeholders. Use a supported Node.js LTS, a hostname you control, a valid HTTPS certificate and a long random panel password.

### 2. Install and clone

Debian/Ubuntu example:

~~~sh
sudo apt update
sudo apt install -y ca-certificates curl git screen unzip xvfb proxychains4
node --version
npm --version
GAME_USER=replace-with-game-user  # screen session owner
id "$GAME_USER"
sudo mkdir -p /opt/L4D2-Control
sudo chown "$GAME_USER:$GAME_USER" /opt/L4D2-Control
sudo -H -u "$GAME_USER" git clone https://github.com/Z1og/L4D2-Control.git /opt/L4D2-Control
sudo -H -u "$GAME_USER" npm --prefix /opt/L4D2-Control ci
~~~

Install Node.js from its official supported-LTS instructions. Install SteamCMD, Chrome and Mihomo separately. SteamCMD may need distribution-specific 32-bit libraries. Chrome/Xvfb and proxychains4 are only needed for the optional browser and proxied SteamCMD fallback.

### 3. Private environment file

Keep credentials outside the checkout:

~~~sh
GAME_USER=replace-with-game-user
sudo install -o "$GAME_USER" -g "$GAME_USER" -m 600 /dev/null /etc/l4d2-control.env
sudoedit /etc/l4d2-control.env
~~~

Example for local mode; replace every placeholder:

~~~text
PORT=4174
BIND_HOST=0.0.0.0
L4D2_EXEC_MODE=local
L4D2_SERVER_ROOT=<GAME_ROOT>
L4D2_SCREEN_SESSION=<SCREEN_SESSION>
L4D2_GAME_HOST=<PUBLIC_GAME_HOST>
L4D2_GAME_PORT=27015
PANEL_USER=admin
PANEL_PASSWORD=<LONG_RANDOM_PANEL_PASSWORD>
PANEL_AUTH_TOKEN=
PANEL_TLS_KEY=/etc/l4d2-control/tls/key.pem
PANEL_TLS_CERT=/etc/l4d2-control/tls/fullchain.pem
STEAMCMD_PATH=/opt/steamcmd/steamcmd.sh
GAMEMAPS_BROWSER_BIN=/usr/bin/google-chrome-stable
PLUGIN_STORE_REFRESH_SECONDS=21600
PLUGIN_STORE_SYNC_ENABLED=true
PLUGIN_STORE_CACHE_DIR=
~~~

L4D2_GAME_HOST is only displayed/copied in the UI. For an initial local-only test use BIND_HOST=127.0.0.1, clear the TLS paths, then run node --env-file=/etc/l4d2-control.env /opt/L4D2-Control/server.js. Public access requires authentication and HTTPS. Never commit this file.

Plugin downloads use compiled `.smx` files from enabled folders in `LaoYutang/l4d2-plugins-store`. On startup and every six hours (configurable with `PLUGIN_STORE_REFRESH_SECONDS`), the server syncs the catalog and files from `api.github.com` and `raw.githubusercontent.com` into a private cache. The first sync is only a few MiB, but the server needs outbound access to both GitHub hosts. Installation imports only the selected `.smx` into SourceMod's disabled folder; extensions, configs and translations are not installed automatically. Read upstream notes before enabling. Set `PLUGIN_STORE_SYNC_ENABLED=false` to disable automatic sync while retaining manual refresh, or set `PLUGIN_STORE_CACHE_DIR` to choose another private cache location.

### 4. HTTPS certificate

Use your own DNS name `<PANEL_DOMAIN>`. Certbot standalone validation requires TCP port 80 to be available temporarily:

~~~sh
GAME_USER=replace-with-game-user
PANEL_DOMAIN=panel.example.com  # replace with your domain
sudo apt install -y certbot
sudo certbot certonly --standalone -d "$PANEL_DOMAIN"
sudo install -d -o "$GAME_USER" -g "$GAME_USER" -m 700 /etc/l4d2-control/tls
sudo install -o "$GAME_USER" -g "$GAME_USER" -m 600 "/etc/letsencrypt/live/$PANEL_DOMAIN/privkey.pem" /etc/l4d2-control/tls/key.pem
sudo install -o "$GAME_USER" -g "$GAME_USER" -m 644 "/etc/letsencrypt/live/$PANEL_DOMAIN/fullchain.pem" /etc/l4d2-control/tls/fullchain.pem
~~~

Copy renewed certificates and restart l4d2-control.service using a root-managed deploy hook; test with certbot renew --dry-run. Use DNS-01 if port 80 cannot be used. Never commit a private key.

### 5. systemd service

Check command -v node. If Node is not at /usr/bin/node, change ExecStart. Create /etc/systemd/system/l4d2-control.service:

~~~ini
[Unit]
Description=L4D2-Control server panel
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=<GAME_USER>
Group=<GAME_USER>
WorkingDirectory=/opt/L4D2-Control
ExecStart=/usr/bin/node --env-file=/etc/l4d2-control.env /opt/L4D2-Control/server.js
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true
ProtectSystem=full
ReadWritePaths=/opt/L4D2-Control <GAME_ROOT>


[Install]
WantedBy=multi-user.target
~~~

The service user must have write access to the real game addons directory. Do not set ProtectHome=read-only because game/application state may be under the service user's home. Start and inspect:

~~~sh
sudo systemctl daemon-reload
sudo systemctl enable --now l4d2-control.service
sudo systemctl status l4d2-control.service --no-pager
sudo journalctl -u l4d2-control.service -n 100 --no-pager
~~~

Open `https://<PANEL_DOMAIN>:4174/` and sign in. The log should report HTTPS; check certificate paths/permissions if it reports HTTP. Do not expose the public panel over plain HTTP.

### 6. Firewall

Check both cloud security groups and the host firewall. Example:

~~~sh
sudo ufw allow OpenSSH
sudo ufw allow 4174/tcp
sudo ufw allow 27015/udp
sudo ufw status verbose
~~~

Adjust game ports/protocols to match your configuration. Never expose the Mihomo controller (9090) or SOCKS (10808) publicly; bind both to 127.0.0.1.

### 7. Optional content proxy

The proxy handles explicit Workshop/GameMaps requests only, not game, system, SSH or subscription-fetch traffic. Install Mihomo separately and bind its SOCKS/controller listeners to loopback:

~~~text
WORKSHOP_PROXY_ENGINE=mihomo
WORKSHOP_SOCKS_PROXY=socks5h://127.0.0.1:10808
WORKSHOP_MIHOMO_HOME=/var/lib/l4d2-control/mihomo
WORKSHOP_MIHOMO_BIN=/usr/local/bin/mihomo
WORKSHOP_DASHBOARD_DIR=/opt/MetaCubeXD
~~~

**The current code does not bootstrap Mihomo from an empty directory.** Before enabling those variables, prepare a running Mihomo service, config.json, nodes.json and secret.txt in the configured private directory, plus a matching proxy group named “内容下载”. The panel's import/switch actions need those existing files and a live controller. If you do not have a complete Mihomo setup, keep WORKSHOP_SOCKS_PROXY empty and skip proxy management. Never commit credentials. MetaCubeXD is optional and installed separately. GameMaps browser support needs Chrome, GAMEMAPS_BROWSER_BIN and Xvfb on headless Linux; upstream verification may still block access.

### 8. Optional OpenList map sharing

OpenList is a separate file-list and sharing service. L4D2-Control does not choose a cloud provider or fill in its credentials. Run an official OpenList release or Docker container separately; add your cloud-drive driver in the OpenList admin page with public path `/l4d2-maps`, do not expose the whole game directory to guests, disable guest storage browsing, scope a dedicated account to that storage with write/access/share permission, and enable HTTPS. Then add to `/etc/l4d2-control.env` (keep the token only in this server-side file):

~~~text
OPENLIST_URL=https://files.example.com
OPENLIST_SHARE_TOKEN=replace-with-openlist-token
OPENLIST_MAPS_PATH=/l4d2-maps
OPENLIST_UPLOAD=true
~~~

`OPENLIST_MAPS_PATH` is the public path inside OpenList, not a filesystem path. With `OPENLIST_UPLOAD=true`, back up VPKs in Cloud Maps first, then use `/api/share/create` for a single-file share; the token never reaches the browser. The first upload uses the game server uplink; whether later downloads use the cloud provider's direct link depends on the driver/proxy setting. Same-name files with a different size are never overwritten. `OPENLIST_URL` must be HTTPS without embedded credentials, query parameters or tokens.

### 9. Verify, update and troubleshoot

Sign in and verify status/current map, a small VPK import/export, plugin inventory, one public download and optional proxy routing. Installed content may require a manual game restart; the panel never restarts the game automatically.

Back up /etc/l4d2-control.env, TLS files, left4dead2/addons/, ~/.local/state/dead-air-panel/ and ~/.config/dead-air-mihomo/. Update:

~~~sh
sudo systemctl stop l4d2-control.service
GAME_USER=replace-with-game-user
sudo -H -u "$GAME_USER" git -C /opt/L4D2-Control pull --ff-only
sudo -H -u "$GAME_USER" npm --prefix /opt/L4D2-Control ci
sudo -H -u "$GAME_USER" npm --prefix /opt/L4D2-Control test
sudo systemctl start l4d2-control.service
~~~

Missing status/maps: check that game and panel use the same account and screen-session name. Failed imports/deletions: check local mode and game-directory write access. Service exits: inspect journalctl, Node path and environment-file permissions. GameMaps challenges: configure Chrome/Xvfb, switch node or use Steam search. Origin validation uses actual TLS state; a basic HTTPS-to-HTTP reverse proxy can reject writes, so direct Node HTTPS is recommended.

### 控制台内的云端地图与自动备份

“云端地图”直接列出专用 OpenList 存储内的 VPK，无需跳转。可搜索文件、查看容量与服务器备份状态、生成单文件分享链接；高级存储设置仍由 OpenList 管理。

点击“开启自动备份”后，服务器每 5 分钟检查 `addons` 和其 `workshop` 子目录中的 VPK，包含地图资源分包；不复制官方游戏目录或插件。顺序流式上传，文件成功上传并核对大小后才记录完成；已备份且未变化的文件跳过。文件变化或遇到已有同名文件时保留独立指纹版本，不覆盖、不联动删除。关闭网页后继续运行；“停止本轮并关闭自动备份”可取消当前任务。

推荐专用普通账号：基本路径 `/l4d2-maps`，仅开启写入内容与分享权限，关闭删除/移动/管理权限；访客继续停用。服务器环境设置 `OPENLIST_USER` / `OPENLIST_PASSWORD`，并设 `OPENLIST_API_PATH=/`（相对于专用账号的基本路径）。保留 `OPENLIST_MAPS_PATH=/l4d2-maps` 作为公开挂载路径；配置后重启面板。也支持已有 `OPENLIST_SHARE_TOKEN`，但其权限须由部署者限制。自动备份记录存于私有状态目录，可用 `CLOUD_MAPS_STATE_DIR` 自定义；勿把凭据或备份记录提交到 Git。

首次备份仍使用游戏服务器上行；后续下载是否直连取决于网盘驱动及代理设置。下载速度并不由“内嵌列表”功能改变。

### In-console cloud maps and automatic backup

Cloud Maps lists VPKs from the dedicated OpenList folder without leaving the console. Search files, inspect capacity and per-server backup status, or copy a single-file share link. Advanced storage configuration remains in OpenList.

Enabling automatic backup starts an incremental scan every five minutes on the server. It includes VPKs in `addons` and its `workshop` directory, including map resource parts, but excludes the base game and plugins. Files stream sequentially. Completion is recorded only after upload and remote-size validation; unchanged recorded files are skipped. Changes and name collisions create fingerprinted versions without overwriting or propagating deletion. Closing the browser does not stop the worker; the Stop action aborts the current run and disables the schedule.

Use a dedicated GENERAL account based at `/l4d2-maps`, with write-content and share permissions only. Keep guest access disabled. Configure `OPENLIST_USER` and `OPENLIST_PASSWORD` in the private server environment and set `OPENLIST_API_PATH=/` relative to that account; retain `OPENLIST_MAPS_PATH=/l4d2-maps` as the public mount path. Restart the panel after configuration. Existing `OPENLIST_SHARE_TOKEN` authentication also works, but its scope must be restricted by the operator. Private incremental records can be relocated with `CLOUD_MAPS_STATE_DIR`. Never commit credentials or backup records. Initial uploads still use the game server uplink; direct downloads depend on the cloud driver and proxy settings.

同机部署 OpenList 时，可选 `OPENLIST_CONNECT_ADDRESS=127.0.0.1`，上传连接走本机回环，仍校验 `OPENLIST_URL` 的 HTTPS 证书。进度到“云盘正在保存”表示 OpenList 已接收文件，须等网盘完成后才计为备份成功。百度上传较慢时可在驱动中设置单线程、4 MiB 分片、每片超时 600 秒；这些仅为部署建议，面板不会自动改动网盘设置。

### 浏览器扩展：本机直连下载

如果不想让百度地图文件经过游戏服务器，可在面板登录后进入“云端地图 → 下载器直连”，下载 `L4D2 Baidu Download Helper.zip` 和安装说明。Chrome/Edge 打开扩展管理页，启用开发者模式，解压 ZIP 后选择包含 `manifest.json` 的文件夹加载；回到面板标签页，点击扩展图标并绑定当前标签页，然后从同一标签页点击“浏览器直接下载”。数据从百度直接传到本机，游戏服务器只提供短时下载链接。

扩展只修改手动绑定标签页从该面板发起、指向百度下载域名的请求头；不配置代理、不读取网页内容、不保存下载链接。规则仅在当前浏览器会话有效，重启浏览器后需要重新绑定。下载链接或百度策略变化时，可改用本机 curl/aria2 命令。扩展安装页：`/downloads/baidu-download-helper-guide`。

For co-located OpenList, optional `OPENLIST_CONNECT_ADDRESS=127.0.0.1` uses loopback uploads while validating the original HTTPS identity. The cloud-save stage means OpenList has received the file; completion is only recorded after the cloud provider finishes. For slow Baidu uploads, consider one upload thread, 4 MiB slices, and a 600-second per-slice timeout in the driver; the panel does not automatically change these provider settings.

### Browser extension: download directly to your computer

To avoid routing Baidu map files through the game server, sign in to the panel and open **Cloud Maps → Direct downloader**. Download `L4D2 Baidu Download Helper.zip` and the installation guide. In Chrome/Edge, open the extensions page, enable Developer mode, extract the ZIP and load the folder containing `manifest.json`. Return to the panel tab, click the extension icon and bind that tab, then choose **Browser direct download** from the same tab. The file transfers from Baidu to your computer; the game server only supplies the temporary link.

The extension changes headers only for requests initiated by the manually bound panel tab and addressed to Baidu download hosts. It does not configure a proxy, read page content or save download links. The rule exists only for the current browser session; bind again after restarting the browser. If the temporary link or Baidu policy changes, use the local curl/aria2 command instead. Installation page: `/downloads/baidu-download-helper-guide`.

### 玩家采集插件 / Player bridge

面板与游戏应使用同一个系统账号。以下命令在游戏服务器执行，先按实际路径设置变量。使用游戏自带 SourceMod 编译器，编译成功后才安装；不会重启游戏。

Run as the same operating-system user as the game and panel. Adjust these paths. Compile with the server's SourceMod compiler, and install only after a successful build. No game restart is required.

~~~sh
PANEL=/opt/L4D2-Control
GAME=/srv/l4d2
SM="$GAME/left4dead2/addons/sourcemod"
"$SM/scripting/spcomp64" "$PANEL/sourcemod/L4D2 Control Players.sp" \
  -i"$SM/scripting/include" -o"$SM/plugins/L4D2 Control Players.smx"
~~~

在游戏服务器控制台执行 / In the game server console:

~~~text
sm plugins load "L4D2 Control Players"
l4d2_control_players verify
~~~

若编译器没有执行权限，可将它复制到私有临时目录，仅对副本执行 `chmod u+x` 后编译，不要替换游戏文件。新版本更新时使用 `sm plugins reload "L4D2 Control Players"`。

If the compiler is not executable, copy it to a private temporary directory and apply `chmod u+x` to that copy. To update the bridge, use `sm plugins reload "L4D2 Control Players"`.

插件每 5 秒导出快照，历史在加入/离开与定期保存时写入。私有目录 `left4dead2/addons/sourcemod/data/l4d2 control/` 为 0700，`players.txt` / `history.txt` 为 0600。面板私有状态默认 `~/.local/state/dead-air-panel/players/`，可用 `PLAYER_STATE_DIR` 指定；包括最新修改前配置与权限审计。面板应能读写 SourceMod 的 `configs/admins_simple.ini`，但不要公开这些数据目录。采集插件在面板内被列为受保护核心插件；维护/卸载请在服务器控制台手动执行。

The bridge writes snapshots every five seconds and persists identity history on join/leave and periodically. Its private data directory is mode 0700; `players.txt` and `history.txt` are mode 0600. Panel state defaults to `~/.local/state/dead-air-panel/players/` (override with `PLAYER_STATE_DIR`) and contains the latest pre-edit config and permission audit. The panel needs read/write access to `configs/admins_simple.ini`. Do not publicly serve or commit these directories. The bridge is protected from disabling/deletion in the panel; use the server console for maintenance.

安装后检查“在线玩家”显示实时更新时间；无真人时显示 0，不用机器人伪造玩家。为离线玩家授权时可直接输入 SteamID。修改权限需要 `basecommands`（提供 `sm_reloadadmins`）与 `admin-flatfile` 正常运行。`bfn` 不保证能调用所有第三方插件；根据插件文档设置最小必要权限，避免默认授予 `z`。出现重载/实际权限不匹配时自动恢复原文件。历史或采集不可读时请查看 SourceMod 错误日志及目录权限。

Verify a fresh timestamp in Online Players; zero humans remains zero. An offline player can be configured by SteamID. Permission changes require working `basecommands` (`sm_reloadadmins`) and `admin-flatfile`. `bfn` does not unlock every third-party plugin; choose the least required flags rather than defaulting to `z`. Reload/effective-permission failures restore the previous file. For unreadable history or missing snapshots, inspect SourceMod logs and private-directory permissions.

### 云端地图一键下载 / One-click cloud downloads
无需新增端口或安装 aria2 服务端。面板登录后可在云端地图使用浏览器流式下载；该方式消耗服务器出站带宽。下载器直连命令应在下载者电脑运行，已包含百度请求头。当前下载地址仅接受已配置的 OpenList 或百度域名；不会转发 OpenList 账号令牌。 / No additional port or server-side aria2 is required. Browser downloads use server egress. Run direct downloader commands on the client computer. OpenList service credentials are never forwarded to download hosts.
