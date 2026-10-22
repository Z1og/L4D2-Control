const pending = new Set();
async function restoreBridge(tabId, tab) {
  let url; try { url = new URL(tab.url); } catch { return; }
  if (!['http:', 'https:'].includes(url.protocol)) return;
  const rule = (await chrome.declarativeNetRequest.getSessionRules()).find(item => item.id === 1);
  if (!rule?.condition.tabIds?.includes(tabId) || !rule.condition.initiatorDomains?.includes(url.hostname)) return;
  await chrome.scripting.executeScript({ target: { tabId }, files: ['bridge.js'] });
}
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.status === 'complete') restoreBridge(tabId, tab).catch(() => {});
});
function validateDownload(data) {
  let url;
  try { url = new URL(data.url); } catch { throw Error('下载地址无效，请重新打开地图下载。'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.port && url.port !== '443' || !/(^|\.)(baidupcs\.com|pcs\.baidu\.com)$/i.test(url.hostname)) throw Error('只允许百度网盘 HTTPS 下载地址。');
  if (typeof data.name !== 'string' || !/\.vpk$/i.test(data.name) || data.name.length > 250 || !Number.isSafeInteger(data.size) || data.size < 4) throw Error('地图名称或大小无效。');
  const name = data.name.replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '-').replace(/^\.+/, '').slice(0, 190);
  if (!name || !/\.vpk$/i.test(name)) throw Error('地图文件名无效。');
  return { url: url.href, name, size: data.size };
}
async function readPrefix(response, limit) {
  const reader = response.body?.getReader();
  if (!reader) throw Error('百度没有返回文件内容。');
  const chunks = []; let size = 0;
  try {
    while (size < limit) { const part = await reader.read(); if (part.done) break; const chunk = part.value.subarray(0, limit - size); chunks.push(chunk); size += chunk.length; }
  } finally { await reader.cancel(); }
  const result = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}
async function checkFile(item) {
  const response = await fetch(item.url, { headers: { Range: 'bytes=0-31' }, redirect: 'error', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(45000) });
  const bytes = await readPrefix(response, response.ok ? 32 : 4096);
  if (![200, 206].includes(response.status)) {
    let code = '';
    try { code = JSON.parse(new TextDecoder().decode(bytes)).error_code || ''; } catch {}
    throw Error(`百度拒绝下载${code ? '（' + code + '）' : '（HTTP ' + response.status + '）'}。请刷新链接重试，或使用下方本机下载器命令。`);
  }
  const total = response.status === 206 ? Number(/^bytes 0-\d+\/(\d+)$/.exec(response.headers.get('content-range') || '')?.[1]) : Number(response.headers.get('content-length'));
  if (total !== item.size || bytes.length < 4 || bytes[0] !== 0x34 || bytes[1] !== 0x12 || bytes[2] !== 0xaa || bytes[3] !== 0x55) throw Error('百度返回的内容或大小与地图不符，已停止下载。');
}
async function handleMessage(data, sender) {
  if (!['status', 'download'].includes(data?.action) || !sender.tab || !Number.isInteger(sender.tab.id)) throw Error('请从已绑定的面板标签页发起下载。');
  let origin; try { origin = new URL(sender.url); } catch { throw Error('面板来源无效。'); }
  const rules = await chrome.declarativeNetRequest.getSessionRules();
  const bound = rules.find(rule => rule.id === 1);
  if (!['http:', 'https:'].includes(origin.protocol) || !bound?.condition.tabIds?.includes(sender.tab.id) || !bound.condition.initiatorDomains?.includes(origin.hostname)) throw Error('请点击扩展图标，重新绑定当前面板标签页。');
  if (data.action === 'status') return { ok: true, version: chrome.runtime.getManifest().version };
  if (pending.has(sender.tab.id)) throw Error('此标签页正在检查下载，请稍候。');
  const item = validateDownload(data); pending.add(sender.tab.id);
  try {
    await checkFile(item);
    return { ok: true, verified: true, version: chrome.runtime.getManifest().version };
  } finally { pending.delete(sender.tab.id); }
}
chrome.runtime.onMessage.addListener((data, sender, respond) => {
  handleMessage(data, sender).then(respond, error => respond({ ok: false, error: error.message?.startsWith('百度') || error.message?.startsWith('请') || error.message?.includes('无效') || error.message?.includes('标签页') || error.message?.includes('只允许') ? error.message : '无法连接百度下载节点，请刷新后重试，或使用本机下载器命令。' }));
  return true;
});
