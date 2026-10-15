const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const cheerio = require('cheerio');
const { chromium } = require('playwright-core');
const { parseSearch, officialUrl } = require('./content sources');

const base = 'https://www.gamemaps.com';
const maxBytes = 2 * 1024 ** 3;
const removeTemporary = directory => fs.promises.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
async function launchChrome(browserBin, profile, env, proxy) {
  // A loopback debugging port connects to an ordinary headed Chrome process.
  const port = await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const number = server.address().port;
      server.close(error => error ? reject(error) : resolve(number));
    });
  });
  const child = spawn(browserBin, ['--no-sandbox', '--disable-dev-shm-usage', `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', ...(proxy ? [`--proxy-server=${proxy.replace('socks5h:', 'socks5:')}`] : []), 'about:blank'], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  const stop = async () => {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
    await new Promise(resolve => {
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
      child.kill('SIGTERM');
    });
  };
  try {
    const endpoint = await new Promise((resolve, reject) => {
      let output = '';
      const timeout = setTimeout(() => reject(new Error('GameMaps 浏览器启动超时')), 15000);
      const fail = error => { clearTimeout(timeout); reject(error); };
      child.once('error', fail);
      child.once('exit', code => fail(new Error(`GameMaps 浏览器退出 ${code}`)));
      child.stderr.on('data', chunk => {
        output = (output + chunk).slice(-16384);
        const match = output.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/[^\s]+)/);
        if (match) { clearTimeout(timeout); resolve(match[1]); }
      });
    });
    const browser = await chromium.connectOverCDP(endpoint, { timeout: 15000 });
    return { browser, stop };
  } catch (error) { await stop(); throw error; }
}
function challenge() {
  return Object.assign(new Error('GameMaps 当前要求站点验证，请切换代理节点后重试。也可以输入 GameMaps 项目编号读取详情并安装。'), { code: 'GAMEMAPS_CHALLENGE' });
}
async function display() {
  if (process.env.DISPLAY || process.platform !== 'linux') return { env: process.env, close() {} };
  const child = spawn('/usr/bin/Xvfb', ['-displayfd', '3', '-screen', '0', '1280x900x24', '-nolisten', 'tcp'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe'] });
  const close = () => { child.kill('SIGTERM'); };
  try {
    const number = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('GameMaps 浏览器显示服务启动超时')), 10000);
      let value = '';
      const fail = error => { clearTimeout(timeout); reject(error); };
      child.once('error', fail);
      child.once('exit', code => fail(new Error(`GameMaps 显示服务退出 ${code}`)));
      child.stdio[3].on('data', chunk => { value += chunk; if (/^\d+\n$/.test(value)) { clearTimeout(timeout); resolve(value.trim()); } });
    });
    return { env: { ...process.env, DISPLAY: `:${number}` }, close };
  } catch (error) { close(); throw error; }
}
function detail(html, id) {
  const $ = cheerio.load(html);
  if (!$('form[action="/downloads/download"]').length) throw challenge();
  if (!$('a[href^="/l4d2"], a[href^="https://www.gamemaps.com/l4d2"]').length) throw new Error('GameMaps 项目不是求生之路 2 内容');
  const title = $('h1').first().text().trim() || $('meta[property="og:title"]').attr('content') || '';
  let image = ''; try { image = officialUrl($('meta[property="og:image"]').attr('content')).href; } catch { /* Optional image. */ }
  if (!title) throw new Error('GameMaps 项目名称无法读取');
  return { id, title, image, url: `${base}/details/${id}` };
}
function createBrowserSource({ proxy, browserBin }) {
  // One browser at a time keeps memory bounded on a small game server.
  let busy = false;
  const profile = process.env.GAMEMAPS_BROWSER_PROFILE || path.join(os.homedir(), '.local', 'state', 'dead-air-panel', 'gamemaps browser');
  fs.mkdirSync(profile, { recursive: true, mode: 0o700 });
  fs.chmodSync(profile, 0o700);
  async function run(signal, action) {
    signal?.throwIfAborted();
    if (busy) throw new Error('GameMaps 正在处理另一个请求，请稍后重试');
    busy = true;
    let browser, screen, temporary, stop, context, keep = false;
    const close = () => { browser?.close().catch(() => {}); };
    try {
      temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'panel-gamemaps-'));
      fs.chmodSync(temporary, 0o700);
      screen = await display();
      signal?.throwIfAborted();
      ({ browser, stop } = await launchChrome(browserBin, profile, screen.env, proxy));
      signal?.addEventListener('abort', close, { once: true });
      signal?.throwIfAborted();
      context = browser.contexts()[0];
      const page = context.pages()[0] || await context.newPage();
      page.setDefaultTimeout(20000);
      const result = await action({ browser, context, page, temporary });
      signal?.throwIfAborted();
      keep = !!result?.browserDownloaded;
      return result;
    } catch (error) { if (signal?.aborted) throw signal.reason; throw error; }
    finally {
      signal?.removeEventListener('abort', close);
      try {
        if (browser?.isConnected()) {
          const session = await browser.newBrowserCDPSession().catch(() => null);
          await session?.send('Browser.close').catch(() => {});
        }
        await browser?.close().catch(() => {});
      } finally {
        await stop?.(); screen?.close(); busy = false;
        if (temporary && !keep) await removeTemporary(temporary);
      }
    }
  }
  async function navigate(page, url) {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    if (!response) throw challenge();
    // A real browser may complete an automatic site check after the first response.
    if (/Just a moment|Attention Required/i.test(await page.title())) {
      await page.waitForFunction(() => !/Just a moment|Attention Required/i.test(document.title), undefined, { timeout: 15000 }).catch(() => {});
    } else if (response.status() !== 200) throw challenge();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => document.readyState !== 'loading', undefined, { timeout: 10000 });
    const html = await page.content();
    if (/cf-chl-|Just a moment|Attention Required!|Verify you are human/i.test(html)) throw challenge();
    return html;
  }
  return {
    search(query, pageNumber = 1, signal) {
      return run(signal, async ({ page }) => {
        const id = String(query).trim().match(/^(?:https:\/\/(?:www\.)?gamemaps\.com\/details\/)?(\d{1,20})\/?$/)?.[1];
        if (id) return { query, page: 1, source: 'gamemaps', items: [detail(await navigate(page, `${base}/details/${id}`), id)], hasMore: false };
        const url = new URL(query ? '/search/l4d2' : '/l4d2', base);
        if (query) await navigate(page, `${base}/l4d2`);
        if (query) { url.searchParams.set('provider', 'gamemaps'); url.searchParams.set('q', query); }
        if (pageNumber > 1) url.searchParams.set('page', pageNumber);
        const html = await navigate(page, url.href), $ = cheerio.load(html);
        return { query, page: pageNumber, source: 'gamemaps', items: parseSearch(html), hasMore: $('a[rel~="next"], a.next').length > 0 };
      });
    },
    async download(id, signal, onProgress = () => {}) {
      if (!/^\d{1,20}$/.test(id)) throw new Error('invalid gamemaps id');
      const result = await run(signal, async ({ browser, context, page, temporary }) => {
        detail(await navigate(page, `${base}/details/${id}`), id);
        const session = await browser.newBrowserCDPSession();
        const pageSession = await context.newCDPSession(page);
        const { targetInfo } = await pageSession.send('Target.getTargetInfo');
        await pageSession.detach();
        await session.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: temporary, browserContextId: targetInfo.browserContextId, eventsEnabled: true });
        let overflow = false, last = 0, downloadGuid;
        session.on('Browser.downloadWillBegin', event => { downloadGuid ||= event.guid; });
        session.on('Browser.downloadProgress', event => {
          if (event.guid !== downloadGuid) return;
          if (event.totalBytes > maxBytes || event.receivedBytes > maxBytes) {
            overflow = true;
            session.send('Browser.cancelDownload', { guid: event.guid, browserContextId: targetInfo.browserContextId }).catch(() => {});
          }
          if (Date.now() - last > 500 || event.state === 'completed') {
            last = Date.now();
            onProgress({ receivedBytes: event.receivedBytes, totalBytes: event.totalBytes > 0 ? event.totalBytes : null });
          }
        });
        // Submit the site's own form, preserving its actual fields and session.
        const [download] = await Promise.all([
          page.waitForEvent('download', { timeout: 60000 }).catch(error => {
            if (/Timeout/.test(error.message)) throw new Error('GameMaps 未开始传输文件，请重试；本次未安装任何内容');
            throw error;
          }),
          page.locator('form[action="/downloads/download"]').getByRole('button', { name: 'Download', exact: false }).click()
        ]);
        officialUrl(download.url());
        const failure = await download.failure();
        if (failure) throw new Error(`GameMaps 下载失败：${failure}`);
        if (!downloadGuid || !/^[a-z0-9-]+$/i.test(downloadGuid)) throw new Error('GameMaps 下载文件标识无效');
        const file = path.join(temporary, downloadGuid);
        if (overflow || fs.statSync(file).size > maxBytes) throw new Error('下载文件超过 2 GiB 限制');
        const size = fs.statSync(file).size;
        if (!size) throw new Error('GameMaps 下载文件为空');
        onProgress({ receivedBytes: size, totalBytes: size });
        return { browserDownloaded: true, temporary, file, size };
      });
      try {
        signal?.throwIfAborted();
        const stream = fs.createReadStream(result.file);
        stream.headers = { 'content-length': String(result.size) };
        stream.browserDownloaded = true;
        stream.once('close', () => { removeTemporary(result.temporary).catch(error => console.error('GameMaps temporary cleanup failed:', error.code)); });
        return stream;
      } catch (error) { await removeTemporary(result.temporary); throw error; }
    }
  };
}
module.exports = { createBrowserSource, detail };
