const { execFile } = require('node:child_process');
const cheerio = require('cheerio');
const { parseSearch } = require('./steam source');

const steamFile = id => `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`;
function campaignEvidence(item) {
  const text = String(item.title || '') + '\n' + String(item.description || '');
  const mapDescription = /\b(?:[2-9]|1\d)[- ](?:map|chapter|level)\s+campaign\b|\bbsp\s*(?:names?|files?)\s*:|\bM[1-9]\s*(?:to|[-–~])\s*M[1-9]\b|(?:自制|原创|合作|完整|移植|全新).{0,5}战役|战役.{0,12}(?:章节|关卡)|[二三四五六七八九十2-9]\s*(?:个)?章节|地图名[称]?\s*[:：]|\bmap\s+name\s*:|\bL4D2\s+port\b.{0,120}\b(?:campaign|survival map)\b/i;
  // Authors also give music and texture patches only the Campaigns tag.
  // Require positive map evidence regardless of tags; uncertainty stays in review.
  return Number(item.file_size) >= 8 * 1024 * 1024 && mapDescription.test(text) ? '战役分类与地图说明' : '';
}
function monthAgo(now) {
  const date = new Date(now), day = date.getUTCDate();
  date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() - 1);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, last)); return date.getTime();
}
function parseGuides(html) {
  const $ = cheerio.load(html), items = [], seen = new Set();
  $('a.workshopItemCollection[data-appid="550"]').each((_, element) => {
    const card = $(element), id = card.attr('data-publishedfileid');
    if (!card.find('.guide').length || !/^\d{1,20}$/.test(id || '') || seen.has(id)) return;
    const title = card.find('.workshopItemTitle').text().trim().slice(0, 200);
    if (!title) return;
    seen.add(id); items.push({ id, title, author: card.find('.workshopItemAuthorName').text().trim().slice(0, 120), summary: card.find('.workshopItemShortDesc').text().trim().slice(0, 500), url: steamFile(id) });
  });
  return items.slice(0, 30);
}
function normalizeMaps(candidates, details, now) {
  const seen = new Set(), cutoff = monthAgo(now);
  return details.flatMap(item => {
    const id = String(item.publishedfileid), card = candidates.find(entry => entry.id === id);
    const updated = Number(item.time_updated) * 1000, created = Number(item.time_created) * 1000;
    const tags = Array.isArray(item.tags) ? item.tags.map(tag => String(tag.tag)) : [];
    if (!card || seen.has(id) || item.result !== 1 || item.consumer_app_id !== 550 || !tags.includes('Campaigns') || !Number.isFinite(updated) || updated < cutoff || updated > now + 300000) return [];
    seen.add(id);
    const evidence = campaignEvidence(item);
    return [{ id: `steam-${id}`, workshopId: id, title: card.title, english: '', summary: String(item.description || '').replace(/\[[^\]]*\]/g, '').replace(/<[^>]*>/g, '').slice(0, 500), url: steamFile(id), source: 'Steam 创意工坊', updatedAt: new Date(updated).toISOString(), publishedAt: Number.isFinite(created) && created > 0 ? new Date(created).toISOString() : null, isNew: created >= cutoff && created <= now + 300000, tags: tags.slice(0, 12), kind: evidence ? 'recent' : 'candidate', evidence }];
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
function createBroadcastSource(proxy = '', { request: injectedRequest, now = Date.now } = {}) {
  if (proxy && !/^socks5h:\/\/127\.0\.0\.1:\d{2,5}$/.test(proxy)) throw new Error('无线广播代理配置无效');
  const request = injectedRequest || ((url, body) => new Promise((resolve, reject) => {
    const args = ['--fail', '--silent', '--show-error', '--max-time', '25', '-A', 'L4D2-Control/1.0'];
    if (proxy) args.push('--proxy', proxy);
    if (body) args.push('--data', body);
    args.push(url);
    execFile(process.platform === 'win32' ? 'curl.exe' : 'curl', args, { timeout: 30000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
      if (error) { reject(new Error(`Steam 资讯读取失败${error.code ? `（${error.code}）` : ''}，请检查内容代理后重试`)); return; }
      resolve(stdout);
    });
  }));
  return async feed => {
    if (feed === 'guides') {
      const url = 'https://steamcommunity.com/app/550/guides/?browsefilter=toprated&browsesort=toprated&requiredtags%5B0%5D=schinese&l=schinese';
      const found = [];
      for (let page = 1; page <= 3; page++) {
        const batch = parseGuides(await request(`${url}&p=${page}`));
        found.push(...batch.filter(item => /[\u3400-\u9fff]/.test(item.title + item.summary)));
        if (found.length >= 30 || batch.length < 30) break;
      }
      const items = [...new Map(found.map(item => [item.id, item])).values()].slice(0, 30);
      if (!items.length) throw new Error('未读取到 Steam 指南，保留上次内容；请稍后重试');
      return { items: items.map(item => ({ ...item, id: `guide-${item.id}`, kind: 'guide', source: 'Steam 社区指南', tags: ['网络攻略'], content: '', map: '' })), sourceUrl: url, scope: 'Steam 简体中文标签的高评分指南，筛选含中文标题或摘要的条目；最多检查 90 条、展示 30 条，摘要来自作者，未经人工验证。' };
    }
    if (feed !== 'maps') throw new Error('未知资讯来源');
    const candidates = [], sourceUrl = 'https://steamcommunity.com/workshop/browse/?appid=550&browsesort=lastupdated&requiredtags%5B%5D=Campaigns&l=schinese';
    // Bound the collection cost and expose its coverage rather than implying a full index.
    for (let page = 1; page <= 3; page++) {
      const batch = parseSearch(await request(`${sourceUrl}&p=${page}`));
      if (!batch.length && page === 1) throw new Error('未读取到 Steam 战役目录，保留上次内容；请稍后重试');
      candidates.push(...batch); if (batch.length < 30) break;
    }
    const ids = [...new Set(candidates.map(item => item.id))], body = new URLSearchParams({ itemcount: String(ids.length) });
    ids.forEach((id, index) => body.set(`publishedfileids[${index}]`, id));
    const json = JSON.parse(await request('https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/', body.toString()));
    const details = json.response?.publishedfiledetails;
    if (!Array.isArray(details) || !details.some(item => item.result === 1 && item.consumer_app_id === 550)) throw new Error('Steam 地图详情不可用，保留上次内容');
    const normalized = normalizeMaps(candidates, details, now()), items = normalized.filter(item => item.kind === 'recent'), reviewItems = normalized.filter(item => item.kind === 'candidate');
    return { items, reviewItems, sourceUrl, scanned: ids.length, scope: `检查 ${ids.length} 个工坊战役分类条目，按地图说明、包大小与更新时间筛选近一个月；${reviewItems.length} 条缺少明确地图说明的内容留待管理员核验。分包单独展示，尚未下载核验地图文件。` };
  };
}
module.exports = { createBroadcastSource, parseGuides, normalizeMaps, monthAgo, campaignEvidence };
