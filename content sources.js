const https = require('https');
const dns = require('dns');
const net = require('net');
const cheerio = require('cheerio');
const { SocksProxyAgent } = require('socks-proxy-agent');

const base = 'https://www.gamemaps.com';
function officialUrl(value, origin = base) {
  const url = new URL(value, origin);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !(url.hostname === 'gamemaps.com' || url.hostname.endsWith('.gamemaps.com'))) throw new Error('GameMaps 下载地址不属于官方站点');
  return url;
}
function publicAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return a !== 0 && a !== 10 && a !== 127 && a < 224 && !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && b === 168) && !(a === 100 && b >= 64 && b <= 127);
  }
  return net.isIPv6(address) && /^2|^3/.test(address);
}
function lookup(host, options, callback) {
  dns.lookup(host, { family: options.family || 0, all: true }, (error, entries) => {
    if (error) return callback(error);
    if (!entries.length || entries.some(entry => !publicAddress(entry.address))) return callback(new Error('GameMaps 地址解析无效'));
    if (options.all) callback(null, entries);
    else callback(null, entries[0].address, entries[0].family);
  });
}
async function request(value, { signal, method = 'GET', body, redirects = 0, origin, agent } = {}) {
  if (redirects > 5) throw new Error('GameMaps 重定向次数过多');
  const url = officialUrl(value, origin);
  const response = await new Promise((resolve, reject) => {
    const headers = { 'user-agent': 'DeadAirPanel/1.0', accept: '*/*' };
    if (body) { headers['content-type'] = 'application/x-www-form-urlencoded'; headers['content-length'] = Buffer.byteLength(body); }
    const req = https.request(url, { method, headers, lookup, signal, timeout: 30000, agent }, resolve);
    req.on('timeout', () => req.destroy(new Error('GameMaps 请求超时')));
    req.on('error', reject);
    req.end(body);
  });
  if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
    response.resume();
    const keepBody = [307, 308].includes(response.statusCode);
    return request(response.headers.location, { signal, origin: url.href, redirects: redirects + 1, method: keepBody ? method : 'GET', body: keepBody ? body : undefined, agent });
  }
  if (response.statusCode !== 200) {
    response.resume();
    if (response.headers['cf-mitigated'] === 'challenge') throw Object.assign(new Error('GameMaps 要求 Cloudflare 站点验证，当前节点暂时无法读取。请切换节点后重试，或使用相同关键词搜索 Steam。'), { code: 'GAMEMAPS_CHALLENGE', status: response.statusCode });
    if ([403, 429, 503].includes(response.statusCode)) throw new Error(`GameMaps 暂时拒绝服务器访问（HTTP ${response.statusCode}，可能需要站点验证），请稍后重试`);
    throw new Error(`GameMaps 请求失败（HTTP ${response.statusCode}）`);
  }
  return response;
}
async function text(response) {
  const chunks = []; let size = 0;
  for await (const chunk of response) {
    size += chunk.length;
    if (size > 8 * 1024 * 1024) { response.destroy(); throw new Error('GameMaps 页面过大'); }
    chunks.push(chunk);
  }
  const html = Buffer.concat(chunks).toString('utf8');
  if (/cf-chl-|Just a moment|Verify you are human/i.test(html)) throw Object.assign(new Error('GameMaps 要求 Cloudflare 站点验证，当前节点暂时无法读取。请切换节点后重试，或使用相同关键词搜索 Steam。'), { code: 'GAMEMAPS_CHALLENGE' });
  return html;
}
function parseSearch(html) {
  const $ = cheerio.load(html), items = [], seen = new Set();
  const scope = $('.provider.gamemaps').length ? $('.provider.gamemaps .paged-list .item-list') : $.root();
  scope.find('[data-info], article.list-item-file').each((_, element) => {
    let info = {}; try { info = JSON.parse($(element).attr('data-info') || '{}'); } catch { return; }
    const link = info.url || $(element).find('a[href*="/details/"]').first().attr('href');
    const match = String(link || '').match(/^\/?(?:https:\/\/www\.gamemaps\.com\/)?details\/(\d+)\/?$/);
    if (!match || seen.has(match[1]) || items.length >= 24) return;
    const image = info.image || $(element).find('img').first().attr('src') || '';
    const title = String(info.title || $(element).find('.title').first().text()).trim();
    if (!title) return;
    let safeImage = ''; try { safeImage = image ? officialUrl(image).href : ''; } catch { /* Omit third-party assets. */ }
    seen.add(match[1]); items.push({ id: match[1], title, image: safeImage, url: `${base}/details/${match[1]}` });
  });
  return items;
}
async function search(query, page, signal, agent) {
  const url = new URL(query ? '/search/l4d2' : '/l4d2', base);
  if (query) { url.searchParams.set('provider', 'gamemaps'); url.searchParams.set('q', query); }
  if (page > 1) url.searchParams.set('page', page);
  const html = await text(await request(url, { signal, agent }));
  const $ = cheerio.load(html);
  const hasMore = $('a[rel~="next"], a.next').length > 0;
  return { query, page, items: parseSearch(html), source: 'gamemaps', hasMore };
}
async function download(id, signal, agent) {
  const html = await text(await request(`${base}/details/${id}`, { signal, agent }));
  const $ = cheerio.load(html);
  if (!$('a[href^="/l4d2"], a[href^="https://www.gamemaps.com/l4d2"]').length) throw new Error('GameMaps 项目不是求生之路 2 内容');
  const form = $('form[action="/downloads/download"]');
  if (!form.length) throw new Error('GameMaps 未提供可用下载入口');
  const params = new URLSearchParams();
  form.find('input[name]').each((_, element) => { const name = $(element).attr('name'); if (name && $(element).attr('value')) params.append(name, $(element).attr('value')); });
  if (!params.get('ids[]')) params.set('ids[]', id);
  if (!params.has('noqueue')) params.set('noqueue', 'true');
  if (!params.has('direct')) params.set('direct', 'true');
  const response = await request(`${base}/downloads/download`, { signal, method: 'POST', body: params.toString(), agent });
  if (/text\/html|application\/json/.test(response.headers['content-type'] || '')) {
    await text(response);
    throw new Error('GameMaps 未返回文件（可能需要站点验证或登录），本次未安装任何内容');
  }
  return response;
}
function createSource(proxy = '', { browserBin = process.env.GAMEMAPS_BROWSER_BIN || '' } = {}) {
  if (proxy && (!/^socks5h:\/\/127\.0\.0\.1:\d{2,5}$/.test(proxy) || +new URL(proxy).port < 1 || +new URL(proxy).port > 65535)) throw new Error('GameMaps 代理配置无效');
  // A per-source agent keeps game control and other network requests unproxied.
  const agent = proxy ? new SocksProxyAgent(proxy, { timeout: 15000 }) : undefined;
  if (browserBin) return require('./gamemaps browser').createBrowserSource({ proxy, browserBin });
  return { search: (query, page, signal) => search(query, page, signal, agent), download: (id, signal) => download(id, signal, agent) };
}
module.exports = { search, download, parseSearch, officialUrl, createSource };
