const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { normalizeIP } = require('./ip regions');
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const BEGIN = '// BEGIN L4D2 CONTROL MANAGED ADMINS';
const END = '// END L4D2 CONTROL MANAGED ADMINS';
const FLAG_ORDER = 'abcdefghijklmnopqrstz';
const FLAG_LABELS = ['预留槽位', '管理员菜单', '踢出玩家', '封禁玩家', '解除封禁', '处置玩家', '切换地图', '修改变量', '执行配置', '管理员聊天', '发起投票', '服务器密码', 'RCON 命令', '作弊类命令', '自定义 1', '自定义 2', '自定义 3', '自定义 4', '自定义 5', '自定义 6', '最高权限'];
const PROFILES = [{ id: 'player', name: '普通玩家', flags: '', description: '移除本面板授予的管理员权限' }, { id: 'plugins', name: '插件管理员', flags: 'bfn', description: '管理员菜单、处置与作弊类插件命令；具体仍取决于插件要求' }, { id: 'moderator', name: '游戏管理员', flags: 'bcdfgjk', description: '踢人、封禁、处置、切图、聊天和投票；不包含 RCON' }, { id: 'root', name: '最高管理员', flags: 'z', description: '全部 SourceMod 权限，仅授予可信服主' }];
function steamIdentity(input) {
  if (typeof input !== 'string') throw fail('请输入 SteamID2、SteamID3 或 SteamID64');
  const value = input.trim(); let account;
  const s2 = /^STEAM_[01]:([01]):(\d{1,10})$/.exec(value);
  const s3 = /^\[U:1:(\d{1,10})\]$/.exec(value);
  if (s2) account = BigInt(s2[2]) * 2n + BigInt(s2[1]);
  else if (s3) account = BigInt(s3[1]);
  else if (/^7656119\d{10}$/.test(value) || /^7656120\d{10}$/.test(value)) account = BigInt(value) - 76561197960265728n;
  else throw fail('SteamID 格式无效，不接受昵称、机器人或待验证身份');
  if (account <= 0n || account > 4294967295n) throw fail('SteamID 不属于有效的公开个人账号');
  return { steam2: `STEAM_1:${account % 2n}:${account / 2n}`, steam3: `[U:1:${account}]`, steam64: String(76561197960265728n + account) };
}
function flagsOf(input) {
  if (typeof input !== 'string' || input.length > 21 || /[^a-tz]/.test(input)) throw fail('管理员权限标记无效');
  return [...FLAG_ORDER].filter(c => input.includes(c)).join('');
}
// Preserve SteamID64 as strings: numeric coercion would lose precision.
function parseKeyValues(text) {
  let at = 0, tokens = 0;
  function token() {
    while (at < text.length) {
      if (/\s/.test(text[at])) { at++; continue; }
      if (text.slice(at, at + 2) === '//') { const end = text.indexOf('\n', at); at = end < 0 ? text.length : end + 1; continue; }
      if (text.slice(at, at + 2) === '/*') { const end = text.indexOf('*/', at + 2); if (end < 0) throw fail('KeyValues 注释不完整', 503); at = end + 2; continue; }
      break;
    }
    if (at >= text.length) return null;
    if (++tokens > 300000) throw fail('玩家数据过大', 503);
    const ch = text[at++]; if (ch === '{' || ch === '}') return { type: ch };
    if (ch !== '"') {
      let value = ch;
      while (at < text.length && !/[\s{}"]/.test(text[at]) && !['//', '/*'].includes(text.slice(at, at + 2))) value += text[at++];
      return { type: 'string', value };
    }
    let value = '';
    while (at < text.length) {
      const c = text[at++]; if (c === '"') return { type: 'string', value };
      if (c === '\\') { const n = text[at++]; value += ({ n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\' })[n] ?? n; }
      else value += c;
    }
    throw fail('KeyValues 字符串不完整', 503);
  }
  function object(depth = 0) {
    if (depth > 10) throw fail('KeyValues 嵌套过深', 503);
    const result = Object.create(null);
    while (true) {
      const key = token();
      if (!key) { if (depth) throw fail('KeyValues 括号不完整', 503); return result; }
      if (key.type === '}') { if (!depth) throw fail('KeyValues 括号无效', 503); return result; }
      if (key.type !== 'string' || Object.hasOwn(result, key.value)) throw fail('KeyValues 键无效或重复', 503);
      const value = token(); if (!value || !['{', 'string'].includes(value.type)) throw fail('KeyValues 值无效', 503);
      result[key.value] = value.type === '{' ? object(depth + 1) : value.value;
    }
  }
  return object();
}
function splitManaged(text) {
  const starts = [...text.matchAll(/^\/\/ BEGIN L4D2 CONTROL MANAGED ADMINS\r?$/gm)];
  const ends = [...text.matchAll(/^\/\/ END L4D2 CONTROL MANAGED ADMINS\r?$/gm)];
  if (!starts.length && !ends.length) return { outside: text, managed: '', before: text, after: '', present: false };
  if (starts.length !== 1 || ends.length !== 1 || starts[0].index >= ends[0].index) throw fail('面板管理员配置块损坏，请先修复配置', 409);
  const a = starts[0].index, b = ends[0].index + ends[0][0].length;
  return { before: text.slice(0, a), after: text.slice(b), outside: text.slice(0, a) + text.slice(b), managed: text.slice(a + starts[0][0].length, ends[0].index), present: true };
}
function simpleEntries(text, strict = false) {
  const entries = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('//')) continue;
    const match = (strict ? /^\s*"([^"\r\n]+)"\s+"([^"\r\n]*)"(?:\s*\/\/.*)?\s*$/ : /^\s*"([^"\r\n]+)"\s+"([^"\r\n]*)"/).exec(line);
    if (!match) { if (strict) throw fail('面板管理员配置行无效', 409); continue; }
    let identity; try { identity = steamIdentity(match[1]); } catch { if (strict) throw fail('面板管理员 SteamID 无效', 409); continue; }
    const spec = /^(?:(\d+):)?([a-tz]*)$/.exec(match[2]);
    const item = { ...identity, flags: spec ? flagsOf(spec[2]) : '', immunity: spec ? Number(spec[1] || 0) : null, group: spec ? '' : match[2] };
    if (entries.has(identity.steam64) && strict) throw fail('面板管理员身份重复', 409);
    entries.set(identity.steam64, item);
  }
  return entries;
}
async function safeRead(file, { optional = false, max = 8 * 1024 * 1024 } = {}) {
  let handle;
  try { handle = await fs.promises.open(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)); }
  catch (e) { if (optional && e.code === 'ENOENT') return ''; throw e; }
  try { const stat = await handle.stat(); if (!stat.isFile() || stat.size > max) throw fail('玩家或权限文件类型/大小异常', 503); return await handle.readFile('utf8'); }
  finally { await handle.close(); }
}
async function atomicWrite(file, text, mode = 0o600) {
  const temp = file + '.' + crypto.randomUUID() + '.tmp';
  try { await fs.promises.writeFile(temp, text, { mode, flag: 'wx' }); await fs.promises.rename(temp, file); }
  finally { await fs.promises.rm(temp, { force: true }); }
}
const fieldsOf = node => Object.fromEntries(Object.entries(node || {}).map(([k, v]) => [k.toLowerCase(), v]));
function createPlayerManager({ serverRoot, stateDir = path.join(os.homedir(), '.local', 'state', 'dead-air-panel', 'players'), reloadAdmins, refreshSnapshot, now = () => Date.now() }) {
  const sourceRoot = path.join(serverRoot, 'left4dead2', 'addons', 'sourcemod');
  const simpleFile = path.join(sourceRoot, 'configs', 'admins_simple.ini');
  const snapshotFile = path.join(sourceRoot, 'data', 'l4d2 control', 'players.txt');
  const historyFile = path.join(sourceRoot, 'data', 'l4d2 control', 'history.txt');
  let pending = Promise.resolve(), refreshing = null, lastRefreshAttempt = 0;
  async function config() {
    const original = await safeRead(simpleFile); const split = splitManaged(original), managed = simpleEntries(split.managed, true), external = simpleEntries(split.outside);
    const advanced = await safeRead(path.join(sourceRoot, 'configs', 'admins.cfg'), { optional: true });
    if (advanced.trim()) {
      function visit(node) {
        if (!node || typeof node !== 'object') return;
        const fields = Object.fromEntries(Object.entries(node).map(([k, v]) => [k.toLowerCase(), v]));
        if (fields.auth === 'steam' && typeof fields.identity === 'string') {
          try { const id = steamIdentity(fields.identity); external.set(id.steam64, { ...id, flags: typeof fields.flags === 'string' ? flagsOf(fields.flags) : '', immunity: Number(fields.immunity || 0), group: String(fields.group || '') }); } catch { /* unrelated or unsupported auth */ }
        }
        for (const value of Object.values(node)) if (value && typeof value === 'object') visit(value);
      }
      visit(parseKeyValues(advanced));
    }
    return { original, split, managed, external };
  }
  async function snapshot() {
    try {
      const root = fieldsOf(fieldsOf(parseKeyValues(await safeRead(snapshotFile))).panelplayers);
      if (!root || Number(root.version) !== 1) throw new Error('Unsupported bridge');
      const checkedAt = Number(root.updated) * 1000;
      if (!Number.isFinite(checkedAt) || now() - checkedAt > 20000 || checkedAt - now() > 10000) return { available: false, reason: '玩家采集已超过 20 秒未更新，不能将旧记录当作在线玩家', players: [], bots: 0, checkedAt };
      const players = [];
      for (const entry of Object.values(root.players || {})) {
        const row = fieldsOf(entry);
        const identity = steamIdentity(row.steam2);
        if (identity.steam64 !== String(row.steam64)) throw new Error('Steam identity mismatch');
        players.push({ ...identity, gameIp:normalizeIP(row.ip), gameIpAt:checkedAt, name: String(row.name || '').slice(0, 128), userId: Number(row.userid), team: Number(row.team), ping: Math.max(0, Number(row.ping) || 0), connectedSeconds: Math.max(0, Number(row.connected) || 0), runtimeFlags: flagsOf(String(row.flags || '')), runtimeImmunity: Math.max(0, Number(row.immunity) || 0), online: true });
      }
      return { available: true, moderationAvailable: Number(root.moderationversion) === 1, players, bots: Number(root.bots) || 0, checkedAt, reason: '' };
    } catch { return { available: false, reason: '未取得玩家采集数据，请检查 L4D2 Control Players 插件是否运行', players: [], bots: 0, checkedAt: null }; }
  }
  async function freshSnapshot() {
    let live = await snapshot();
    if (refreshSnapshot && (!live.available || now() - live.checkedAt > 5000)) {
      if (!refreshing && now() - lastRefreshAttempt >= 5000) {
        lastRefreshAttempt = now();
        refreshing = Promise.resolve().then(refreshSnapshot).finally(() => { refreshing = null; });
      }
      if (refreshing) { try { await refreshing; } catch { /* freshness below remains authoritative */ } }
      live = await snapshot();
    }
    return live;
  }
  async function list() {
    const live = await freshSnapshot(); let cfg, configError = '';
    try { cfg = await config(); } catch { cfg = { managed: new Map(), external: new Map() }; configError = '管理员配置无法安全解析，权限编辑已禁用'; }
    const rows = new Map(); let historyError = '';
    try {
      const root = fieldsOf(parseKeyValues(await safeRead(historyFile, { optional: true }))).panelplayerhistory || {};
      for (const [steam2, entry] of Object.entries(root)) {
        const row = fieldsOf(entry);
        const id = steamIdentity(steam2);
        rows.set(id.steam64, { ...id, gameIp:now() - Number(row.lastseen)*1000 <= 30*86400000 ? normalizeIP(row.ip) : '', gameIpAt:Number(row.lastseen)*1000 || null, name: String(row.name || '').slice(0, 128), firstSeen: Number(row.firstseen) * 1000 || null, lastSeen: Number(row.lastseen) * 1000 || null, online: false });
      }
    } catch { historyError = '历史记录读取失败，当前仅展示实时玩家和已配置管理员'; }
    for (const p of live.players) rows.set(p.steam64, { ...rows.get(p.steam64), ...p });
    for (const p of [...cfg.external.values(), ...cfg.managed.values()]) if (!rows.has(p.steam64)) rows.set(p.steam64, { ...p, name: '未记录昵称', online: false, firstSeen: null, lastSeen: null });
    const players = [...rows.values()].map(p => {
      const managed = cfg.managed.get(p.steam64), external = cfg.external.get(p.steam64);
      const unmanagedRuntime = !managed && p.online && Boolean(p.runtimeFlags);
      const readOnly = Boolean(configError || external || unmanagedRuntime);
      return { ...p, managed: Boolean(managed), flags: managed?.flags ?? external?.flags ?? p.runtimeFlags ?? '', immunity: managed?.immunity ?? external?.immunity ?? p.runtimeImmunity ?? 0, permissionSource: external ? 'external' : managed ? 'panel' : unmanagedRuntime ? 'runtime' : 'none', readOnly, readOnlyReason: configError || (external ? '来自 admins_simple.ini / admins.cfg 的外部配置，面板保留原配置' : unmanagedRuntime ? '来自其他插件或数据库，请在原权限来源中修改' : '') };
    }).sort((a, b) => Number(b.online) - Number(a.online) || (b.lastSeen || 0) - (a.lastSeen || 0) || a.steam64.localeCompare(b.steam64));
    let audit = [];
    try { audit = (await safeRead(path.join(stateDir, 'permission audit.jsonl'), { optional: true, max: 4 * 1024 * 1024 })).trim().split('\n').filter(Boolean).slice(-20).map(s => JSON.parse(s)).reverse(); } catch { /* audit never blocks read-only inventory */ }
    return { ...live, players, total: players.length, onlineCount: live.available ? live.players.length : null, configError, historyError, profiles: PROFILES, flags: [...FLAG_ORDER].map((flag, i) => ({ flag, label: FLAG_LABELS[i] })), audit };
  }
  function update(payload, actor = 'panel') {
    const job = pending.then(async () => {
      const id = steamIdentity(payload.steamId), flags = flagsOf(payload.flags);
      const immunity = flags ? payload.immunity : 0;
      if (!Number.isInteger(immunity) || immunity < 0 || immunity > 100) throw fail('免疫等级必须是 0–100 的整数');
      if (flags.includes('z') && payload.confirmRoot !== true) throw fail('授予最高权限前必须单独确认');
      const cfg = await config();
      if (cfg.external.has(id.steam64)) throw fail('该玩家由外部管理员配置管理，未覆盖原权限', 409);
      const live = await freshSnapshot();
      if (!live.available) throw fail('玩家采集未运行，暂不修改游戏权限', 503);
      const player = live.players.find(p => p.steam64 === id.steam64);
      if (player?.runtimeFlags && !cfg.managed.has(id.steam64)) throw fail('该玩家有其他来源的运行时权限，未覆盖', 409);
      const previous = cfg.managed.get(id.steam64);
      if ((!flags && !previous) || previous?.flags === flags && previous?.immunity === immunity) return { changed: false, ...id, flags, immunity, message: '权限未变化' };
      if (flags) cfg.managed.set(id.steam64, { ...id, flags, immunity }); else cfg.managed.delete(id.steam64);
      const block = `${BEGIN}\n${[...cfg.managed.values()].sort((a, b) => a.steam64.localeCompare(b.steam64)).map(p => `"${p.steam2}" "${p.immunity}:${p.flags}"`).join('\n')}\n${END}`;
      const next = cfg.split.present ? cfg.split.before + block + cfg.split.after : cfg.original + (cfg.original.endsWith('\n') ? '' : '\n') + '\n' + block + '\n';
      await fs.promises.mkdir(stateDir, { recursive: true, mode: 0o700 });
      const backup = path.join(stateDir, 'admins before latest edit.ini');
      await atomicWrite(backup, cfg.original);
      if (await safeRead(simpleFile) !== cfg.original) throw fail('管理员文件已被其他程序修改，请刷新后重试', 409);
      const mode = (await fs.promises.stat(simpleFile)).mode & 0o777;
      await atomicWrite(simpleFile, next, mode);
      let runtimeConfirmed = false;
      try {
        await reloadAdmins();
        const after = await snapshot(); if (!after.available) throw fail('权限重载后未取得实时状态', 503);
        const connected = after.players.find(p => p.steam64 === id.steam64);
        if (connected && (connected.runtimeFlags !== flags || connected.runtimeImmunity < immunity)) throw fail('游戏内实际权限与设置不一致', 409);
        runtimeConfirmed = Boolean(connected);
      } catch (error) {
        if (await safeRead(simpleFile) !== next) throw fail('重载失败且配置出现并发修改，请人工核对管理员配置', 409);
        await atomicWrite(simpleFile, cfg.original, mode);
        try { await reloadAdmins(); } catch { throw fail('配置已恢复，但游戏权限重载失败；请检查 SourceMod', 503); }
        throw fail('权限更新未生效，已恢复原配置：' + error.message, 503);
      }
      const event = { at: new Date(now()).toISOString(), actor: String(actor).slice(0, 64), steam2: id.steam2, steam64: id.steam64, before: previous?.flags || '', after: flags, immunity, runtimeConfirmed };
      let auditWarning = '';
      try { await fs.promises.appendFile(path.join(stateDir, 'permission audit.jsonl'), JSON.stringify(event) + '\n', { mode: 0o600 }); } catch { auditWarning = '权限已应用，但审计日志未写入，请检查磁盘'; }
      return { changed: true, ...id, flags, immunity, runtimeConfirmed, auditWarning, message: auditWarning || (runtimeConfirmed ? '已重载并核对该在线玩家的实际权限' : '配置已保存并重载；该玩家上线时应用') };
    });
    pending = job.catch(() => {}); return job;
  }
  return { list, update, snapshot };
}
module.exports = { createPlayerManager, steamIdentity, flagsOf, parseKeyValues, splitManaged, simpleEntries, BEGIN, END };
