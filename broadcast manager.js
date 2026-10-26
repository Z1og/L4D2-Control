const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { classics, guides } = require('./broadcast seeds');
const { monthAgo } = require('./broadcast sources');

const fail = message => Object.assign(new Error(message), { status: 400 });
function sourceLink(value) {
  if (!value) return '';
  let url; try { url = new URL(value); } catch { throw fail('来源链接格式无效'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.href.length > 2000 || !url.hostname.includes('.') || /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.)/i.test(url.hostname)) throw fail('请填写公开的 HTTPS 来源链接');
  for (const key of [...url.searchParams.keys()]) if (key.startsWith('utm_')) url.searchParams.delete(key);
  return url.href;
}
function cleanEntry(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('内容格式无效');
  const text = (key, limit, required = false) => {
    if (input[key] != null && typeof input[key] !== 'string') throw fail(`${key} 格式无效`);
    const value = String(input[key] || '').trim();
    if (value.length > limit || required && !value) throw fail(`${key} 内容为空或过长`);
    return value;
  };
  if (!['classic', 'guide', 'qa', 'review'].includes(input.kind)) throw fail('内容分类无效');
  if (!Array.isArray(input.tags) || input.tags.length > 8 || input.tags.some(tag => typeof tag !== 'string' || !tag.trim() || tag.length > 30)) throw fail('标签最多 8 个，每个不超过 30 字');
  const verifiedAt = text('verifiedAt', 10);
  if (verifiedAt && (!/^\d{4}-\d{2}-\d{2}$/.test(verifiedAt) || !Number.isFinite(Date.parse(verifiedAt + 'T00:00:00Z')) || new Date(verifiedAt + 'T00:00:00Z').toISOString().slice(0, 10) !== verifiedAt)) throw fail('验证日期无效');
  const entry = { kind: input.kind, title: text('title', 200, true), english: text('english', 200), summary: text('summary', 600), content: text('content', 20000), url: sourceLink(text('url', 2000)), source: text('source', 80), author: text('author', 120), tags: [...new Set(input.tags.map(tag => tag.trim()))], map: text('map', 200), applicability: text('applicability', 300), verifiedAt, pinned: input.pinned === true, linkType: input.linkType === 'search' ? 'search' : 'article' };
  if (!entry.content && !entry.url) throw fail('至少填写正文或来源链接');
  return entry;
}
function createBroadcast({ directory, collect, now = Date.now }) {
  const filename = path.join(directory, 'broadcast.json'), pending = new Map();
  let state, loading, queue = Promise.resolve();
  async function load() {
    if (state) return state;
    if (!loading) loading = (async () => {
      try {
        const raw = await fs.readFile(filename, 'utf8');
        if (Buffer.byteLength(raw) > 16 * 1024 * 1024) throw new Error('无线广播数据过大');
        const saved = JSON.parse(raw);
        if (saved.schema !== 1 || !Array.isArray(saved.entries) || saved.entries.length > 1000 || !saved.feeds || typeof saved.feeds !== 'object') throw new Error('无线广播数据格式无效');
        state = saved;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        state = { schema: 1, entries: structuredClone([...classics, ...guides]), feeds: {} };
      }
      return state;
    })().finally(() => { loading = null; });
    return loading;
  }
  function mutate(action) {
    const operation = queue.then(async () => {
      const next = structuredClone(await load()), result = action(next);
      const serialized = JSON.stringify(next, null, 2) + '\n';
      if (Buffer.byteLength(serialized) > 16 * 1024 * 1024) throw Object.assign(new Error('广播内容超过 16 MB，请先导出并整理旧记录'), { status: 413 });
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      const temporary = filename + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
      try { await fs.writeFile(temporary, serialized, { mode: 0o600 }); await fs.rename(temporary, filename); }
      catch (error) { await fs.rm(temporary, { force: true }); throw error; }
      state = next; return result;
    });
    queue = operation.catch(() => {}); return operation;
  }
  async function snapshot() {
    const data = structuredClone(await load()), at = now();
    for (const feed of ['maps', 'guides']) {
      const saved = data.feeds[feed] || { items: [], updatedAt: null, error: '' };
      if (feed === 'maps') saved.items = saved.items.filter(item => Date.parse(item.updatedAt) >= monthAgo(at) && Date.parse(item.updatedAt) <= at + 300000);
      saved.items = saved.items.filter(item => !data.dismissed?.includes(item.id));
      if (feed === 'maps') saved.reviewItems = (saved.reviewItems || []).filter(item => Date.parse(item.updatedAt) >= monthAgo(at) && Date.parse(item.updatedAt) <= at + 300000 && !data.dismissed?.includes(item.id) && !data.entries.some(entry => entry.kind === 'classic' && entry.url === item.url));
      data.feeds[feed] = { ...saved, refreshing: pending.has(feed) };
    }
    return data;
  }
  async function save(input) {
    const entry = cleanEntry(input), id = input.id;
    if (id !== undefined && (typeof id !== 'string' || !/^[\w-]{1,100}$/.test(id))) throw fail('内容编号无效');
    await mutate(data => {
      const index = id ? data.entries.findIndex(item => item.id === id) : -1;
      if (id && index < 0) throw Object.assign(new Error('内容已不存在，请刷新后重试'), { status: 404 });
      if (index < 0 && data.entries.length >= 1000) throw fail('已达到 1000 条收录上限');
      const previous = data.entries[index], at = new Date(now()).toISOString();
      const saved = { ...entry, id: id || crypto.randomUUID(), publishedAt: previous?.publishedAt || at, updatedAt: at };
      if (index >= 0) data.entries[index] = saved; else data.entries.push(saved);
    });
    return snapshot();
  }
  async function remove({ id, confirmed }) {
    if (confirmed !== true) throw fail('请确认删除内容');
    await mutate(data => {
      const index = data.entries.findIndex(item => item.id === id);
      if (index >= 0) data.entries.splice(index, 1);
      else if (Object.values(data.feeds).some(feed => [...feed.items, ...(feed.reviewItems || [])].some(item => item.id === id))) {
        data.dismissed = [...new Set([...(data.dismissed || []), id])].slice(-2000);
      } else throw Object.assign(new Error('内容已不存在'), { status: 404 });
    });
    return snapshot();
  }
  function refresh(feed) {
    if (!['maps', 'guides'].includes(feed)) return Promise.reject(fail('资讯类型无效'));
    if (pending.has(feed)) return pending.get(feed);
    const operation = (async () => {
      try {
        const result = await collect(feed, (await load()).feeds[feed]);
        await mutate(data => { data.feeds[feed] = { ...result, updatedAt: new Date(now()).toISOString(), error: '', errorAt: null }; });
      } catch (error) {
        await mutate(data => { data.feeds[feed] = { ...(data.feeds[feed] || { items: [], updatedAt: null }), error: error.message, errorAt: new Date(now()).toISOString() }; });
        throw Object.assign(new Error(error.message), { status: 502 });
      }
    })().finally(() => pending.delete(feed));
    pending.set(feed, operation); return operation.then(snapshot);
  }
  return { snapshot, save, remove, refresh };
}
module.exports = { createBroadcast, cleanEntry, sourceLink };
