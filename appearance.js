// L4D2-Control project identity: l4d2-control-bf312edc896c79baad5c | SPDX-License-Identifier: LicenseRef-L4D2-Control-NonCommercial-1.0
// Independent UI style, accent palette and time-based light/dark preferences.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) root.PanelAppearance = api.mount(root);
})(typeof window === 'undefined' ? null : window, function () {
  'use strict';
  const STYLES = Object.freeze({ coui: '经典 COUI', cupertino: 'Cupertino' });
  const COLORS = Object.freeze({ blue: '海湾蓝', violet: '鸢尾紫', teal: '潮汐青', green: '森林绿', rose: '玫瑰红', amber: '暖琥珀' });
  const MODES = Object.freeze({ auto: '跟随日出日落', light: '浅色', dark: '深色' });
  const KEYS = Object.freeze({ style: 'l4d2UiStyle', color: 'l4d2AccentColor', mode: 'deadAirTheme', sunrise: 'deadAirSunrise', sunset: 'deadAirSunset' });
  const own = (object, value) => typeof value === 'string' && Object.prototype.hasOwnProperty.call(object, value);
  const validTime = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  function normalize(value = {}) {
    return { style: own(STYLES, value.style) ? value.style : 'coui', color: own(COLORS, value.color) ? value.color : 'blue', mode: own(MODES, value.mode) ? value.mode : 'auto', sunrise: validTime(value.sunrise) ? value.sunrise : '07:00', sunset: validTime(value.sunset) ? value.sunset : '19:00' };
  }
  function isDaylight(settings, now = new Date()) {
    const s = normalize(settings), minutes = now.getHours() * 60 + now.getMinutes();
    const toMinutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
    const rise = toMinutes(s.sunrise), set = toMinutes(s.sunset);
    if (rise === set) return true;
    return rise < set ? minutes >= rise && minutes < set : minutes >= rise || minutes < set;
  }
  function resolve(settings, now = new Date()) {
    const s = normalize(settings);
    return { ...s, resolvedMode: s.mode === 'auto' ? (isDaylight(s, now) ? 'light' : 'dark') : s.mode };
  }
  function load(storage) {
    const data = {};
    for (const [key, name] of Object.entries(KEYS)) { try { data[key] = storage?.getItem(name); } catch (_) { /* Private/blocked storage retains usable defaults. */ } }
    return normalize(data);
  }
  function save(storage, settings) {
    const s = normalize(settings); let persisted = true;
    for (const [key, name] of Object.entries(KEYS)) { try { storage?.setItem(name, s[key]); if (!storage) persisted = false; } catch (_) { persisted = false; } }
    return persisted;
  }
  function mount(win) {
    const doc = win.document;
    let storage; try { storage = win.localStorage; } catch (_) { /* Session-only fallback. */ }
    let settings = load(storage), ready = false, dialog, opener;
    const each = (selector, fn) => doc.querySelectorAll(selector).forEach(fn);
    function apply(announce = false) {
      const current = resolve(settings);
      doc.documentElement.dataset.uiStyle = current.style;
      doc.documentElement.dataset.accentColor = current.color;
      doc.documentElement.dataset.colorMode = current.resolvedMode;
      if (!ready) return;
      doc.body.classList.toggle('light', current.resolvedMode === 'light');
      each('button[data-ui-style]', el => el.setAttribute('aria-pressed', String(el.dataset.uiStyle === settings.style)));
      each('button[data-accent-color]', el => el.setAttribute('aria-pressed', String(el.dataset.accentColor === settings.color)));
      each('[data-appearance-mode]', el => el.setAttribute('aria-pressed', String(el.dataset.appearanceMode === settings.mode)));
      each('[data-appearance-sunrise]', el => { el.value = settings.sunrise; });
      each('[data-appearance-sunset]', el => { el.value = settings.sunset; });
      each('[data-appearance-summary]', el => { el.textContent = `${STYLES[settings.style]} · ${COLORS[settings.color]} · ${MODES[settings.mode]}`; });
      if (announce) each('[data-appearance-status]', el => { el.textContent = '外观已应用'; });
      win.dispatchEvent(new win.CustomEvent('panelappearancechange', { detail: { ...settings } }));
    }
    function set(patch) {
      const next = { ...settings };
      for (const [key, value] of Object.entries(patch || {})) {
        if (key === 'style' && own(STYLES, value) || key === 'color' && own(COLORS, value) || key === 'mode' && own(MODES, value) || (key === 'sunrise' || key === 'sunset') && validTime(value)) next[key] = value;
      }
      settings = normalize(next); const persisted = save(storage, settings); apply(true);
      if (!persisted) each('[data-appearance-status]', el => { el.textContent = '外观已应用；浏览器未允许保存偏好，本次会话内有效。'; });
      return { ...settings };
    }
    function styleControls() {
      return Object.entries(STYLES).map(([id, label]) => `<button type="button" class="appearance-style" data-ui-style="${id}" aria-pressed="false"><span class="appearance-mini appearance-mini-${id}" aria-hidden="true"><i></i><span><b></b><b></b><b></b></span></span><strong>${label}</strong><small>${id === 'cupertino' ? '通透层次 · 分组卡片' : '柔和表面 · 圆润控件'}</small></button>`).join('');
    }
    function colorControls() {
      return Object.entries(COLORS).map(([id, label]) => `<button type="button" class="appearance-color" data-accent-color="${id}" aria-pressed="false"><span class="appearance-swatch swatch-${id}" aria-hidden="true"></span><span>${label}</span></button>`).join('');
    }
    function close() { if (dialog?.open) dialog.close(); }
    function init() {
      if (ready) return; ready = true;
      each('[data-appearance-styles]', el => { el.innerHTML = styleControls(); });
      each('[data-appearance-colors]', el => { el.innerHTML = colorControls(); });
      dialog = doc.createElement('dialog'); dialog.className = 'appearance-dialog'; dialog.setAttribute('aria-labelledby', 'appearanceDialogTitle');
      dialog.innerHTML = `<header class="appearance-dialog-header"><div><p>APPEARANCE</p><h2 id="appearanceDialogTitle">外观偏好</h2></div><button class="appearance-close" type="button" data-appearance-close aria-label="关闭外观偏好">×</button></header><div class="appearance-dialog-body"><section><h3>界面风格</h3><div class="appearance-styles" role="group" aria-label="界面风格">${styleControls()}</div></section><section><h3>强调配色</h3><div class="appearance-colors" role="group" aria-label="强调配色">${colorControls()}</div></section><section><h3>明暗模式</h3><div class="appearance-modes" role="group" aria-label="明暗模式">${Object.entries(MODES).map(([id,label])=>`<button type="button" data-appearance-mode="${id}" aria-pressed="false">${id==='auto'?'自动':label}</button>`).join('')}</div><div class="appearance-times"><label>日出 <input type="time" data-appearance-sunrise aria-label="外观日出时间"></label><label>日落 <input type="time" data-appearance-sunset aria-label="外观日落时间"></label></div></section><p class="appearance-hint">仅保存在当前浏览器，不影响服务器配置和其他用户。</p><p class="appearance-status" data-appearance-status role="status" aria-live="polite"></p></div>`;
      doc.body.append(dialog);
      dialog.addEventListener('close', () => { if (opener?.isConnected) opener.focus({ preventScroll: true }); });
      dialog.addEventListener('click', event => { if (event.target !== dialog) return; const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close(); });
      doc.addEventListener('click', event => {
        const button = event.target.closest('button'); if (!button || button.disabled) return;
        if (button.hasAttribute('data-appearance-open')) { opener = button; apply(); if (!dialog.open) { dialog.showModal(); dialog.querySelector('[data-appearance-close]').focus(); } }
        else if (button.hasAttribute('data-appearance-close')) close();
        else if (button.hasAttribute('data-ui-style')) set({ style: button.dataset.uiStyle });
        else if (button.hasAttribute('data-accent-color')) set({ color: button.dataset.accentColor });
        else if (button.hasAttribute('data-appearance-mode')) set({ mode: button.dataset.appearanceMode });
      });
      doc.addEventListener('change', event => { if (event.target.matches('[data-appearance-sunrise]')) set({ sunrise: event.target.value }); if (event.target.matches('[data-appearance-sunset]')) set({ sunset: event.target.value }); });
      win.addEventListener('storage', event => { if (event.key === null || Object.values(KEYS).includes(event.key)) { settings = load(storage); apply(); } });
      doc.addEventListener('visibilitychange', () => { if (!doc.hidden) apply(); });
      win.addEventListener('pageshow', () => apply());
      win.setInterval(() => { if (settings.mode === 'auto') apply(); }, 60000);
      apply();
    }
    apply();
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init, { once: true }); else init();
    return Object.freeze({ set, get: () => ({ ...settings }), resolve: () => resolve(settings) });
  }
  return Object.freeze({ STYLES, COLORS, MODES, KEYS, normalize, isDaylight, resolve, load, save, mount });
});
