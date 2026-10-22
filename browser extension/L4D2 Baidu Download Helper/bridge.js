(() => {
  if (globalThis.l4d2DownloadBridge) return;
  globalThis.l4d2DownloadBridge = true;
  chrome.runtime.onMessage.addListener((data, sender, respond) => {
    if (data?.action !== 'bridge-status' || sender.id !== chrome.runtime.id) return;
    try { chrome.runtime.sendMessage({ action: 'status' }, result => {
      const error = chrome.runtime.lastError;
      respond(error ? { ok: false, error: '扩展连接已失效，请重新绑定。' } : result);
    }); } catch { respond({ ok: false, error: '扩展连接已失效，请重新绑定。' }); }
    return true;
  });
  window.addEventListener('message', event => {
    const data = event.data;
    if (event.source !== window || event.origin !== location.origin || data?.source !== 'l4d2-control' || !['status', 'download'].includes(data.action) || typeof data.requestId !== 'string' || data.requestId.length > 100) return;
    const reply = result => window.postMessage({ source: 'l4d2-download-helper', requestId: data.requestId, ...result }, location.origin);
    try { chrome.runtime.sendMessage({ action: data.action, url: data.url, name: data.name, size: data.size }, result => {
      const error = chrome.runtime.lastError;
      reply(error ? { ok: false, error: '扩展已更新或失效，请刷新面板并重新绑定当前标签页。' } : result);
    }); } catch { reply({ ok: false, error: '扩展已更新或失效，请刷新面板并重新绑定当前标签页。' }); }
  });
})();
