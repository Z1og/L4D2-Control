const { execFile } = require('node:child_process');
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
function needsChineseSummary(text) {
  const letters = (text.match(/\p{L}/gu) || []).length, chinese = (text.match(/\p{Script=Han}/gu) || []).length;
  return letters - chinese >= (chinese ? 24 : 4);
}
async function chineseSummaries(result, request, previous) {
  const saved = new Map([...(previous?.items || []), ...(previous?.reviewItems || [])].map(item => [item.id, item]));
  const pending = [];
  for (const item of [...result.items, ...(result.reviewItems || [])]) {
    if (!item.summary || !needsChineseSummary(item.summary)) continue;
    const cached = saved.get(item.id);
    if (cached?.summaryOriginal === item.summary && cached.translationSource && cached.summary) {
      Object.assign(item, { summary: cached.summary, summaryOriginal: cached.summaryOriginal, translationSource: cached.translationSource });
    } else pending.push(item);
  }
  result.translationError = '';
  const groups = [[], []];
  for (const item of pending) groups[Number(/\p{Script=Han}/u.test(item.summary) && /[a-z]{3}/i.test(item.summary))].push(item);
  try {
    // Auto detection can treat bilingual summaries as Chinese and leave English intact.
    for (const [mixed, group] of groups.entries()) {
      for (let offset = 0; offset < group.length; offset += 20) {
        const batch = group.slice(offset, offset + 20);
        const translated = JSON.parse(await request('https://edge.microsoft.com/translate/translatetext?isEnterpriseClient=false&to=zh-Hans' + (mixed ? '&from=en' : ''), JSON.stringify(batch.map(item => item.summary)), { json: true, label: '简介翻译' }));
        if (!Array.isArray(translated) || translated.length !== batch.length || translated.some(item => typeof item?.translations?.[0]?.text !== 'string' || !item.translations[0].text.trim())) throw new Error('翻译服务返回无效内容');
        batch.forEach((item, index) => { item.summaryOriginal = item.summary; item.summary = translated[index].translations[0].text.trim(); item.translationSource = 'Microsoft 翻译'; });
      }
    }
  } catch (error) { result.translationError = `部分简介翻译失败，已保留原文：${error.message}`; }
  return result;
}
function createBroadcastSource(proxy = '', { request: injectedRequest, now = Date.now } = {}) {
  if (proxy && !/^socks5h:\/\/127\.0\.0\.1:\d{2,5}$/.test(proxy)) throw new Error('无线广播代理配置无效');
  const request = injectedRequest || ((url, body, options = {}) => new Promise((resolve, reject) => {
    const args = ['--fail', '--location', '--silent', '--show-error', '--max-time', '25', '-A', 'L4D2-Control/1.0'];
    if (proxy) args.push('--proxy', proxy);
    if (options.json) args.push('--header', 'Content-Type: application/json');
    if (body) args.push('--data', body);
    args.push(url);
    execFile(process.platform === 'win32' ? 'curl.exe' : 'curl', args, { timeout: 30000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
      if (error) { reject(new Error(`${options.label || 'Steam 资讯'}读取失败${error.code ? `（${error.code}）` : ''}，请检查内容代理后重试`)); return; }
      resolve(stdout);
    });
  }));
  return async (feed, previous) => {
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
    return chineseSummaries({ items, reviewItems, sourceUrl, scanned: ids.length, scope: `检查 ${ids.length} 个工坊战役分类条目，按地图说明、包大小与更新时间筛选近一个月；${reviewItems.length} 条缺少明确地图说明的内容留待管理员核验。分包单独展示，尚未下载核验地图文件。` }, request, previous);
  };
}
module.exports = { createBroadcastSource, normalizeMaps, monthAgo, campaignEvidence, chineseSummaries };
