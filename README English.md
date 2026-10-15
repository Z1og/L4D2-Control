# L4D2-Control

[Home](README.md) · [简体中文](README%20中文.md) · [Server deployment guide](docs/Server%20Deployment.md#english-server-deployment-guide)

A web control panel for a Left 4 Dead 2 dedicated server, built with vanilla HTML/CSS/JavaScript and Node.js. Run the backend on the game server and manage it from a browser; no local desktop backend is required. The application UI is primarily Chinese.

## Features

| Module | Capabilities |
| --- | --- |
| Maps | Scan the base game, DLC and custom VPKs; collapsible campaigns and chapters; change maps; import VPK/ZIP; export original VPKs; delete custom packages |
| Plugins | Functional categories, enable/disable, SMX import/export and deletion; imported plugins start disabled; core administrative plugins are protected |
| Downloads | In-panel Steam Workshop and GameMaps search and installation, byte progress, cancellation, retry and task-record deletion |
| Content proxy | Mihomo node/subscription import, node export, deletion, switching and subscription refresh; optional MetaCubeXD dashboard |
| Interface | Light/dark themes, user-defined sunrise/sunset schedule, readable labels and mobile layouts |

A Steam subscription alone does not install files on a dedicated server. Installation here is server-side. Deleting a download task does not remove its installed files.

## Quick start

Use Linux with Node.js 22 LTS or a newer supported LTS, GNU screen and an already running L4D2 server. Run the panel as the same Unix user that owns the game's screen session. Plugin operations require MetaMod/SourceMod.

```sh
git clone https://github.com/Z1og/L4D2-Control.git
cd L4D2-Control
npm ci
cp .env.example .env
chmod 600 .env
# Edit .env: game directory, screen session and panel credentials
node --env-file=.env server.js
```

The default URL is `http://127.0.0.1:4174`, reachable only on the server itself. See the [deployment guide](docs/Server%20Deployment.md#english-server-deployment-guide) for systemd, public HTTPS, ports, optional proxy initialization and troubleshooting. `npm start` does not load `.env`; use it only when the environment is provided by your shell or service manager.

## Configuration

| Variable | Purpose |
| --- | --- |
| `L4D2_EXEC_MODE` | Prefer `local` on the game host; `ssh` supports limited remote status/control, not the complete library UI |
| `L4D2_SERVER_ROOT` | Game root containing `left4dead2/`; default `/srv/l4d2` |
| `L4D2_SCREEN_SESSION` | Existing screen session name; default `l4d2` |
| `L4D2_GAME_HOST` / `L4D2_GAME_PORT` | Address displayed/copied by the UI; default port `27015`; does not reconfigure the game listener |
| `L4D2_PLUGIN_PATH` | Optional override for the SourceMod plugins directory |
| `BIND_HOST` / `PORT` | Panel listener; default `127.0.0.1:4174` |
| `PANEL_USER` / `PANEL_PASSWORD` | Browser login; configure credentials before public exposure |
| `PANEL_AUTH_TOKEN` | Optional API token via Bearer or X-Panel-Token |
| `PANEL_TLS_KEY` / `PANEL_TLS_CERT` | TLS private key and full certificate chain |
| `WORKSHOP_SOCKS_PROXY` | Content-only loopback SOCKS5h endpoint, such as `socks5h://127.0.0.1:10808` |
| `WORKSHOP_PROXY_ENGINE` | `mihomo`, or empty for the legacy Xray adapter; both need separate setup |
| `STEAMCMD_PATH` | SteamCMD launcher; default `/opt/steamcmd/steamcmd.sh` |
| `GAMEMAPS_BROWSER_BIN` | Optional Chrome executable; headless Linux hosts also need Xvfb |

`.env.example` contains no real credentials. Mihomo, MetaCubeXD, Chrome, the game, plugins and subscriptions are not bundled. `private: true` in package.json prevents accidental npm publication; it does not control GitHub visibility.

## Behavior and limitations

- Map export returns the original VPK with all packaged chapters. Plugin export returns only the SMX, not configuration, translations, gamedata or extensions.
- Map/content installation accepts VPK/ZIP, not RAR/7z, split VPKs or executable installers. Paths, headers, sizes and filename conflicts are checked.
- Official maps and custom packages containing the confirmed running map cannot be deleted. Removed files are retained in a private recovery directory for manual restoration.
- Installation is serialized. Unknown totals use indeterminate progress. Interrupted jobs become failed after restart; there is no automatic partial-download resumption or game restart.
- Steam prefers official HTTPS files, falling back to SteamCMD anonymous downloads only when metadata lacks a public file URL. Some items do not permit anonymous downloads.
- GameMaps verification, rate limits and proxy availability can cause failures; the optional browser adapter does not guarantee access.
- Configured content requests do not fall back to direct connections when the proxy fails. System, game and SSH traffic are not redirected. Subscription retrieval uses a separate HTTPS connection, not the content SOCKS proxy.
- Origin validation uses the request's actual TLS state. Direct HTTPS is recommended; a basic HTTPS-to-HTTP reverse proxy can break write operations.
- Bilingual documentation is not a UI language switch. The players view and activity feed are not a full player-management or persistent audit system.

## Testing and maintenance

```sh
npm test
```

Tests use temporary files and fixtures, not a real game server. Windows skips Linux-specific cases; use Linux for the complete suite. Back up private configuration and state, update with `git pull --ff-only` and `npm ci`, and restart the panel service. The game is not restarted automatically.

Existing internal state names, including `~/.local/state/dead-air-panel/` and `~/.config/dead-air-mihomo/`, remain unchanged for compatibility with existing installations.

## Credits

Visual guidance from [COUI](https://github.com/suqi8/coui), without using its Compose components. Icons use [Lucide](https://lucide.dev/), currently loaded from unpkg. Steam and GameMaps are independent third-party services; this is not an official product of either provider.
