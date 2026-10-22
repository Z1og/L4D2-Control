const fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto');
const { steamIdentity } = require('./player manager');
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
function createPlayerNotes({ directory, now = Date.now }) {
  const file = path.join(directory, 'player notes.json'); let queue = Promise.resolve();
  async function list() {
    try {
      const stat = await fs.stat(file); if (stat.size > 8 * 1024 * 1024) throw fail('玩家备注文件过大，请检查服务器文件', 500);
      const data = JSON.parse(await fs.readFile(file, 'utf8'));
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('invalid notes');
      for (const [id, entry] of Object.entries(data)) if (!/^\d{17}$/.test(id) || !entry || typeof entry.note !== 'string' || entry.note.length > 500) throw Error('invalid note');
      return data;
    } catch (error) { if (error.code === 'ENOENT') return {}; if (error.status) throw error; throw fail('玩家备注读取失败，未覆盖原文件', 500); }
  }
  async function update(steamId, note, actor = 'admin') {
    const identity = steamIdentity(steamId);
    if (!identity || typeof note !== 'string' || note.length > 500 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(note)) throw fail('备注须为不超过 500 字的文本，SteamID 须有效');
    const operation = queue.then(async () => {
      const data = await list(), clean = note.trim();
      if (clean) data[identity.steam64] = { note: clean, updatedAt: now(), updatedBy: String(actor).slice(0, 128) };
      else delete data[identity.steam64];
      if (Object.keys(data).length > 10000) throw fail('玩家备注数量已达上限', 409);
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      const encoded = JSON.stringify(data); if (Buffer.byteLength(encoded) > 8 * 1024 * 1024) throw fail('玩家备注文件已达容量上限', 409);
      const temporary = file + '.' + crypto.randomUUID() + '.tmp';
      try { await fs.writeFile(temporary, encoded, { flag: 'wx', mode: 0o600 }); await fs.rename(temporary, file); } finally { await fs.rm(temporary, { force: true }); }
      return { steam64: identity.steam64, note: clean, updatedAt: data[identity.steam64]?.updatedAt || null, message: clean ? '玩家备注已保存' : '玩家备注已清除' };
    });
    queue = operation.catch(() => {}); return operation;
  }
  return { list, update };
}
module.exports = { createPlayerNotes };
