const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
function downloadUrl(value, openListUrl) {
  let url;
  try { url = new URL(value); } catch { throw fail('云端未返回有效下载地址', 502); }
  const own = new URL(openListUrl);
  const baidu = /(^|\.)baidupcs\.com$/i.test(url.hostname) || /(^|\.)baidu\.com$/i.test(url.hostname);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || !(url.origin === own.origin || baidu && (!url.port || url.port === '443'))) throw fail('下载地址不是已配置的 OpenList 或百度网盘地址', 502);
  return url;
}
function downloadRange(header, size) {
  if (!header) return null;
  const match = typeof header === 'string' && header.length < 100 && /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || !match[1] && !match[2]) throw fail('只支持单段文件范围下载', 416);
  const first = match[1] ? Number(match[1]) : null, last = match[2] ? Number(match[2]) : null;
  if (first !== null && !Number.isSafeInteger(first) || last !== null && !Number.isSafeInteger(last)) throw fail('下载范围无效', 416);
  const start = first === null ? Math.max(0, size - last) : first;
  const end = first === null || last === null ? size - 1 : Math.min(size - 1, last);
  if (start < 0 || start >= size || end < start) throw fail('下载范围超出文件大小', 416);
  return { start, end, header: `bytes=${start}-${end}` };
}

function createCloudDownloads({ cloudMaps, openListUrl, fetchImpl = globalThis.fetch, maxConcurrent = 2, timeoutMs = 12 * 60 * 60 * 1000 }) {
  let active = 0;
  async function info(name, signal) {
    const item = await cloudMaps.downloadInfo(name, { signal });
    const url = downloadUrl(item.url, openListUrl);
    return { name: item.name, size: item.size, url: url.href, userAgent: item.provider === 'BaiduNetdisk' ? 'pan.baidu.com' : 'L4D2-Control/1.0', direct: url.origin !== new URL(openListUrl).origin };
  }
  async function relay(req, res, name) {
    let counted = false, size;
    const controller = new AbortController();
    const stop = () => { if (!res.writableFinished) controller.abort(); };
    req.once('aborted', stop); res.once('close', stop);
    const timeout = setTimeout(() => controller.abort(), timeoutMs); timeout.unref?.();
    try {
      if (!['GET', 'HEAD'].includes(req.method)) throw fail('不支持的下载方法', 405);
      if (active >= maxConcurrent) throw fail('已有两个地图正在下载，请稍后再试', 429);
      active++; counted = true;
      const item = await info(name, controller.signal); size = item.size;
      const range = downloadRange(req.headers.range, size);
      let url = item.url, response;
      const headers = { 'User-Agent': item.userAgent, 'Accept-Encoding': 'identity' };
      if (range) headers.Range = range.header;
      if (range && typeof req.headers['if-range'] === 'string') headers['If-Range'] = req.headers['if-range'];
      for (let redirects = 0; redirects <= 5; redirects++) {
        downloadUrl(url, openListUrl);
        const headerTimeout = setTimeout(() => controller.abort(), 45000); headerTimeout.unref?.();
        try { response = await fetchImpl(url, { method: req.method, headers, redirect: 'manual', signal: controller.signal }); }
        finally { clearTimeout(headerTimeout); }
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        const next = response.headers.get('location'); await response.body?.cancel();
        if (!next || redirects === 5) throw fail('云端下载重定向异常', 502);
        url = downloadUrl(new URL(next, url).href, openListUrl).href;
      }
      if (![200, 206].includes(response.status)) { await response.body?.cancel(); throw fail(response.status === 403 ? '百度下载被拒绝，请刷新地图列表后重试' : '云端下载暂不可用，请稍后重试', 502); }
      if (/text\/html|application\/json/i.test(response.headers.get('content-type') || '')) { await response.body?.cancel(); throw fail('云端返回了错误页面，未作为地图下载', 502); }
      let expected = size;
      const contentRange = response.headers.get('content-range');
      if (response.status === 206) {
        const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(contentRange || '');
        if (!range || !match || Number(match[1]) !== range.start || Number(match[2]) !== range.end || Number(match[3]) !== size) { await response.body?.cancel(); throw fail('云端返回的下载范围不匹配', 502); }
        expected = range.end - range.start + 1;
      }
      const length = response.headers.get('content-length');
      if (length !== null && Number(length) !== expected) { await response.body?.cancel(); throw fail('云端文件大小已变化，请刷新后重试', 502); }
      res.statusCode = response.status;
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="map.vpk"; filename*=UTF-8''${encodeURIComponent(item.name).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())}`);
      res.setHeader('Content-Length', expected);
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (response.status === 206) res.setHeader('Content-Range', contentRange);
      for (const key of ['etag', 'last-modified']) { const value = response.headers.get(key); if (value) res.setHeader(key, value); }
      if (req.method === 'HEAD') { await response.body?.cancel(); res.end(); return; }
      if (!response.body) throw fail('云端文件内容为空', 502);
      let bytes = 0;
      const meter = new Transform({ transform(chunk, encoding, done) { bytes += chunk.length; done(bytes > expected ? fail('云端文件超过声明大小', 502) : null, chunk); }, flush(done) { done(bytes !== expected ? fail('云端下载提前中断', 502) : null); } });
      await pipeline(Readable.fromWeb(response.body), meter, res, { signal: controller.signal });
    } catch (error) {
      controller.abort();
      if (res.destroyed) return;
      if (res.headersSent) { res.destroy(); return; }
      res.statusCode = error.status || 502;
      for (const header of ['Content-Length', 'Content-Disposition', 'Content-Range']) res.removeHeader(header);
      if (error.status === 416 && size) res.setHeader('Content-Range', `bytes */${size}`);
      if (error.status === 429) res.setHeader('Retry-After', '5');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify({ error: error.status ? error.message : '下载连接中断，请重新下载或使用直连下载器' }));
    } finally {
      clearTimeout(timeout); req.removeListener('aborted', stop); res.removeListener('close', stop);
      if (counted) active--;
    }
  }
  return { info, relay, activeCount: () => active };
}
module.exports = { createCloudDownloads, downloadUrl, downloadRange };
