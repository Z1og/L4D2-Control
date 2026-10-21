const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { execFile } = require('child_process');
const { Client } = require('ssh2');
const { mapInventory, pluginInventory } = require('./inventory');
const { scanVpkConflicts, collectPluginRuntime, inspectPluginRuntime, extractConsoleFrame } = require('./diagnostics');
const proxyManager = require(process.env.WORKSHOP_PROXY_ENGINE === 'mihomo' ? './mihomo manager' : './proxy manager');
const { createSource } = require('./content sources');
const { createSource: createSteamSource, parseSearch: parseSteamSearch, buildSearchUrl } = require('./steam source');
const { createManager } = require('./download manager');
const { createPluginStore } = require('./plugin store');
const { createLibrary } = require('./library manager');
const { PROJECT_URL, parseConfig: parseOpenListConfig, createManager: createOpenListManager } = require('./openlist manager');

const { createCloudMaps } = require('./cloud maps');
const { createPlayerManager } = require('./player manager');

const root = __dirname;
const port = Number(process.env.PORT || 4174);
const bindHost = process.env.BIND_HOST || '127.0.0.1';
const executionMode = String(process.env.L4D2_EXEC_MODE || 'ssh').toLowerCase();
if (!['ssh', 'local'].includes(executionMode)) throw new Error('L4D2_EXEC_MODE must be ssh or local');
const localMode = executionMode === 'local';
const serverRoot = process.env.L4D2_SERVER_ROOT || '/srv/l4d2';
const pluginPath = process.env.L4D2_PLUGIN_PATH || `${serverRoot}/left4dead2/addons/sourcemod/plugins`;
const tlsKey = process.env.PANEL_TLS_KEY || path.join(os.homedir(), '.config', 'dead-air-panel', 'key.pem');
const tlsCert = process.env.PANEL_TLS_CERT || path.join(os.homedir(), '.config', 'dead-air-panel', 'cert.pem');
const screenSession = process.env.L4D2_SCREEN_SESSION || 'l4d2';
if (!/^[A-Za-z0-9_.-]+$/.test(screenSession)) throw new Error('L4D2_SCREEN_SESSION contains invalid characters');
const panelUser = process.env.PANEL_USER || process.env.PANEL_USERNAME || 'admin';
const panelPassword = process.env.PANEL_PASSWORD || '';
const panelToken = process.env.PANEL_AUTH_TOKEN || '';
const workshopProxy = process.env.WORKSHOP_SOCKS_PROXY || '';
if (workshopProxy && !/^socks5h:\/\/127\.0\.0\.1:\d{2,5}$/.test(workshopProxy)) throw new Error('WORKSHOP_SOCKS_PROXY must be a local socks5h URL');
const gameMaps = createSource(workshopProxy);
const steamSource = createSteamSource(workshopProxy, { search: fetchSteamWorkshop });
const steamcmdPath = process.env.STEAMCMD_PATH || '/opt/steamcmd/steamcmd.sh';
const workshopAddonDir = process.env.WORKSHOP_ADDON_DIR || `${serverRoot}/left4dead2/addons`;
const workshopStageDir = process.env.WORKSHOP_STAGE_DIR || '/tmp/dead-air-workshop';
const pluginStore = createPluginStore();
const openList = createOpenListManager({ serverRoot, addonDir: workshopAddonDir, config: parseOpenListConfig() });
const cloudMaps = createCloudMaps({ addonDir: workshopAddonDir, stateDir: process.env.CLOUD_MAPS_STATE_DIR || path.join(os.homedir(), '.local', 'state', 'dead-air-panel', 'cloud maps'), inventory: () => mapInventory(serverRoot) });
async function refreshPlayerSnapshot(reload = false) {
  const nonce = crypto.randomBytes(12).toString('hex');
  const output = await captureDiagnosticConsole([...(reload ? ['sm_reloadadmins'] : []), `l4d2_control_players ${nonce}`]);
  if (!output.includes('L4D2CONTROL_SNAPSHOT ' + nonce) || /Unknown command.*sm_reloadadmins/i.test(output)) throw new Error('SourceMod 未确认玩家状态更新');
}
const playerManager = createPlayerManager({ serverRoot, stateDir: process.env.PLAYER_STATE_DIR || path.join(os.homedir(), '.local', 'state', 'dead-air-panel', 'players'), reloadAdmins: () => refreshPlayerSnapshot(true), refreshSnapshot: () => refreshPlayerSnapshot() });
const sshConfig = {
  host: process.env.L4D2_SSH_HOST || '',
  port: Number(process.env.L4D2_SSH_PORT || 22),
  username: process.env.L4D2_SSH_USER || '',
  password: process.env.L4D2_SSH_PASSWORD
};
const gameHost = process.env.L4D2_GAME_HOST || sshConfig.host;
const gamePort = Number(process.env.L4D2_GAME_PORT || 27015);
if (gameHost && !/^[A-Za-z0-9.:-]+$/.test(gameHost)) throw new Error('L4D2_GAME_HOST contains invalid characters');
if (!Number.isInteger(gamePort) || gamePort < 1 || gamePort > 65535) throw new Error('L4D2_GAME_PORT is invalid');
const gameAddress = gameHost ? `${gameHost.includes(':') ? '[' + gameHost + ']' : gameHost}:${gamePort}` : '';
const state = { currentMap: 'c5m1_waterfront', lastSync: null };
const library = createLibrary({ serverRoot, addonDir: workshopAddonDir, pluginPath,
  currentMap: async () => { const live = await status(); if (!live.mapConfirmed) throw Object.assign(new Error('无法确认当前地图，请稍后重试'), { status: 409 }); return live.currentMap; },
  unloadPlugin: id => runCommand(screenCommand(`sm plugins unload ${id}`)) });
const downloads = createManager({ addonDir: workshopAddonDir, steamcmdPath, workshopProxy, localMode, gameMapsSource: gameMaps, steamSource,
  pluginStoreSource: pluginStore, pluginInstaller: (name, stream) => library.importFile('plugins', name, stream) });

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function runSsh(command) {
  if (!sshConfig.host || !sshConfig.username) return Promise.reject(new Error('Set L4D2_SSH_HOST and L4D2_SSH_USER'));
  if (!sshConfig.password) return Promise.reject(new Error('L4D2_SSH_PASSWORD is not set'));
  return new Promise((resolve, reject) => {
    const client = new Client();
    let output = '';
    let error = '';
    client.on('ready', () => {
      client.exec(command, (execError, stream) => {
        if (execError) { client.end(); reject(execError); return; }
        stream.on('data', data => { output += data.toString(); });
        stream.stderr.on('data', data => { error += data.toString(); });
        stream.on('close', code => { client.end(); code === 0 ? resolve({ output, error, code }) : reject(new Error(error || `remote exit ${code}`)); });
      });
    }).on('error', reject).connect(sshConfig);
  });
}

function runLocal(command, timeout = 15000) {
  return new Promise((resolve, reject) => {
    execFile(process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : '/bin/bash', process.platform === 'win32' ? ['/d', '/s', '/c', command] : ['-lc', command], { cwd: serverRoot, timeout, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error((stderr || stdout || error.message).trim() || `local exit ${error.code ?? 1}`));
        return;
      }
      resolve({ output: stdout, error: stderr, code: 0 });
    });
  });
}

function runCommand(command, timeout) {
  return localMode ? runLocal(command, timeout) : runSsh(command);
}

function screenCommand(command) {
  const screen = `screen -S ${shellQuote(screenSession)} -p 0 -X stuff "$(printf '%s\\r' ${shellQuote(command)})"`;
  return `bash -lc ${shellQuote(screen)}`;
}

async function status() {
  await runCommand(screenCommand('status'));
  await runCommand(screenCommand('sm plugins list'));
  // screen runs outside the panel's systemd PrivateTmp namespace.
  const consoleDir = path.join(os.homedir(), '.local', 'state', 'dead-air-panel', 'console');
  if (localMode) fs.mkdirSync(consoleDir, { recursive: true, mode: 0o700 });
  const consoleFile = localMode ? path.join(consoleDir, `${crypto.randomUUID()}.txt`) : `/tmp/dead-air-console-${crypto.randomUUID()}.txt`;
  const quotedFile = shellQuote(consoleFile);
  const command = `sleep 0.3; screen -S ${shellQuote(screenSession)} -X hardcopy -h ${quotedFile}; ss -lntup 2>/dev/null | grep -E ':${gamePort}\\b' || true; ps -ef | grep srcds_linux | grep -v grep || true; grep -E 'map[[:space:]]*:' ${quotedFile} | tail -1 || true; grep -E 'Admin Menu|adminmenu' ${quotedFile} | tail -3 || true; rm -f ${quotedFile}`;
  let result;
  try { result = await runCommand(`bash -lc ${shellQuote(command)}`); }
  finally { if (localMode) fs.rmSync(consoleFile, { force: true }); }
  const mapMatch = result.output.match(/map\s*:\s*([a-z0-9_]+)/i);
  if (mapMatch) state.currentMap = mapMatch[1];
  const adminMenuMatch = result.output.match(/[^\n]*Admin Menu[^\n]*/i);
  state.lastSync = new Date().toISOString();
  return { mapConfirmed: !!mapMatch, connected: true, host: gameHost, port: gamePort, currentMap: state.currentMap, online: /srcds_linux/.test(result.output), adminMenuStatus: adminMenuMatch?.[0]?.trim() || 'not present in console buffer', controlMode: executionMode, lastSync: state.lastSync };
}

// A fresh nonce frame excludes old scrollback, while bounded retries allow a busy game tick.
async function captureDiagnosticConsole(commands) {
  const id = crypto.randomBytes(8).toString('hex');
  const begin = `L4D2CHECK_BEGIN_${id}`, end = `L4D2CHECK_END_${id}`;
  const consoleDir = path.join(os.homedir(), '.local', 'state', 'dead-air-panel', 'console');
  await fs.promises.mkdir(consoleDir, { recursive: true, mode: 0o700 });
  const file = path.join(consoleDir, `${crypto.randomUUID()}.txt`);
  try {
    await runCommand(screenCommand([`echo ${begin}`, ...commands, `echo ${end}`].join('\r')));
    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 200));
      await runCommand(`screen -S ${shellQuote(screenSession)} -p 0 -X hardcopy -h ${shellQuote(file)}`);
      let handle;
      try { handle = await fs.promises.open(file, 'r'); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      let output;
      try {
        const size = (await handle.stat()).size;
        if (size > 1024 * 1024) throw new Error('Console snapshot exceeds limit');
        output = await handle.readFile('utf8');
      } finally { await handle.close(); }
      const frame = extractConsoleFrame(output, begin, end);
      if (frame !== null) return frame;
    }
    throw new Error('Fresh console response timed out');
  } finally { await fs.promises.rm(file, { force: true }); }
}

let diagnosticsPending;
function diagnostics() {
  if (diagnosticsPending) return diagnosticsPending;
  diagnosticsPending = (async () => {
    const checkedAt = new Date().toISOString();
    let plugins;
    const maps = await scanVpkConflicts(workshopAddonDir);
    try {
      if (!fs.statSync(pluginPath).isDirectory()) throw new Error('Plugin directory missing');
      const disk = pluginInventory(pluginPath);
      plugins = await collectPluginRuntime(disk, captureDiagnosticConsole);
      if (JSON.stringify(disk) !== JSON.stringify(pluginInventory(pluginPath))) {
        plugins = inspectPluginRuntime(pluginInventory(pluginPath), { available: false, entries: [], partial: true, reason: '检查期间插件文件状态发生变化，请重新检查' });
      }
    } catch { plugins = inspectPluginRuntime([], { available: false, entries: [], partial: true, reason: '无法读取插件目录，请检查服务器路径和读取权限' }); }
    return { checkedAt, completedAt: new Date().toISOString(), maps, plugins };
  })().finally(() => { diagnosticsPending = null; });
  return diagnosticsPending;
}

function pluginFile(name) {
  const known = {
    'Admin Menu': 'adminmenu', 'Basic Commands': 'basecommands', 'Basic Chat': 'basechat', 'Basic Votes': 'basevotes',
    'Reserved Slots': 'reservedslots', 'Client Preferences': 'clientprefs', 'Admin Flat File': 'admin-flatfile',
    'Map Changer': 'map_changer', 'L4D2 Native vote': 'l4d2_nativevote', 'Left 4 DHooks Direct': 'left4dhooks',
    'Left4DHooks': 'left4dhooks', 'MetaMod:Source': 'metamod', 'Stripper': 'stripper'
  };
  return known[name] || name.toLowerCase().replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '');
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'");
}

function fetchSteamWorkshop(query, page = 1, signal) {
  const url = buildSearchUrl(query, page);
  return new Promise((resolve, reject) => {
    const curl = process.platform === 'win32' ? 'curl.exe' : 'curl';
    const args = ['-L', '--fail', '--silent', '--show-error', '--max-time', '20', '-A', 'L4D2-Control/1.0'];
    if (workshopProxy) args.push('--proxy', workshopProxy);
    args.push(url);
    execFile(curl, args, { timeout: 25000, maxBuffer: 8 * 1024 * 1024, signal }, (error, stdout, stderr) => {
      if (error) { reject(new Error((stderr || error.message).trim() || 'Steam Workshop request failed')); return; }
      const items = parseSteamSearch(String(stdout));
      resolve({ query, page, items, source: 'steam-workshop' });
    });
  });
}

function workshopInstallCommand(id) {
  const stageRoot = path.posix.resolve(workshopStageDir);
  if (!stageRoot.startsWith('/tmp/') || stageRoot === '/tmp') throw new Error('invalid workshop staging directory');
  const proxyPort = workshopProxy.match(/^socks5h:\/\/127\.0\.0\.1:(\d{2,5})$/)?.[1] || '';
  const script = `set -euo pipefail
stage_root=${shellQuote(stageRoot)}
addon=${shellQuote(workshopAddonDir)}
steamcmd=${shellQuote(steamcmdPath)}
proxy_port=${shellQuote(proxyPort)}
id=${shellQuote(id)}
stage=''
tmp=''
cleanup() {
  if [ -n "$stage" ]; then rm -rf -- "$stage"; fi
  if [ -n "$tmp" ]; then rm -f -- "$tmp"; fi
}
trap cleanup EXIT
mkdir -p -- "$stage_root" "$addon"
chmod 0700 -- "$stage_root"
exec 9>"$addon/.workshop-$id.lock"
flock -n 9 || { echo 'WORKSHOP_INSTALL_IN_PROGRESS' >&2; exit 25; }
stage="$(mktemp -d "$stage_root/$id.XXXXXXXX")"
proxy_runner=()
if [ -n "$proxy_port" ]; then
  proxychains_bin="$(command -v proxychains4 || command -v proxychains || true)"
  if [ -z "$proxychains_bin" ]; then echo 'WORKSHOP_PROXYCHAINS_MISSING' >&2; exit 26; fi
  proxy_config="$stage/proxychains.conf"
  printf 'strict_chain\\nproxy_dns\\ntcp_read_time_out 15000\\ntcp_connect_time_out 8000\\n[ProxyList]\\nsocks5 127.0.0.1 %s\\n' "$proxy_port" >"$proxy_config"
  chmod 0600 -- "$proxy_config"
  proxy_runner=("$proxychains_bin" -q -f "$proxy_config")
fi
"\${proxy_runner[@]}" timeout 600 "$steamcmd" +force_install_dir "$stage" +login anonymous +workshop_download_item 550 "$id" +quit >"$stage/steamcmd.log" 2>&1
vpk="$(find "$stage/steamapps/workshop/content/550/$id" -type f -iname '*.vpk' -print -quit 2>/dev/null || true)"
if [ -z "$vpk" ]; then echo 'WORKSHOP_VPK_NOT_FOUND' >&2; exit 21; fi
name="$(basename -- "$vpk")"
case "$name" in
  *.vpk|*.VPK) ;;
  *) echo 'WORKSHOP_INVALID_FILE' >&2; exit 22 ;;
esac
case "$name" in
  *[!A-Za-z0-9._-]*) echo 'WORKSHOP_INVALID_NAME' >&2; exit 23 ;;
esac
size="$(stat -c '%s' -- "$vpk" 2>/dev/null || stat -f '%z' -- "$vpk")"
if [ "$size" -le 0 ] || [ "$size" -gt 1073741824 ]; then echo 'WORKSHOP_INVALID_SIZE' >&2; exit 24; fi
magic="$(od -An -tx1 -N4 -- "$vpk" | tr -d '[:space:]')"
if [ "$magic" != '3412aa55' ]; then echo 'WORKSHOP_INVALID_VPK' >&2; exit 27; fi
installed_name="workshop-${id}-\${name}"
destination="$addon/\${installed_name}"
if [ -e "$destination" ]; then if cmp -s -- "$vpk" "$destination"; then printf 'ALREADY_INSTALLED:%s:%s\\n' "\${installed_name}" "$size"; exit 0; else echo 'WORKSHOP_DESTINATION_CONFLICT' >&2; exit 28; fi; fi
tmp="$addon/.\${installed_name}.part"
rm -f -- "$tmp"
cp -- "$vpk" "$tmp"
chmod 0644 -- "$tmp"
mv -- "$tmp" "$destination"
printf 'INSTALLED:%s:%s\\n' "$installed_name" "$size"`;
  return `bash -lc ${shellQuote(script)}`;
}

async function handleApi(req, res, body) {
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (req.method !== 'GET' && req.headers.origin) {
      const origin = new URL(req.headers.origin);
      if (origin.host !== req.headers.host || origin.protocol !== (req.socket.encrypted ? 'https:' : 'http:')) throw new Error('invalid origin');
    }
    if (pathname.startsWith('/api/proxy')) {
      if (!localMode) throw new Error('proxy manager requires local mode');
      if (!req.socket.encrypted && !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) throw new Error('proxy manager requires HTTPS');
      if (req.method === 'GET' && pathname === '/api/proxy/nodes') { res.end(JSON.stringify(await proxyManager.listNodes())); return; }
      if (req.method === 'GET' && pathname === '/api/proxy/export') {
        res.setHeader('content-type', 'text/plain; charset=utf-8');
        res.setHeader('content-disposition', `attachment; filename="workshop nodes.${process.env.WORKSHOP_PROXY_ENGINE === 'mihomo' ? 'yaml' : 'txt'}"`);
        res.end(proxyManager.exportNodes()); return;
      }
      if (req.method !== 'POST') { res.statusCode = 405; res.end(JSON.stringify({ error: 'method not allowed' })); return; }
      const payload = body ? JSON.parse(body) : {};
      if (pathname === '/api/proxy/import') { res.end(JSON.stringify(await proxyManager.importNodes(payload.links))); return; }
      if (pathname === '/api/proxy/update' && proxyManager.updateSubscription) { res.end(JSON.stringify(await proxyManager.updateSubscription(payload.id))); return; }
      if (pathname === '/api/proxy/switch') { res.end(JSON.stringify(await proxyManager.switchNode(payload.id))); return; }
      if (pathname === '/api/proxy/delete') { res.end(JSON.stringify(await proxyManager.deleteNode(payload.id))); return; }
      res.statusCode = 404; res.end(JSON.stringify({ error: 'not found' })); return;
    }
    if (req.method === 'GET' && req.url === '/api/config') { res.end(JSON.stringify({ gameAddress, openList: cloudMaps.publicConfig() })); return; }
    if (req.method === 'GET' && pathname === '/api/openlist') {
      res.end(JSON.stringify(cloudMaps.publicConfig()));
      return;
    }
    if (pathname.startsWith('/api/openlist/') && !localMode) throw Object.assign(new Error('云端地图需要在游戏服务器本机运行面板'), { status: 400 });
    if (req.method === 'GET' && pathname === '/api/openlist/maps') {
      const refresh = new URL(req.url, 'http://localhost').searchParams.get('refresh') === '1';
      res.end(JSON.stringify(await cloudMaps.listMaps(refresh))); return;
    }
    if (req.method === 'GET' && pathname === '/api/openlist/backup') { res.end(JSON.stringify(cloudMaps.getStatus())); return; }
    if (req.method === 'POST' && pathname === '/api/openlist/backup') { res.statusCode = 202; res.end(JSON.stringify(cloudMaps.startBackup())); return; }
    if (req.method === 'POST' && pathname === '/api/openlist/backup/settings') {
      const payload = body ? JSON.parse(body) : {}; res.end(JSON.stringify(cloudMaps.setEnabled(payload.enabled))); return;
    }
    if (req.method === 'POST' && pathname === '/api/openlist/backup/stop') { res.end(JSON.stringify(cloudMaps.stopBackup())); return; }
    if (req.method === 'POST' && pathname === '/api/openlist/share-cloud') {
      const payload = body ? JSON.parse(body) : {}; res.end(JSON.stringify(await cloudMaps.shareCloud(payload.name))); return;
    }
    if (req.method === 'GET' && pathname === '/api/openlist/upload-status') {
      const packageName = new URL(req.url, 'http://localhost').searchParams.get('package');
      res.end(JSON.stringify(openList.getUploadStatus(packageName)));
      return;
    }
    if (req.method === 'POST' && pathname === '/api/openlist/share-map') {
      if (!localMode) throw Object.assign(new Error('地图分享需要在游戏服务器本机运行面板'), { status: 400 });
      const payload = body ? JSON.parse(body) : {};
      const listing = await cloudMaps.listMaps();
      const file = listing.files.find(item => item.serverId === payload.package && item.verified);
      if (!file) throw Object.assign(new Error('请先在云端地图完成备份，再生成分享链接'), { status: 409 });
      res.end(JSON.stringify(await cloudMaps.shareCloud(file.name)));
      return;
    }
    if (req.method === 'GET' && req.url === '/api/status') { res.end(JSON.stringify(await status())); return; }
    if (pathname.startsWith('/api/players')) {
      if (!localMode) throw Object.assign(new Error('玩家管理需要在游戏服务器本机运行面板'), { status: 400 });
      if (req.method === 'GET' && pathname === '/api/players') { res.end(JSON.stringify(await playerManager.list())); return; }
      if (req.method === 'POST' && pathname === '/api/players/permissions') {
        const payload = body ? JSON.parse(body) : {};
        res.end(JSON.stringify(await playerManager.update(payload, panelUser))); return;
      }
      res.statusCode = 404; res.end(JSON.stringify({ error: 'not found' })); return;
    }
    if (req.method === 'GET' && pathname === '/api/diagnostics') {
      if (!localMode) throw Object.assign(new Error('服务器自检需要在游戏服务器本机运行面板'), { status: 400 });
      res.end(JSON.stringify(await diagnostics())); return;
    }
    if (req.method === 'GET' && pathname === '/api/maps') {
      if (!localMode) throw new Error('map inventory requires local mode');
      res.end(JSON.stringify(await mapInventory(serverRoot))); return;
    }
    if (req.method === 'GET' && pathname === '/api/plugins') {
      if (!localMode) throw new Error('plugin inventory requires local mode');
      res.end(JSON.stringify({ plugins: pluginInventory(pluginPath) })); return;
    }
    if (pathname === '/api/maps/export' || pathname === '/api/plugins/export') {
      if (!['GET', 'HEAD'].includes(req.method)) { res.statusCode = 405; res.end(JSON.stringify({ error: 'method not allowed' })); return; }
      if (!localMode) throw Object.assign(new Error('内容导出需要在游戏服务器本机运行面板'), { status: 400 });
      const requestUrl = new URL(req.url, 'http://localhost');
      const kind = pathname === '/api/maps/export' ? 'maps' : 'plugins';
      const identifier = requestUrl.searchParams.get(kind === 'maps' ? 'package' : 'id');
      const artifact = await library.exportFile(kind, identifier);
      const fallbackName = artifact.name.replace(/["\\\r\n]/g, '_').replace(/[^\x20-\x7e]/g, '_');
      res.statusCode = 200;
      res.setHeader('content-type', artifact.contentType);
      res.setHeader('content-length', artifact.stat.size);
      const encodedName = encodeURIComponent(artifact.name).replace(/['()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
      res.setHeader('content-disposition', `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodedName}`);
      res.setHeader('cache-control', 'no-store');
      if (req.method === 'HEAD') { fs.closeSync(artifact.fd); res.end(); return; }
      const stream = fs.createReadStream(null, { fd: artifact.fd, autoClose: true });
      res.on('close', () => { if (!res.writableFinished) stream.destroy(); });
      stream.on('error', error => { if (!res.headersSent) { res.removeHeader('content-length'); res.removeHeader('content-disposition'); res.setHeader('content-type', 'application/json'); res.statusCode = 500; res.end(JSON.stringify({error:'导出连接中断，请重试'})); } else res.destroy(error); });
      stream.pipe(res);
      return;
    }
    if (req.method === 'POST' && ['/api/maps/delete', '/api/plugins/delete'].includes(pathname)) {
      if (!localMode) throw new Error('内容管理需要在游戏服务器本机运行面板');
      const payload = body ? JSON.parse(body) : {};
      res.end(JSON.stringify(await (pathname === '/api/maps/delete' ? library.deleteMap(payload.package) : library.deletePlugin(payload.id)))); return;
    }
    if (req.method === 'POST' && pathname === '/api/downloads/delete') { const payload = body ? JSON.parse(body) : {}; res.end(JSON.stringify(await downloads.remove(payload.id))); return; }
    if (req.method === 'GET' && pathname === '/api/downloads') { res.end(JSON.stringify({ jobs: downloads.list() })); return; }
    if (req.method === 'POST' && pathname === '/api/downloads/cancel') { const payload = body ? JSON.parse(body) : {}; res.end(JSON.stringify(downloads.cancel(payload.id))); return; }
    if (req.method === 'POST' && pathname === '/api/downloads/dismiss') { const payload = body ? JSON.parse(body) : {}; res.end(JSON.stringify(downloads.dismiss(payload.id))); return; }
    if (req.method === 'GET' && pathname === '/api/plugin-store') {
      const requestUrl = new URL(req.url, 'http://localhost');
      const query = (requestUrl.searchParams.get('query') || '').trim();
      const category = requestUrl.searchParams.get('category') || 'all';
      const page = Number(requestUrl.searchParams.get('page') || 1);
      if (query.length > 120 || !Number.isInteger(page) || page < 1 || page > 100) throw new Error('invalid plugin store query');
      try { res.end(JSON.stringify(await pluginStore.search(query, category, page, AbortSignal.timeout(30000)))); }
      catch (error) { res.end(JSON.stringify({ query, category, page, items: [], source: 'plugin-store', unavailable: true, error: error.message })); }
      return;
    }
    if (req.method === 'POST' && pathname === '/api/plugin-store/sync') {
      if (!localMode) throw Object.assign(new Error('插件商店同步需要在游戏服务器本机运行面板'), { status: 400 });
      await pluginStore.sync(true, AbortSignal.timeout(120000));
      res.end(JSON.stringify(pluginStore.snapshot())); return;
    }
    if (req.method === 'GET' && pathname === '/api/gamemaps') {
      const requestUrl = new URL(req.url, 'http://localhost');
      const query = (requestUrl.searchParams.get('query') || '').trim();
      const page = Number(requestUrl.searchParams.get('page') || 1);
      if (query.length > 120 || !Number.isInteger(page) || page < 1 || page > 20) throw new Error('invalid gamemaps query');
      try { res.end(JSON.stringify(await gameMaps.search(query, page, AbortSignal.timeout(30000)))); }
      catch (error) { res.end(JSON.stringify({ query, page, items: [], source: 'gamemaps', unavailable: true, error: error.message, errorCode: error.code || null, upstreamStatus: error.status || null, proxyConfigured: !!workshopProxy })); }
      return;
    }
    if (req.method === 'GET' && pathname === '/api/workshop') {
      const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const query = (requestUrl.searchParams.get('query') || '').trim();
      const page = Number(requestUrl.searchParams.get('page') || 1);
      if (query.length > 120 || !Number.isInteger(page) || page < 1 || page > 20) throw new Error('invalid workshop query');
      try {
        res.end(JSON.stringify(await fetchSteamWorkshop(query, page)));
      } catch (error) {
        res.end(JSON.stringify({ query, page, items: [], source: 'steam-workshop', unavailable: true, fallbackUrl: buildSearchUrl(query, page), error: error.message }));
      }
      return;
    }
    if (req.method === 'POST' && ['/api/workshop/install', '/api/gamemaps/install', '/api/plugin-store/install'].includes(pathname)) {
      const payload = body ? JSON.parse(body) : {};
      res.statusCode = 202;
      const source = pathname === '/api/gamemaps/install' ? 'gamemaps' : pathname === '/api/plugin-store/install' ? 'plugin-store' : 'steam-workshop';
      res.end(JSON.stringify({ ok: true, job: downloads.start(source, payload.id, payload.title) }));
      return;
    }
    if (req.method !== 'POST') { res.statusCode = 405; res.end(JSON.stringify({ error: 'method not allowed' })); return; }
    const payload = body ? JSON.parse(body) : {};
    if (req.url === '/api/map') {
      await library.exclusive(async () => {
      if (typeof payload.map !== 'string' || payload.map.length > 128 || !/^[a-z0-9_]+$/i.test(payload.map)) throw new Error('invalid map');
      if (localMode && !(await mapInventory(serverRoot)).campaigns.some(campaign => campaign.chapters.some(chapter => chapter.id === payload.map))) throw new Error('map not installed');
      await runCommand(screenCommand(`changelevel ${payload.map}`)); state.currentMap = payload.map;
      res.end(JSON.stringify({ ok: true, currentMap: state.currentMap }));
      }); return;
    }
    if (req.url === '/api/plugin') {
      if (!localMode) throw new Error('plugin management requires local mode');
      if (String(payload.id).toLowerCase() === 'l4d2 control players') throw new Error('protected core plugin');
      if (typeof payload.id !== 'string' || !/^[a-z0-9_-]{1,128}$/i.test(payload.id) || typeof payload.enabled !== 'boolean') throw new Error('invalid plugin');
      await library.exclusive(async () => {
      const item = pluginInventory(pluginPath).find(plugin => plugin.id === payload.id);
      if (!item) throw new Error('invalid plugin');
      if (!payload.enabled && ['admin-flatfile', 'adminmenu', 'basecommands', 'basechat'].includes(item.id.toLowerCase())) throw new Error('protected core plugin');
      if (item.enabled !== payload.enabled) {
        const disabledPath = path.join(pluginPath, 'disabled');
        fs.mkdirSync(disabledPath, { recursive: true });
        const source = path.join(item.enabled ? pluginPath : disabledPath, `${item.id}.smx`);
        const destination = path.join(item.enabled ? disabledPath : pluginPath, `${item.id}.smx`);
        if (fs.existsSync(destination)) throw new Error('destination plugin already exists');
        fs.renameSync(source, destination);
        try { await runCommand(screenCommand(`sm plugins ${payload.enabled ? 'load' : 'unload'} ${item.id}`)); }
        catch (error) { fs.renameSync(destination, source); throw error; }
      }
      res.end(JSON.stringify({ ok: true, plugin: item.id, enabled: payload.enabled }));
      }); return;
    }
    if (req.url === '/api/plugins/reload') { await library.exclusive(() => runCommand(screenCommand('sm plugins refresh'))); res.end(JSON.stringify({ ok: true })); return; }
    res.statusCode = 404; res.end(JSON.stringify({ error: 'not found' }));
  } catch (error) {
    const badRequest = /^(invalid map|map not installed|invalid plugin|protected core plugin|invalid workshop query|invalid workshop id|invalid gamemaps query|invalid plugin store query|invalid download|invalid origin|proxy manager requires HTTPS|proxy manager requires local mode|内容导出需要|只能导出|文件名或文件类型|插件不存在|不支持的导出类型|节点不存在|请先切换|请导入|仅支持|节点链接|OpenList 已存在同名|插件商店)/.test(error.message) || error instanceof SyntaxError || error.code === 'STEAM_IDENTITY_MISMATCH';
    res.statusCode = error.status || (['ENOENT', 'ENOTDIR'].includes(error.code) ? 404 : badRequest ? 400 : 502);
    res.end(JSON.stringify({ error: error instanceof SyntaxError ? 'invalid json' : error.message }));
  }
}

async function handleImport(req, res) {
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  try {
    if (req.method !== 'POST') { res.statusCode = 405; res.end(JSON.stringify({error:'method not allowed'})); return; }
    if (!localMode) throw Object.assign(new Error('导入需要在游戏服务器本机运行面板'), {status:400});
    if (req.headers.origin && req.headers.origin !== `${req.socket.encrypted ? 'https' : 'http'}://${req.headers.host}`) throw Object.assign(new Error('invalid origin'), {status:403});
    const url = new URL(req.url, 'http://localhost');
    const result = await library.importFile(url.pathname.includes('/maps/') ? 'maps' : 'plugins', url.searchParams.get('name'), req);
    res.end(JSON.stringify(result));
  } catch (error) {
    req.resume();
    if (!res.destroyed) { res.statusCode = error.status || 400; res.end(JSON.stringify({error:error.message})); }
  }
}

function serveFile(req, res) {
  let requestPath;
  try {
    requestPath = decodeURIComponent(req.url.split('?')[0]);
  } catch {
    res.statusCode = 400;
    res.end('Bad request');
    return;
  }
  if (requestPath.startsWith('/proxy-dashboard/')) {
    const dashboardRoot = path.resolve(process.env.WORKSHOP_DASHBOARD_DIR || path.join(root, 'dashboard'));
    const relative = requestPath.slice('/proxy-dashboard/'.length) || 'index.html';
    const file = path.resolve(dashboardRoot, relative);
    const within = path.relative(dashboardRoot, file);
    if (within.startsWith('..') || path.isAbsolute(within) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end('Not found'); return; }
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
    res.setHeader('content-type', types[path.extname(file)] || 'application/octet-stream');
    res.setHeader('cache-control', 'no-cache');
    if (relative === 'index.html' && (panelPassword || panelToken)) {
      const expires = Math.floor(Date.now() / 1000) + 8 * 3600;
      const signature = crypto.createHmac('sha256', panelToken || panelPassword).update(`mihomo:${expires}`).digest('hex');
      res.setHeader('set-cookie', `mihomo-session=${expires}.${signature}; Path=/mihomo; HttpOnly; SameSite=Strict; Max-Age=28800${req.socket.encrypted ? '; Secure' : ''}`);
    }
    fs.createReadStream(file).pipe(res); return;
  }
  const relative = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
  if (!['index.html', 'app.js', 'players.js', 'styles.css'].includes(relative)) { res.statusCode = 404; res.end('Not found'); return; }
  const filePath = path.resolve(root, relative);
  const relativeToRoot = path.relative(root, filePath);
  if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) { res.statusCode = 404; res.end('Not found'); return; }
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };
  res.setHeader('content-type', types[path.extname(filePath)] || 'application/octet-stream');
  res.setHeader('cache-control', 'no-store');
  fs.createReadStream(filePath).pipe(res);
}

function isAuthorized(req) {
  if (!panelPassword && !panelToken) return bindHost === '127.0.0.1' || bindHost === '::1';
  if (req.url.startsWith('/mihomo/')) {
    const cookie = String(req.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith('mihomo-session='))?.slice('mihomo-session='.length);
    const match = cookie?.match(/^(\d{10})\.([a-f0-9]{64})$/);
    if (match && Number(match[1]) >= Math.floor(Date.now() / 1000) && Number(match[1]) <= Math.floor(Date.now() / 1000) + 8 * 3600) {
      const expected = crypto.createHmac('sha256', panelToken || panelPassword).update(`mihomo:${match[1]}`).digest('hex');
      if (crypto.timingSafeEqual(Buffer.from(match[2]), Buffer.from(expected))) return true;
    }
  }
  const header = req.headers.authorization || '';
  if (panelPassword && header.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
      const separator = decoded.indexOf(':');
      const user = separator > 0 ? decoded.slice(0, separator) : '';
      const pass = separator > 0 ? decoded.slice(separator + 1) : '';
      const equal = (left, right) => { const a = Buffer.from(String(left)); const b = Buffer.from(String(right)); return a.length === b.length && crypto.timingSafeEqual(a, b); };
      if (equal(user, panelUser) && equal(pass, panelPassword)) return true;
    } catch { /* malformed credentials remain unauthorized */ }
  }
  const token = req.headers['x-panel-token'] || (header.startsWith('Bearer ') ? header.slice(7) : '');
  if (panelToken) { const a = Buffer.from(String(token)); const b = Buffer.from(panelToken); if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true; }
  return false;
}

const serve = (req, res) => {
  if (!isAuthorized(req)) {
    res.statusCode = 401;
    res.setHeader('WWW-Authenticate', 'Basic realm="L4D2-Control", charset="UTF-8"');
    res.setHeader('cache-control', 'no-store');
    res.end('Authentication required');
    return;
  }
  if (req.url.startsWith('/mihomo/') && proxyManager.bridge) {
    if (req.headers.origin && req.headers.origin !== `${req.socket.encrypted ? 'https' : 'http'}://${req.headers.host}`) { res.writeHead(403); res.end('Invalid origin'); return; }
    proxyManager.bridge(req, res, req.url.slice('/mihomo'.length)); return;
  }
  if (/^\/api\/(maps|plugins)\/import(?:\?|$)/.test(req.url)) {
    handleImport(req, res); return;
  }
  if (req.url.startsWith('/api/')) {
    let body = ''; req.on('data', chunk => { body += chunk; if (Buffer.byteLength(body) > (req.url === '/api/proxy/import' ? 2 * 1024 * 1024 : 100000)) req.destroy(); }); req.on('end', () => handleApi(req, res, body)); return;
  }
  serveFile(req, res);
};
const useTls = fs.existsSync(tlsKey) && fs.existsSync(tlsCert);
const server = useTls ? https.createServer({ key: fs.readFileSync(tlsKey), cert: fs.readFileSync(tlsCert) }, serve) : http.createServer(serve);
server.requestTimeout = 30 * 60 * 1000;
server.on('upgrade', (req, socket, head) => {
  if (!isAuthorized(req) || !req.url.startsWith('/mihomo/') || !proxyManager.upgrade || (req.headers.origin && req.headers.origin !== `${req.socket.encrypted ? 'https' : 'http'}://${req.headers.host}`)) { socket.destroy(); return; }
  proxyManager.upgrade(req, socket, head, req.url.slice('/mihomo'.length));
});
server.listen(port, bindHost, () => console.log(`L4D2-Control listening on ${useTls ? 'https' : 'http'}://${bindHost}:${server.address().port} (${localMode ? 'local control' : 'ssh control'})`));

process.once('SIGTERM', () => { cloudMaps.close(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 8000).unref(); });
