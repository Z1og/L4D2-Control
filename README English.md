# L4D2-Control · 今天一定要活下去

![L4D2-Control · 今天一定要活下去](assets/Project%20poster%20desktop.webp)

> **QQ community group：1002677414** · Search this group number in QQ to join.
> Copy the group number on the login page or open “About project” inside the panel.

[Desktop poster](assets/Project%20poster%20desktop.png) · [Mobile poster](assets/Project%20poster%20mobile.png)

[About and QQ community](docs/Project%20Preview/About.png) · [Server settings and activity log](docs/Project%20Preview/Settings.png)

> Original project contributions are available for non-commercial use. Commercial use requires written authorization. See [LICENSE](LICENSE) and [project provenance](docs/Project%20Provenance.md).


> [!IMPORTANT]
> **如果本项目对你有帮助别忘了点一下star⭐**
> If this project helps you, please click **Star ⭐** in the upper-right corner of this repository.

**English name: L4D2-Control** · **Chinese name: 今天一定要活下去**.

[Home](README.md) · [简体中文](README%20Chinese.md) · [Server deployment guide](docs/Server%20Deployment.md#english-server-deployment-guide)

A web control panel for a Left 4 Dead 2 dedicated server, built with vanilla HTML/CSS/JavaScript and Node.js. Run the backend on the game server and manage it from a browser; no local desktop backend is required. The application UI is primarily Chinese.

## Cloud-drive compatibility

Map cloud backup and **Direct download export (recommended)** are currently adapted and tested with **Baidu Netdisk mounted through OpenList**. The bundled Chrome/Edge helper only handles Baidu download domains; it is not a general-purpose cloud-drive extension. Other OpenList storage drivers have not received equivalent validation.

OpenList and Baidu Netdisk are optional. Local map and plugin management and **Server download export** remain available without a cloud drive. Configure authorization and credentials in your own OpenList instance and private server environment. No cloud accounts, tokens or subscriptions are included in this repository.

> **SVIP validation note：** The Baidu Netdisk account used for validation has **SVIP** enabled. Download behavior for accounts without SVIP has not been tested; whether this affects the download service remains unknown.

## Project preview

[Desktop and mobile login preview](docs/Project%20Preview/Community.png) · [Mobile login screenshot](docs/Project%20Preview/Login%20mobile.png)

Server details in these previews are redacted; the project does not include a real server address, account or password.

| Login | Gameplay |
| --- | --- |
| ![Login](https://raw.githubusercontent.com/Z1og/L4D2-Control/200a958e860dacaf8c7b6f77f032f288ae828479/docs/Project%20Preview/Login.png) | ![Gameplay](https://raw.githubusercontent.com/Z1og/L4D2-Control/793f96b31fb4f850f895460b391b8c71fea33f8d/docs/Project%20Preview/Gameplay.png) |

| Overview | Map management |
| --- | --- |
| ![Overview](https://raw.githubusercontent.com/Z1og/L4D2-Control/793f96b31fb4f850f895460b391b8c71fea33f8d/docs/Project%20Preview/Overview.png) | ![Map management](https://raw.githubusercontent.com/Z1og/L4D2-Control/793f96b31fb4f850f895460b391b8c71fea33f8d/docs/Project%20Preview/Maps.png) |

| Plugin management | Content downloads |
| --- | --- |
| ![Plugin management](https://raw.githubusercontent.com/Z1og/L4D2-Control/793f96b31fb4f850f895460b391b8c71fea33f8d/docs/Project%20Preview/Plugins.png) | ![Content downloads](https://raw.githubusercontent.com/Z1og/L4D2-Control/793f96b31fb4f850f895460b391b8c71fea33f8d/docs/Project%20Preview/Downloads.png) |

## Features

| Module | Capabilities |
| --- | --- |
| Login | Separate ordinary and authorized accounts; numeric Steam profile linkage with an independent panel password; no Steam authorization; ordinary users receive read-only views and direct map downloads |
| Gameplay | Live mode/difficulty settings, cooperative player/Bot limits, confirmed save and map reload; runtime capacity detection and persistent map-cycle settings |
| Maps | Scan the base game, DLC and custom VPKs; collapsible campaigns and chapters; change maps; import VPK/ZIP; export original VPKs; delete custom packages |
| Plugins | Functional categories, enable/disable, SMX import/export and deletion; imported plugins start disabled; core administrative plugins are protected |
| Downloads | Separate **Map downloads** and **Plugin downloads** sections; search Steam Workshop, GameMaps and the LaoYutang plugin store, with byte progress, cancel/retry/history deletion; the plugin catalog and compiled SMX files sync to the server every six hours by default |
| Browser direct download | A Chrome/Edge extension saves Baidu direct-link files to the local computer without using the game server's outbound bandwidth; it is limited to the panel tab explicitly bound by the user |
| File sharing | Optional OpenList entry; upload VPKs to your configured cloud-drive storage before sharing; the token stays server-side |
| Content proxy | Mihomo node/subscription import, node export, deletion, switching and subscription refresh; optional MetaCubeXD dashboard |
| Interface | Light/dark themes, user-defined sunrise/sunset schedule, readable labels and mobile layouts |

A Steam subscription alone does not install files on a dedicated server. Installation here is server-side. Deleting a download task does not remove its installed files.

## Quick start

Use Linux with Node.js 22 LTS or a newer supported LTS, GNU screen and an already running L4D2 server. Run the panel as the same Unix user that owns the game's screen session. Plugin operations require MetaMod/SourceMod.

```sh
git clone https://github.com/Z1og/L4D2-Control.git L4D2-Control
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
| `PLUGIN_STORE_REFRESH_SECONDS` | Plugin catalog and SMX synchronization interval; default 21600 seconds (six hours), accepted range 60 seconds to seven days |
| `PLUGIN_STORE_SYNC_ENABLED` | Startup and scheduled sync switch; defaults to `true`; manual refresh remains available |
| `PLUGIN_STORE_CACHE_DIR` | Private plugin-store cache; defaults to `~/.local/state/dead-air-panel/plugin store` |
| `OPENLIST_URL` | Optional OpenList web address; only credential-free HTTPS URLs are accepted; empty disables sharing |
| `OPENLIST_SHARE_TOKEN` | Dedicated OpenList account token scoped to the map storage; kept only in the server environment and never returned to the browser |
| `OPENLIST_MAPS_PATH` | Public path of the OpenList map storage, default `/l4d2-maps`; upload mode requires a writable cloud-drive storage |
| `OPENLIST_UPLOAD` | `true`/`1` enables manual and automatic VPK backup; `false` only browses and shares existing cloud files |

`.env.example` contains no real credentials. Mihomo, MetaCubeXD, Chrome, the game, plugins and subscriptions are not bundled. `private: true` in package.json prevents accidental npm publication; it does not control GitHub visibility.

## Behavior and limitations

- Map export returns the original VPK with all packaged chapters. Plugin export returns only the SMX, not configuration, translations, gamedata or extensions.
- Use **Server Diagnostics → Map cloud backup** for manual or automatic backups. Only recorded, unchanged successful backups are reused; unknown same-name files produce separate fingerprinted versions and are never overwritten. Initial backup uses the server uplink.
- Whether friends bypass the game server depends on the cloud driver exposing a direct link and OpenList proxy-download settings. Prefer direct-link mode and test the share in a logged-out window.
- Map/content installation accepts VPK/ZIP, not RAR/7z, split VPKs or executable installers. Paths, headers, sizes and filename conflicts are checked.
- Official maps and custom packages containing the confirmed running map cannot be deleted. Removed files are retained in a private recovery directory for manual restoration.
- Installation is serialized. Unknown totals use indeterminate progress. Interrupted jobs become failed after restart; there is no automatic partial-download resumption or game restart.
- Steam prefers official HTTPS files, falling back to SteamCMD anonymous downloads only when metadata lacks a public file URL. Some items do not permit anonymous downloads.
- GameMaps verification, rate limits and proxy availability can cause failures; the optional browser adapter does not guarantee access.
- Baidu direct links can be downloaded locally with curl/aria2 or the panel's Chrome/Edge extension. The extension sets Baidu's required User-Agent and Referer only for requests to `*.baidupcs.com` / `*.pcs.baidu.com` from the panel tab explicitly bound by the user, and only for the current browser session; bind again after restarting the browser. The ZIP and bilingual instructions are available from the map card's **Direct download export (recommended)** dialog, or at `/downloads/baidu-download-helper-guide`.
- The plugin store syncs compiled `.smx` files from enabled plugin folders in the selected GitHub repository. Git blob hashes and file sizes are checked; the last successful catalog is retained if the upstream is unavailable. Installation imports only the `.smx` to SourceMod's disabled folder; configs, translations, gamedata, extensions and other dependencies are not installed automatically. Read the upstream notes before enabling. The server must reach `api.github.com` and `raw.githubusercontent.com`; this sync does not use the Workshop/GameMaps-only content proxy.
- OpenList is a virtual cloud-drive layer, not a speed booster. If a download is proxied through OpenList, throughput is bounded by the slowest of Baidu's upstream, the OpenList host's outbound link and the client's route. Data can bypass the OpenList host only when the driver returns a usable direct/302 link and the client can reach it. The first map backup still uses the game server's uplink; a server cache can avoid repeated upstream reads, not accelerate the first Baidu transfer.
- Configured content requests do not fall back to direct connections when the proxy fails. System, game and SSH traffic are not redirected. Subscription retrieval uses a separate HTTPS connection, not the content SOCKS proxy.
- Origin validation uses the request's actual TLS state. Direct HTTPS is recommended; a basic HTTPS-to-HTTP reverse proxy can break write operations.
- Bilingual documentation is not a UI language switch. The activity feed is session-local; permission and moderation audits are stored separately in private server files.

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

The standalone Cloud Maps page has been removed. Backup status, manual backup, the automatic-backup switch and stop action are grouped under **Server Diagnostics → Map cloud backup**. This page reports server backup state only; it does not browse or list cloud-drive files. Operators still manage OpenList itself through their OpenList page.

Enabling automatic backup starts an incremental scan every five minutes on the server. It includes VPKs in `addons` and its `workshop` directory, including map resource parts, but excludes the base game and plugins. Files stream sequentially. Completion is recorded only after upload and remote-size validation; unchanged recorded files are skipped. Changes and name collisions create fingerprinted versions without overwriting or propagating deletion. Closing the browser does not stop the worker; the Stop action aborts the current run and disables the schedule.

Use a dedicated GENERAL account based at `/l4d2-maps`, with write-content and share permissions only. Keep guest access disabled. Configure `OPENLIST_USER` and `OPENLIST_PASSWORD` in the private server environment and set `OPENLIST_API_PATH=/` relative to that account; retain `OPENLIST_MAPS_PATH=/l4d2-maps` as the public mount path. Restart the panel after configuration. Existing `OPENLIST_SHARE_TOKEN` authentication also works, but its scope must be restricted by the operator. Private incremental records can be relocated with `CLOUD_MAPS_STATE_DIR`. Never commit credentials or backup records. Initial uploads still use the game server uplink; direct downloads depend on the cloud driver and proxy settings.

For co-located OpenList, optional `OPENLIST_CONNECT_ADDRESS=127.0.0.1` uses loopback uploads while validating the original HTTPS identity. The cloud-save stage means OpenList has received the file; completion is only recorded after the cloud provider finishes. For slow Baidu uploads, consider one upload thread, 4 MiB slices, and a 600-second per-slice timeout in the driver; the panel does not automatically change these provider settings.

## Player management, in-game administrators and admission whitelist

Player Management shows real human/bot counts, team, latency, connected duration, and exact SteamID2/3/64 values, with search, copy-ID, history and administrator tabs. Server Diagnostics is in the System sidebar section.

Install the SourceMod player-management bridge from `sourcemod/L4D2 Control Players.sp` as described in the deployment guide. History starts when the bridge is enabled, is not retrospective; recent connection IPs are retained for 30 days and visible only to authorized users. Snapshots older than 20 seconds show unknown status and disable permission editing.

Grant, adjust or revoke panel-owned SourceMod permissions by SteamID. Presets: plugin administrator `bfn`, game moderator `bcdfgjk`, or custom flags `a–t` / `z`. Root requires separate confirmation. Use `!admin` / `/admin` for an installed admin menu; each plugin still determines its own command and flag requirements. Permissions do not install plugins.

Only the `L4D2 CONTROL MANAGED ADMINS` block in `admins_simple.ini` is managed. Existing external configuration and runtime permissions from other sources are read-only. Saving reloads the admin cache and checks effective permissions for online players; failure restores the prior file. Offline grants are reported as saved/reloaded, not runtime-verified. No real player is granted access automatically.

Only the latest pre-edit admin configuration is retained, not a whole-server backup. Never commit player history, audit records or administrator configuration.

The Game Admission Whitelist accepts SteamID2/3/64, numeric profile URLs, and custom `/id/` profile URLs. Resolving a custom URL requires the panel host to reach Steam Community. Entries can be maintained while admission restrictions are off. When enabled, the SourceMod bridge rejects non-bot players who are not listed after admin checks complete. SourceMod administrators are automatically allowed. Disabling the mode preserves all entries. The list is stored in the private `left4dead2/addons/sourcemod/data/l4d2 control/whitelist.txt` file and must not be committed. Compile and hot-reload **L4D2 Control Players 1.4.0+**; updating the website alone does not update the in-game plugin.

### Map download and export

Map cards provide **Direct download export (recommended)** and **Server download export**. Direct export is available only for maps with a verified cloud backup and a Baidu direct link. The browser link is refreshed when clicked, and the curl/aria2 link is refreshed immediately before copying. Temporary links expire, so run a copied command promptly.

Download Helper 1.2.1 or later is required. Download the new ZIP, replace the files in the existing extension folder, click Reload on the browser extensions page and confirm the version. Return to the panel and bind its tab again. Refreshing the website alone does not update an extension; same-tab reloads reconnect automatically. Rebind after opening a new tab, restarting the browser or updating the extension. The helper checks its binding, refreshes the signed link, verifies the VPK header and file size from your computer, then starts the download from the bound tab while keeping the panel open. Missing bindings and failed checks are reported in the dialog. Check the browser download list for final completion.

---

### ⭐ 如果本项目对你有帮助别忘了点一下star⭐

Your star helps more Left 4 Dead 2 server owners discover this project.

## Restart, kick and timed bans

- The Overview restart button sits before Quick Map and requires confirmation. It reports progress and supports a single Linux game process supervised by `srcds_run` with automatic restart, under the same account and host as the panel. Unsupported supervisors and `-norestart` are rejected.
- Kick current players individually or with batch selection. The confirmation offers kick only, kick and ban, or cancel; kick and ban opens a duration selector before submission.
- Ban recorded Steam identities for **1, 3, 7, 30, 180 or 3650 days**. The banned-player tab supports changing durations and unbanning, including batches of up to 100 identities. Changing a duration restarts its countdown from confirmation time.
- The SourceMod bridge enforces bans when players join. Bans expire automatically and survive server restarts without an open browser. Only panel-owned bans are changed; other plugins' bans are preserved.
- Recompile and reload **L4D2 Control Players 1.4.0+** after upgrading. A page refresh does not update the game plugin. Private `bans.txt` and `moderation audit.jsonl` files live in `left4dead2/addons/sourcemod/data/l4d2 control/`; never publish these records.

## Authorized and ordinary sign-in

**授权登录 (Authorized sign-in)** uses the operator's `PANEL_USER` / `PANEL_PASSWORD`. **普通登录 (Ordinary sign-in)** uses a numeric Steam profile URL or SteamID64 plus a separate panel password, registered on first use. No Steam OpenID/OAuth or Steam password is involved. Vanity `/id/` URLs are not supported. Profile linkage is **self-declared, not proof of Steam account ownership**, and never grants game administrator privileges.

Ordinary accounts can view public status, maps and plugins and request direct-download information for backed-up maps. The backend denies proxy, gameplay, player records, system tools, uploads, deletion, installation and server-relayed export. The Panel Accounts tab shows accounts and login/operation records to authorized users. Active panel SteamID bans prevent sign-in and revoke existing sessions on the next request.

Passwords use salted scrypt hashes in private server storage. Login/operation IPs, access logs and recent game IPs are retained for **30 days**. Province-level labels use an offline local database and are approximate; user IPs are never sent to a geolocation API. Accounts, SteamIDs and ban records persist beyond the IP retention period. Sessions use HttpOnly cookies with CSRF checks; restarting the panel requires signing in again. Use HTTPS for public access.

## Gameplay and multiplayer rooms

Game Mode appears above Maps in the sidebar. Authorized users can select campaign, realism, versus, survival or scavenge, adjust difficulty, permit direct joining, and configure expanded co-op slots and initial bots.

Expanded rooms require running `l4d2_sv_maxplayers` and `bots` plugins. Limits are read from live ConVars, not assumed. This adapter uses `bots_limit` / `bots_join_limit`; unsupported plugins remain unavailable. Capacity cannot be reduced below the online human count. Disabling expanded rooms restores standard capacity: 4 for co-op/realism/survival and 8 for versus/scavenge.

Changes require confirmation and read-back; mismatches restore previous values. Settings persist in SourceMod's private `data/l4d2 control/gameplay.txt`, restored after map configs by version **1.3.0+** of this project's player bridge. Mode and initial bot changes may require a map reload. Reload has separate confirmation and resets current progress; the chosen map must support the mode. Deploying the panel does not change live gameplay settings.

## Browsing continuity and player notes

- Reload keeps the current section, plugin category, search text, expanded map campaigns, player tab, and the scroll position of each page and sidebar within the same browser tab. Public content search results are restored locally without automatically searching providers again.
- Once the verified direct download is handed to the browser, its dialog closes. Verification errors keep the dialog open.
- Authorized administrators can add, edit, search and clear player notes. Notes are attached to the SteamID and remain available when a player renames or goes offline; ordinary accounts cannot read or modify them.
- The login page uses concise login/access explanations. Existing private login and operational record handling remains documented in the deployment guide.

## Ordinary account passwords

- Signed-in ordinary users can choose “Change password” in the panel header, supply their current password, and confirm the new one twice.
- Authorized administrators can open Player Management → Panel Accounts and choose “Clear panel password” and explicitly confirm. The player must register again using the same SteamID; account history, name, notes, game permissions and bans remain intact.
- Password changes and clears invalidate all existing panel sessions for that SteamID while preserving other accounts. Passwords are 8–128 characters, stored only as salted hashes, and never included in audit events.
- Forgotten passwords require a server-owner clear followed by re-registration. A prominent first-time registration button is available on the login page.

The ordinary login page includes a sanitized Steam profile-link guide. Password clears remove the salt and hash instead of assigning a temporary password. Re-registration writes a fresh salted scrypt hash and retains the account record. Project fingerprints identify selected source files, never visitors or devices; they do not prevent removal of publicly available source markers.

### Built-in project attribution
The System → About page contains the project introduction, QQ group and license notice. This identity is rendered by the server and has no dashboard switch to hide it. Official fingerprint builds reject missing attribution entries or inconsistent identity metadata. Hash checks detect changes; they are not release signatures or DRM and cannot prevent a source-code owner from modifying the checker. The activity log is under Server settings; the health-check entry is named 服务检查.

### Historical platform versions

Open **Plugins & Platforms → Platforms**, then **Fetch / refresh versions**. Choose a branch or compatibility build and a target version. The catalog lists publisher-hosted Source 1 Linux MetaMod / SourceMod builds and L4DToolZ / Stripper release assets still available for download. Source 2, Windows-only assets and deleted upstream files are excluded. Historical mixed ZIP packages install only L4D2 Linux files.

Selecting a version only previews its cautions and available upstream release notes. Installation, upgrades and downgrades require a separate action and confirmation. Existing configs and SMX plugins are preserved; obsolete managed binaries are removed transactionally. One previous file change can be rolled back. Restart the game manually afterwards and verify runtime versions. Missing per-build notes are explicitly indicated; availability is not a guarantee of compatibility with the current game or plugins. Test historical versions and their dependencies on a staging game server first.


### Appearance themes

Use Server Settings → Appearance or the top-right palette button to choose Classic COUI / Cupertino and six accent colors. Light, dark and custom sunrise/sunset modes are independent. Preferences are browser-local and shared by sign-in and panel pages, without changing the server or other users. Cupertino is an original web implementation inspired by [compose-cupertino](https://github.com/alexzhirkevich/compose-cupertino), not an embedded Kotlin library.

## Survivor Radio

The built-in catalogue contains 50 classic campaigns researched from Bilibili features, a Heybox curated collection and GameMaps release pages, with Chinese summaries, tags, source attribution and usage notes. Upgrades preserve administrator edits, removed entries and cached feeds. Catalogue inclusion does not imply installation or playtesting.

The sidebar entry below Player Management contains Map News and Guides & Q&A. Signed-in ordinary users can read; administrators can curate classic campaigns, save public Bilibili/Heybox links with attribution, and write solutions with map associations, tags, applicability and verification dates. Search, pinning, pagination, browser-session bookmarks and JSON export of curated entries are included.

Manual map refresh checks up to 90 recently updated Steam Campaigns entries, verifies app 550, update timestamps, package size and explicit campaign evidence, and retains entries updated within one calendar month. Multipart campaigns remain separate Workshop entries. Entries without explicit map evidence go to an administrator-only review queue, where entries can be dismissed or curated as classics. This also applies to music and texture patches tagged only as Campaigns. This metadata screening is not downloaded-file verification. Guides are collected from Steam's Simplified Chinese tagged, top-rated directory and filtered for Chinese text in titles or summaries; up to 90 candidates are checked and 30 shown. Author-provided summaries are not independently verified. Bilibili search and the Heybox community provide discovery entry points with manual link curation rather than cookie-dependent scraping.

Foreign feed summaries are translated into Chinese with Microsoft Translator during manual refresh, with originals available in the detail dialog. Unchanged summaries reuse cached translations. Only public summaries are sent through the content proxy; failures preserve the original and show the reason. Ordinary accounts can view live mode, difficulty and room capacity, while gameplay mutations remain administrator-only.

Only explicit refresh requests collect external data through the configured content proxy. Cached content survives restarts and failed refreshes; expired maps leave the recent list automatically. Curated content and cache live in `~/.local/state/dead-air-panel/broadcast/broadcast.json` (override with `BROADCAST_STATE_DIR`). Back up that private directory and keep it out of public repositories. Curated JSON exports exclude feed caches and panel accounts.
