(function () {
  const LIMIT = 300000;
  function createPanelMemory(storage, key) {
    let state = {};
    try { const text = storage?.getItem(key); const value = text && text.length <= LIMIT ? JSON.parse(text) : {}; if (value && typeof value === 'object' && !Array.isArray(value)) state = value; } catch {}
    return {
      get(name, fallback) { return Object.hasOwn(state, name) ? state[name] : fallback; },
      set(name, value) { if (['__proto__', 'constructor', 'prototype'].includes(name)) return; try { const next = { ...state, [name]:value }, text = JSON.stringify(next); if (text.length > LIMIT) return; state = next; storage?.setItem(key, text); } catch {} }
    };
  }
  if (typeof module !== 'undefined') module.exports = { createPanelMemory };
  if (typeof window === 'undefined') return;
  let storage; try { storage = sessionStorage; } catch {}
  const memory = createPanelMemory(storage, 'l4d2-panel-ui-v1-' + (document.body.dataset.panelRole || 'admin'));
  window.panelState = memory;
  const inputs = ['mapSearch', 'pluginSearch', 'playerSearch', 'workshopSearch', 'pluginStoreSearch', 'proxyNodeSearch'];
  for (const id of inputs) { const node = document.getElementById(id); if (!node) continue; const value = memory.get('input:' + id, ''); if (typeof value === 'string') node.value = value.slice(0, 250); node.addEventListener('input', () => memory.set('input:' + id, node.value.slice(0, 250))); }
  try { history.scrollRestoration = 'manual'; } catch {}
  let current = null, pending = null, deadline = 0, timer = null, saving = null;
  const sidebar = document.querySelector('.sidebar');
  const safe = n => typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(1000000, n)) : 0;
  function capture() {
    if (current && !pending) memory.set('scroll:' + current, { x: window.scrollX, y: window.scrollY });
    if (sidebar) memory.set('sidebarScroll', sidebar.scrollTop);
  }
  function stop() { pending = null; clearTimeout(timer); }
  function restore() {
    if (!pending) return;
    const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    window.scrollTo({ left: safe(pending.x), top: Math.min(safe(pending.y), max), behavior: 'instant' });
    if (Date.now() >= deadline) { stop(); capture(); return; }
    clearTimeout(timer); timer = setTimeout(restore, 150);
  }
  memory.activate = view => {
    if (current === view) return;
    capture(); stop(); current = view;
    const position = memory.get('scroll:' + view, { x: 0, y: 0 });
    pending = position && typeof position === 'object' ? { x: safe(position.x), y: safe(position.y) } : { x: 0, y: 0 };
    deadline = Date.now() + 6000;
    if (sidebar) sidebar.scrollTop = safe(memory.get('sidebarScroll', 0));
    requestAnimationFrame(restore);
  };
  const interacted = () => { stop(); };
  for (const event of ['wheel','touchstart','pointerdown','keydown']) window.addEventListener(event, interacted, { passive: true, capture: true });
  window.addEventListener('scroll', () => { clearTimeout(saving); saving = setTimeout(capture, 120); }, { passive: true });
  sidebar?.addEventListener('scroll', () => memory.set('sidebarScroll', sidebar.scrollTop), { passive: true });
  window.addEventListener('pagehide', capture); window.addEventListener('beforeunload', capture);
  document.addEventListener('visibilitychange', () => { if (document.hidden) capture(); });
  window.addEventListener('pageshow', event => { if (event.persisted && current) { const view = current; current = null; memory.activate(view); } });
})();
