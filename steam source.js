const https = require('https');
const cheerio = require('cheerio');
const { SocksProxyAgent } = require('socks-proxy-agent');

const detailsUrl = 'https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/';
function officialFileUrl(value) {
  const url = new URL(value);
  const host = url.hostname;
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !(host === 'cdn.steamusercontent.com' || host === 'steamusercontent-a.akamaihd.net' || host === 'steamcontent.com' || host.endsWith('.steamcontent.com'))) throw new Error('Steam 文件地址不属于官方 HTTPS 下载站点');
  return url;
}
function buildSearchUrl(query, page = 1) {
  const params = new URLSearchParams({ appid: '550', searchtext: query, p: String(page), l: 'schinese' });
  return `https://steamcommunity.com/workshop/browse/?${params.toString()}`;
}
function parseSearch(html) {
  const $ = cheerio.load(html), items = [], seen = new Set();
  // Keep identity and preview inside one link; never scan into the next card.
  $('a[href*="/sharedfiles/filedetails/"]').each((_, element) => {
    const link = $(element), image = link.find('img').first();
    if (!image.length || items.length >= 30) return;
    let url;
    try { url = new URL(link.attr('href'), 'https://steamcommunity.com'); } catch { return; }
    const id = url.searchParams.get('id');
    if (url.protocol !== 'https:' || url.hostname !== 'steamcommunity.com' || url.pathname !== '/sharedfiles/filedetails/' || !/^\d{1,20}$/.test(id || '') || seen.has(id)) return;
    const title = (image.attr('alt') || link.attr('title') || '').trim();
    if (!title) return;
    let preview = '';
    try {
      const imageUrl = new URL(image.attr('src'));
      if (imageUrl.protocol === 'https:' && !imageUrl.username && !imageUrl.password) preview = imageUrl.href;
    } catch { /* A missing preview does not prevent finding the item. */ }
    seen.add(id);
    items.push({ id, title, image: preview, url: `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}` });
  });
  return items;
}
function createSource(proxy = '', { search } = {}) {
  if (proxy && (!/^socks5h:\/\/127\.0\.0\.1:\d{2,5}$/.test(proxy) || +new URL(proxy).port < 1 || +new URL(proxy).port > 65535)) throw new Error('Steam 代理配置无效');
  const agent = proxy ? new SocksProxyAgent(proxy, { timeout: 15000 }) : undefined;
  async function request(value, { signal, body, redirects = 0 } = {}) {
    if (redirects > 5) throw new Error('Steam 文件重定向次数过多');
    const url = body ? new URL(detailsUrl) : officialFileUrl(value);
    const headers = { 'user-agent': 'L4D2-Control/1.0', accept: '*/*' };
    if (body) { headers['content-type'] = 'application/x-www-form-urlencoded'; headers['content-length'] = Buffer.byteLength(body); }
    const response = await new Promise((resolve, reject) => {
      const req = https.request(url, { method: body ? 'POST' : 'GET', headers, agent, signal, timeout: 30000 }, resolve);
      req.on('timeout', () => req.destroy(new Error('Steam 官方文件请求超时')));
      req.on('error', reject);
      req.end(body);
    });
    if (!body && [301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
      response.resume();
      return request(new URL(response.headers.location, url), { signal, redirects: redirects + 1 });
    }
    if (response.statusCode !== 200) { response.resume(); throw new Error(`Steam 官方文件请求失败（HTTP ${response.statusCode}）`); }
    return response;
  }
  async function details(id, signal, expectedTitle) {
    if (typeof id !== 'string' || !/^\d{1,20}$/.test(id)) throw new Error('invalid workshop id');
    const body = new URLSearchParams({ itemcount: '1', 'publishedfileids[0]': id }).toString();
    const response = await request(detailsUrl, { signal, body });
    const chunks = []; let size = 0;
    for await (const chunk of response) {
      size += chunk.length;
      if (size > 1024 * 1024) { response.destroy(); throw new Error('Steam 项目详情过大'); }
      chunks.push(chunk);
    }
    const item = JSON.parse(Buffer.concat(chunks).toString('utf8')).response?.publishedfiledetails?.[0];
    if (!item || item.result !== 1 || String(item.publishedfileid) !== id || item.consumer_app_id !== 550) throw new Error('Steam 项目不存在或不是求生之路 2 内容');
    const bytes = Number(item.file_size);
    let title = String(item.title || '').trim();
    const normalize = value => String(value || '').slice(0, 160).replace(/\s+/g, ' ').trim();
    // The metadata API uses the original title. Verify localized names against a fresh
    // official search, matching BOTH ID and title, never trusting the client alone.
    if (search && expectedTitle && expectedTitle !== `steam-workshop ${id}` && normalize(expectedTitle) !== normalize(title)) {
      const result = await search(expectedTitle, 1, signal);
      const match = result.items?.find(entry => entry.id === id && normalize(entry.title) === normalize(expectedTitle));
      if (match) title = match.title;
    }
    return { title, fileUrl: item.file_url ? officialFileUrl(item.file_url).href : null, bytes: Number.isSafeInteger(bytes) && bytes > 0 ? bytes : null };
  }
  return { details, download: (url, signal) => request(url, { signal }) };
}
module.exports = { createSource, parseSearch, buildSearchUrl, officialFileUrl };
