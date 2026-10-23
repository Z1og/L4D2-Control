// L4D2-Control project identity: l4d2-control-bf312edc896c79baad5c | SPDX-License-Identifier: LicenseRef-L4D2-Control-NonCommercial-1.0
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { steamIdentity, parseKeyValues } = require('./player manager');

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const fields = value => Object.fromEntries(Object.entries(value || {}).map(([key, val]) => [key.toLowerCase(), val]));
const quoted = value => JSON.stringify(String(value));
const MAX_FILE_SIZE = 8 * 1024 * 1024;
const INITIAL_REVISION = '000000000000000000000000';

async function boundedBody(response, limit = 65536) {
  const length = Number(response.headers?.get?.('content-length') || 0);
  if (length > limit) throw fail('Steam 资料响应过大');
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > limit) throw fail('Steam 资料响应过大');
    return text;
  }
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw fail('Steam 资料响应过大'); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString('utf8');
}

async function profileIdentity(input, fetchImpl = globalThis.fetch) {
  if (typeof input !== 'string' || input.length > 250) throw fail('请输入 SteamID 或 Steam 个人资料链接');
  const value = input.trim();
  try { return steamIdentity(value); } catch {}
  if (/(?:^|\/)(?:\.|%2e)(?:\.|%2e)?(?:\/|$)/i.test(value)) throw fail('Steam 资料链接路径无效');
  let url;
  try { url = new URL(value); } catch { throw fail('SteamID 或资料链接格式无效'); }
  if (!['https:', 'http:'].includes(url.protocol) || !['steamcommunity.com', 'www.steamcommunity.com'].includes(url.hostname) || url.port || url.username || url.password || url.search || url.hash) throw fail('请使用 steamcommunity.com 的个人资料链接');
  const numeric = /^\/profiles\/(\d{17})\/?$/.exec(url.pathname);
  if (numeric) return steamIdentity(numeric[1]);
  const vanity = /^\/id\/([A-Za-z0-9_-]{1,64})\/?$/.exec(url.pathname);
  if (!vanity) throw fail('个人资料链接路径无效');
  if (typeof fetchImpl !== 'function') throw fail('无法连接 Steam 资料解析服务', 503);
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetchImpl(`https://steamcommunity.com/id/${encodeURIComponent(vanity[1])}?xml=1`, { redirect: 'manual', signal: controller.signal, headers: { accept: 'application/xml,text/xml' } });
    if (response.status >= 300 && response.status < 400) {
      let destination;
      try { destination = new URL(response.headers.get('location') || '', 'https://steamcommunity.com'); } catch { throw fail('Steam 返回了无效资料地址', 502); }
      const destinationId = /^\/profiles\/(\d{17})\/?$/.exec(destination.pathname);
      if (destination.protocol !== 'https:' || !['steamcommunity.com', 'www.steamcommunity.com'].includes(destination.hostname) || !destinationId) throw fail('Steam 资料解析返回了不支持的跳转', 502);
      return steamIdentity(destinationId[1]);
    }
    let finalUrl;
    try { finalUrl = new URL(response.url || 'https://steamcommunity.com/'); } catch { throw fail('Steam 返回了无效资料地址', 502); }
    if (finalUrl.protocol !== 'https:' || !['steamcommunity.com', 'www.steamcommunity.com'].includes(finalUrl.hostname)) throw fail('Steam 资料解析跳转到了非官方地址', 502);
    if (!response.ok) throw fail(`Steam 资料解析失败（HTTP ${response.status}）`, 502);
    const xml = await boundedBody(response);
    const match = /<steamID64>\s*(\d{17})\s*<\/steamID64>/i.exec(xml);
    if (!match) throw fail('未能从该 Steam 资料链接识别 SteamID，请改用 SteamID64', 422);
    return steamIdentity(match[1]);
  } catch (error) {
    if (error.name === 'AbortError') throw fail('Steam 资料解析超时，请稍后重试', 504);
    if (error.status) throw error;
    throw fail('无法解析 Steam 资料链接：' + String(error.message || '网络请求失败').slice(0, 160), 502);
  } finally { clearTimeout(timer); }
}

function encodeWhitelist(revision, enabled, players) {
  const entries = players.map(player => `${quoted(player.steam2)}\n{\n${Object.entries({ steam64: player.steam64, addedAt: Math.floor(player.addedAt / 1000), source: player.source }).map(([key, value]) => `${quoted(key)} ${quoted(value)}`).join('\n')}\n}`).join('\n');
  return `"PanelWhitelist"\n{\n"version" "1"\n"revision" ${quoted(revision)}\n"enabled" "${enabled ? '1' : '0'}"\n"players"\n{\n${entries}\n}\n}\n`;
}

function createWhitelist({ serverRoot, playerManager, syncWhitelist, now = Date.now, fetchImpl = globalThis.fetch }) {
  const directory = path.join(serverRoot, 'left4dead2', 'addons', 'sourcemod', 'data', 'l4d2 control');
  const file = path.join(directory, 'whitelist.txt'), auditFile = path.join(directory, 'whitelist audit.jsonl');
  let pending = Promise.resolve();

  async function read() {
    let handle;
    try { handle = await fs.promises.open(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)); }
    catch (error) { if (error.code === 'ENOENT') return { original: null, revision: INITIAL_REVISION, enabled: false, players: [] }; throw error; }
    let original;
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > MAX_FILE_SIZE) throw fail('白名单文件类型或大小异常', 503);
      original = await handle.readFile('utf8');
    } finally { await handle.close(); }
    let parsed;
    try { parsed = parseKeyValues(original); } catch { throw fail('白名单格式无效，未覆盖原文件', 503); }
    const root = fields(fields(parsed).panelwhitelist);
    if (root.version !== '1' || !root.players || typeof root.players !== 'object' || !['0', '1'].includes(String(root.enabled))) throw fail('白名单格式无效，未覆盖原文件', 503);
    if (!/^[a-f0-9]{24}$/.test(String(root.revision || ''))) throw fail('白名单版本标记无效，未覆盖原文件', 503);
    const players = Object.entries(root.players).map(([steam2, raw]) => {
      const row = fields(raw), identity = steamIdentity(steam2), addedAt = Number(row.addedat) * 1000;
      if (identity.steam64 !== String(row.steam64) || !Number.isSafeInteger(addedAt) || addedAt < 0 || !['admin', 'manual'].includes(row.source)) throw fail('白名单记录无效', 503);
      return { ...identity, addedAt, source: row.source };
    });
    if (players.length > 5000 || new Set(players.map(player => player.steam64)).size !== players.length) throw fail('白名单人数超限或身份重复', 503);
    return { original, revision: String(root.revision || ''), enabled: root.enabled === '1', players };
  }

  async function list() {
    const [state, live] = await Promise.all([read(), playerManager.list()]);
    const known = new Map((live.players || []).map(player => [player.steam64, player]));
    return { enabled: state.enabled, revision: state.revision, players: state.players.sort((a, b) => b.addedAt - a.addedAt).map(player => {
      const knownPlayer = known.get(player.steam64);
      return { ...player, name: knownPlayer?.name || '未记录玩家', admin: Boolean(knownPlayer && (knownPlayer.flags || knownPlayer.permissionSource !== 'none')) };
    }) };
  }

  async function write(text) {
    await fs.promises.mkdir(directory, { recursive: true, mode: 0o700 });
    const temp = file + '.' + crypto.randomUUID() + '.tmp';
    try { await fs.promises.writeFile(temp, text, { flag: 'wx', mode: 0o600 }); await fs.promises.rename(temp, file); }
    finally { await fs.promises.rm(temp, { force: true }); }
  }

  function act(payload, actor = 'panel') {
    const job = pending.then(async () => {
      if (!payload || Array.isArray(payload) || typeof payload !== 'object') throw fail('白名单操作格式无效');
      const { action } = payload;
      if (!['set-enabled', 'add', 'remove'].includes(action)) throw fail('白名单操作无效');
      if (action === 'set-enabled' && (typeof payload.enabled !== 'boolean' || payload.confirmed !== true)) throw fail('请先确认白名单模式变更');
      const live = await playerManager.list();
      if (!live.available || !live.whitelistAvailable) throw fail('白名单插件未就绪，请更新并重载 L4D2 Control Players 后重试', 503);
      const state = await read();
      const players = new Map(state.players.map(player => [player.steam64, player]));
      const originalPlayers = new Map(state.players.map(player => [player.steam64, player]));
      let resultIdentity = null, enabled = state.enabled;

      if (action === 'set-enabled') {
        enabled = payload.enabled;
        if (enabled) {
          for (const player of live.players || []) {
            if (player.flags || player.permissionSource !== 'none') {
              const identity = steamIdentity(player.steam64);
              const existing = players.get(identity.steam64);
              players.set(identity.steam64, { ...identity, addedAt: existing?.addedAt || now(), source: 'admin' });
            }
          }
        }
      } else {
        const raw = action === 'add' ? payload.identity : payload.steamId;
        resultIdentity = await profileIdentity(raw, fetchImpl);
        if (action === 'add') {
          if (players.size >= 5000 && !players.has(resultIdentity.steam64)) throw fail('白名单人数已达 5000 上限', 503);
          if (!players.has(resultIdentity.steam64)) players.set(resultIdentity.steam64, { ...resultIdentity, addedAt: now(), source: 'manual' });
        } else if (!players.delete(resultIdentity.steam64)) throw fail('该玩家不在白名单中', 404);
      }
      const nextPlayers = [...players.values()].sort((a, b) => a.steam64.localeCompare(b.steam64));
      const unchanged = enabled === state.enabled && nextPlayers.length === originalPlayers.size && nextPlayers.every(player => {
        const previous = originalPlayers.get(player.steam64);
        return previous && previous.addedAt === player.addedAt && previous.source === player.source;
      });
      if (unchanged) return { changed: false, enabled, player: resultIdentity, message: action === 'set-enabled' ? `白名单模式已${enabled ? '开启' : '关闭'}` : action === 'add' ? '玩家已在白名单中' : '白名单记录未变化' };

      const revision = crypto.randomBytes(12).toString('hex'), next = encodeWhitelist(revision, enabled, nextPlayers);
      if ((await read()).original !== state.original) throw fail('白名单文件已被其他程序修改，请刷新重试', 409);
      await write(next);
      try { await syncWhitelist(revision); }
      catch (error) {
        if ((await read()).original !== next) throw fail('同步失败且白名单被并发修改，请检查服务器', 409);
        if (state.original === null) await fs.promises.rm(file, { force: true }); else await write(state.original);
        try { await syncWhitelist(state.revision); } catch { throw fail('原白名单已恢复到磁盘，但游戏同步失败，请检查插件', 503); }
        throw fail('白名单操作未确认生效，已恢复原记录：' + String(error.message || error).slice(0, 180), 503);
      }
      const actionName = action === 'set-enabled' ? (enabled ? '开启白名单模式' : '关闭白名单模式') : action === 'add' ? '添加白名单' : '移出白名单';
      try { await fs.promises.appendFile(auditFile, JSON.stringify({ at: now(), actor: String(actor).slice(0, 64), action: actionName, enabled, steam64: resultIdentity?.steam64 || '', revision }) + '\n', { mode: 0o600 }); } catch { /* audit failures do not roll back a confirmed game update */ }
      return { changed: true, enabled, player: resultIdentity, revision, message: action === 'set-enabled' ? `白名单模式已${enabled ? '开启' : '关闭'}；名单记录保留` : action === 'add' ? '已加入白名单' : '已从白名单移除' };
    });
    pending = job.catch(() => {});
    return job;
  }

  return { list, act, read };
}

module.exports = { createWhitelist, encodeWhitelist, profileIdentity, INITIAL_REVISION };
