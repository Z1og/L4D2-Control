# L4D2-Control

[Home](README.md) · [简体中文](README%20Chinese.md) · [Server deployment guide](docs/Server%20Deployment.md#english-server-deployment-guide)

A web control panel for a Left 4 Dead 2 dedicated server, built with vanilla HTML/CSS/JavaScript and Node.js. Run the backend on the game server and manage it from a browser; no local desktop backend is required. The application UI is primarily Chinese.

## Project preview

Server details in these previews are redacted; the project does not include a real server address, account or password.

| Overview | Map management |
| --- | --- |
| ![Overview](docs/Project%20Preview/Overview.png) | ![Map management](docs/Project%20Preview/Maps.png) |

| Plugin management | Content downloads |
| --- | --- |
| ![Plugin management](docs/Project%20Preview/Plugins.png) | ![Content downloads](docs/Project%20Preview/Downloads.png) |

## Features

| Module | Capabilities |
| --- | --- |
| Maps | Scan the base game, DLC and custom VPKs; collapsible campaigns and chapters; change maps; import VPK/ZIP; export original VPKs; delete custom packages |
| Plugins | Functional categories, enable/disable, SMX import/export and deletion; imported plugins start disabled; core administrative plugins are protected |
| Downloads | In-panel Steam Workshop and GameMaps search and installation, byte progress, cancellation, retry and task-record deletion |
| File sharing | Optional OpenList entry; upload VPKs to your configured cloud-drive storage before sharing; the token stays server-side |
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
| `OPENLIST_URL` | Optional OpenList web address; only credential-free HTTPS URLs are accepted; empty disables sharing |
| `OPENLIST_SHARE_TOKEN` | Dedicated OpenList account token scoped to the map storage; kept only in the server environment and never returned to the browser |
| `OPENLIST_MAPS_PATH` | Public path of the OpenList map storage, default `/l4d2-maps`; upload mode requires a writable cloud-drive storage |
| `OPENLIST_UPLOAD` | `true`/`1` enables manual and automatic VPK backup; `false` only browses and shares existing cloud files |

`.env.example` contains no real credentials. Mihomo, MetaCubeXD, Chrome, the game, plugins and subscriptions are not bundled. `private: true` in package.json prevents accidental npm publication; it does not control GitHub visibility.

## Behavior and limitations

- Map export returns the original VPK with all packaged chapters. Plugin export returns only the SMX, not configuration, translations, gamedata or extensions.
- Back up files in Cloud Maps before creating single-file shares. Only recorded, unchanged successful backups are reused; unknown same-name files produce separate fingerprinted versions and are never overwritten. Initial backup uses the server uplink.
- Whether friends bypass the game server depends on the cloud driver exposing a direct link and OpenList proxy-download settings. Prefer direct-link mode and test the share in a logged-out window.
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

## Read-only diagnostics

Open **服务器自检** (Server diagnostics) and select **开始检查** (Run check). Results are timestamped snapshots; run the check again after changing content or plugin state.

- Map checks compare VPK directory paths in `addons` and its `workshop` subdirectory, considering packages containing BSP maps. They do not load resource payloads, extract or back up maps. Base-game archives, loose resources, other directories, actual mount state and precedence are outside this check. Shared paths indicate potential overrides, not proven faults; addon metadata and preview images are excluded.
- SourceMod checks use fresh `sm plugins list` and `sm plugins info` responses and match filenames to the managed plugin/disabled directories. Loaded, failed, paused, absent, still-loaded disabled files and unknown states are distinct. Other runtime entries are shown separately. The panel needs local Linux mode and access to the game's GNU screen session under the same account. Missing or changing responses are not treated as success.
- Nothing is automatically fixed, disabled or restarted. Bounds are 8 MiB of directory index and 100,000 entries per VPK, 512 packages and 250,000 map-package paths per scan, 200 displayed overlaps, and 256 runtime plugin entries. Unreadable or oversized inputs are marked incomplete. Map results remain available when the game console cannot be queried.

### In-console cloud maps and automatic backup

Cloud Maps lists VPKs from the dedicated OpenList folder without leaving the console. Search files, inspect capacity and per-server backup status, or copy a single-file share link. Advanced storage configuration remains in OpenList.

Enabling automatic backup starts an incremental scan every five minutes on the server. It includes VPKs in `addons` and its `workshop` directory, including map resource parts, but excludes the base game and plugins. Files stream sequentially. Completion is recorded only after upload and remote-size validation; unchanged recorded files are skipped. Changes and name collisions create fingerprinted versions without overwriting or propagating deletion. Closing the browser does not stop the worker; the Stop action aborts the current run and disables the schedule.

Use a dedicated GENERAL account based at `/l4d2-maps`, with write-content and share permissions only. Keep guest access disabled. Configure `OPENLIST_USER` and `OPENLIST_PASSWORD` in the private server environment and set `OPENLIST_API_PATH=/` relative to that account; retain `OPENLIST_MAPS_PATH=/l4d2-maps` as the public mount path. Restart the panel after configuration. Existing `OPENLIST_SHARE_TOKEN` authentication also works, but its scope must be restricted by the operator. Private incremental records can be relocated with `CLOUD_MAPS_STATE_DIR`. Never commit credentials or backup records. Initial uploads still use the game server uplink; direct downloads depend on the cloud driver and proxy settings.

For co-located OpenList, optional `OPENLIST_CONNECT_ADDRESS=127.0.0.1` uses loopback uploads while validating the original HTTPS identity. The cloud-save stage means OpenList has received the file; completion is only recorded after the cloud provider finishes. For slow Baidu uploads, consider one upload thread, 4 MiB slices, and a 600-second per-slice timeout in the driver; the panel does not automatically change these provider settings.

## Players and in-game administrators

Online Players shows real human/bot counts, team, latency, connected duration, and exact SteamID2/3/64 values, with search, copy-ID, history and administrator tabs. Server Diagnostics is in the System sidebar section.

Install the read-only SourceMod bridge from `sourcemod/L4D2 Control Players.sp` as described in the deployment guide. History starts when the bridge is enabled, is not retrospective and excludes IP addresses. Snapshots older than 20 seconds show unknown status and disable permission editing.

Grant, adjust or revoke panel-owned SourceMod permissions by SteamID. Presets: plugin administrator `bfn`, game moderator `bcdfgjk`, or custom flags `a–t` / `z`. Root requires separate confirmation. Use `!admin` / `/admin` for an installed admin menu; each plugin still determines its own command and flag requirements. Permissions do not install plugins.

Only the `L4D2 CONTROL MANAGED ADMINS` block in `admins_simple.ini` is managed. Existing external configuration and runtime permissions from other sources are read-only. Saving reloads the admin cache and checks effective permissions for online players; failure restores the prior file. Offline grants are reported as saved/reloaded, not runtime-verified. No real player is granted access automatically.

Only the latest pre-edit admin configuration is retained, not a whole-server backup. Never commit player history, audit records or administrator configuration.
