const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { steamIdentity, parseKeyValues } = require('./player manager');
const BAN_DAYS = [1, 3, 7, 30, 180, 3650];
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const fields = value => Object.fromEntries(Object.entries(value || {}).map(([key, val]) => [key.toLowerCase(), val]));
const quoted = value => JSON.stringify(String(value));
function encodeBans(revision, bans) {
  return '"PanelBans"\n{\n"version" "1"\n"revision" ' + quoted(revision) + '\n"bans"\n{\n' + bans.map(ban => quoted(ban.steam2) + '\n{\n' + Object.entries({ steam64: ban.steam64, name: ban.name, expires: Math.floor(ban.expiresAt / 1000), created: ban.createdAt, updated: ban.updatedAt, days: ban.days }).map(([key, value]) => quoted(key) + ' ' + quoted(value)).join('\n') + '\n}').join('\n') + '\n}\n}\n';
}
function createModeration({ serverRoot, playerManager, registeredPlayers = async () => [], syncBans, kickPlayer, now = Date.now }) {
  const directory = path.join(serverRoot, 'left4dead2', 'addons', 'sourcemod', 'data', 'l4d2 control');
  const file = path.join(directory, 'bans.txt'), auditFile = path.join(directory, 'moderation audit.jsonl');
  let pending = Promise.resolve();
  async function read() {
    let handle;
    try { handle = await fs.promises.open(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)); }
    catch (error) { if (error.code === 'ENOENT') return { original: null, bans: [] }; throw error; }
    let original;
    try { const stat = await handle.stat(); if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw fail('黑名单文件异常', 503); original = await handle.readFile('utf8'); }
    finally { await handle.close(); }
    const root = fields(fields(parseKeyValues(original)).panelbans);
    if (root.version !== '1' || !root.bans || typeof root.bans !== 'object') throw fail('黑名单格式无效，未覆盖原文件', 503);
    const bans = Object.entries(root.bans).map(([steam2, raw]) => {
      const row = fields(raw), id = steamIdentity(steam2), expiresAt = Number(row.expires) * 1000;
      if (id.steam64 !== row.steam64 || !Number.isSafeInteger(expiresAt) || expiresAt <= 0) throw fail('黑名单记录无效', 503);
      return { ...id, name: String(row.name || '未记录昵称').slice(0, 128), expiresAt, createdAt: Number(row.created), updatedAt: Number(row.updated), days: Number(row.days) };
    });
    if (new Set(bans.map(ban => ban.steam64)).size !== bans.length) throw fail('黑名单身份重复', 503);
    return { original, bans };
  }
  async function list() { return (await read()).bans.filter(ban => ban.expiresAt > now()).sort((a, b) => b.updatedAt - a.updatedAt); }
  async function write(text) {
    await fs.promises.mkdir(directory, { recursive: true, mode: 0o700 });
    const temp = file + '.' + crypto.randomUUID() + '.tmp';
    try { await fs.promises.writeFile(temp, text, { flag: 'wx', mode: 0o600 }); await fs.promises.rename(temp, file); }
    finally { await fs.promises.rm(temp, { force: true }); }
  }
  function act(payload, actor = 'panel') {
    const job = pending.then(async () => {
      const { action, days } = payload;
      if (!['kick', 'ban', 'kick-ban', 'duration', 'unban'].includes(action) || payload.confirmed !== true) throw fail('请先确认玩家管理操作');
      if (!Array.isArray(payload.steamIds) || payload.steamIds.length < 1 || payload.steamIds.length > 100) throw fail('每次请选择 1–100 位玩家');
      const identities = [...new Map(payload.steamIds.map(value => { const id = steamIdentity(value); return [id.steam64, id]; })).values()];
      if (['ban', 'kick-ban', 'duration'].includes(action) && !BAN_DAYS.includes(days)) throw fail('拉黑时间只能为 1、3、7、30、180 或 3650 天');
      const live = await playerManager.list();
      if (!live.available || !live.moderationAvailable) throw fail('玩家管理插件未就绪，请刷新后重试', 503);
      const state = await read(), active = new Map(state.bans.filter(ban => ban.expiresAt > now()).map(ban => [ban.steam64, ban]));
      const known = new Map([...(await registeredPlayers()), ...live.players].map(player => [player.steam64, player]));
      for (const id of identities) if (!known.has(id.steam64) && !active.has(id.steam64)) throw fail('包含未记录的玩家，请刷新后重新选择');
      const results = [];
      if (action === 'kick') {
        for (const id of identities) {
          const player = known.get(id.steam64);
          if (!player?.online) { results.push({ ...id, ok: false, message: '玩家已离线，未执行踢出' }); continue; }
          try { await kickPlayer(id.steam64, player.userId); results.push({ ...id, ok: true, message: '已踢出服务器' }); }
          catch (error) { results.push({ ...id, ok: false, message: error.message }); }
        }
      } else {
        const changed = [], timestamp = now();
        for (const id of identities) {
          const previous = active.get(id.steam64);
          if (['duration', 'unban'].includes(action) && !previous) { results.push({ ...id, ok: false, message: '该玩家已不在有效黑名单中' }); continue; }
          if (action === 'unban') active.delete(id.steam64);
          else active.set(id.steam64, { ...id, name: known.get(id.steam64)?.name || previous?.name || '未记录昵称', createdAt: previous?.createdAt || timestamp, updatedAt: timestamp, days, expiresAt: timestamp + days * 86400000 });
          changed.push(id);
        }
        if (changed.length) {
          const revision = crypto.randomBytes(12).toString('hex'), next = encodeBans(revision, [...active.values()]);
          if ((await read()).original !== state.original) throw fail('黑名单已被其他程序修改，请刷新重试', 409);
          await write(next);
          try { await syncBans(revision); }
          catch (error) {
            if ((await read()).original !== next) throw fail('同步失败且黑名单被并发修改，请检查服务器', 409);
            const restoreRevision = crypto.randomBytes(12).toString('hex');
            await write(encodeBans(restoreRevision, state.bans));
            try { await syncBans(restoreRevision); } catch { throw fail('原黑名单已恢复到磁盘，但游戏同步失败，请检查插件', 503); }
            throw fail('操作未确认生效，已恢复原黑名单：' + error.message, 503);
          }
          results.push(...changed.map(id => ({ ...id, ok: true, message: action === 'unban' ? '已取消面板拉黑' : `已${action === 'duration' ? '重新设置' : '设置'}拉黑 ${days} 天`, expiresAt: active.get(id.steam64)?.expiresAt || null })));
        }
      }
      let auditWarning = '';
      try { await fs.promises.mkdir(directory, { recursive: true, mode: 0o700 }); await fs.promises.appendFile(auditFile, JSON.stringify({ at: now(), actor: String(actor).slice(0, 64), action, days, results }) + '\n', { mode: 0o600 }); }
      catch { auditWarning = '操作已执行，但审计记录保存失败'; }
      const succeeded = results.filter(result => result.ok).length, failed = results.length - succeeded;
      return { results, succeeded, failed, auditWarning, message: `${succeeded} 位成功${failed ? `，${failed} 位未完成` : ''}` };
    });
    pending = job.catch(() => {}); return job;
  }
  return { list, act };
}
module.exports = { createModeration, BAN_DAYS, encodeBans };
