const isGuest = document.body.dataset.panelRole === 'guest';
const panelCsrf = document.body.dataset.panelCsrf || '';
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const categories = { admin: '管理权限', vote: '地图与投票', players: '玩家与人数', gameplay: '玩法与物品', fix: '修复与优化', framework: '框架依赖' };
let campaigns = [], plugins = [], currentMap = '', selectedMap = '', mapFilter = savedMapFilter(), pluginFilter = 'all';
const expandedCampaigns = new Set();
let proxyState = { activeId: null, nodes: [] }, workshopPage = 1, workshopQuery = '', workshopResults = [];
let contentSection = 'maps', contentSource = 'steam-workshop', downloadJobs = [], searchVersion = 0, searchController = null, hasMoreResults = false, workshopSearched = false, downloadsBusy = false;
let pluginStorePage = 1, pluginStoreQuery = '', pluginStoreCategory = 'all', pluginStoreResults = [], pluginStoreTotal = 0, pluginStoreHasMore = false, pluginStoreBusy = false, pluginStoreLoaded = false, pluginStoreSyncing = false;
let pluginStoreSearchVersion = 0, pluginStoreSearchController = null, pluginInventoryLoaded = false;
let openListState = { enabled: false, url: '', upload: false, projectUrl: 'https://github.com/OpenListTeam/OpenList', mapsPath: '/l4d2-maps' };
const activities = [];
const corePlugins = new Set(['admin-flatfile', 'adminmenu', 'basecommands', 'basechat', 'l4d2 control players']);
const deletingDownloads = new Set();
let libraryBusy = false;
let gameAddress = '';
let diagnosticsBusy = false;
async function loadConnection() {
  try { const config = await api('/api/config'); gameAddress = typeof config.gameAddress === 'string' ? config.gameAddress.trim() : ''; if (config.openList) openListState = { ...openListState, ...config.openList }; } catch { gameAddress = ''; }
  $$('[data-game-address]').forEach(element => { element.textContent = gameAddress || '未配置连接地址'; });
  $('#copyAddress').disabled = !gameAddress;
  $('#copyServerConnection').disabled = !gameAddress;
  const field = $('#serverConnectCommand');
  field.value = gameAddress ? `connect ${gameAddress}` : '';
  field.placeholder = '未配置游戏连接地址';
  field.title = gameAddress ? `点击复制：connect ${gameAddress}` : '请配置游戏服务器地址与端口';
  field.style.height = 'auto'; field.style.overflowY = 'hidden';
  const height = Math.max(60, field.scrollHeight + 2);
  field.style.height = `${Math.min(120, height)}px`; field.style.overflowY = height > 120 ? 'auto' : 'hidden';
  $('#serverConnectionHint').textContent = gameAddress ? '点击文本或图标即可复制' : '请配置 L4D2_GAME_HOST 和游戏端口';
  if (typeof isGuest === 'undefined' || !isGuest) renderCloudBackup();
  renderMaps();
}
async function copyGameConnection() {
  if (!gameAddress) { toast('请先配置游戏连接地址'); return; }
  const command = `connect ${gameAddress}`;
  let copied = false;
  try { await navigator.clipboard.writeText(command); copied = true; } catch {}
  if (!copied) {
    const previous = document.activeElement, fallback = document.createElement('textarea');
    fallback.value = command; fallback.setAttribute('readonly', '');
    fallback.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
    document.body.append(fallback);
    try { fallback.focus(); fallback.select(); copied = document.execCommand('copy'); } catch {}
    finally { fallback.remove(); previous?.focus({ preventScroll: true }); }
  }
  if (copied) { $('#serverConnectionHint').textContent = '已复制，可粘贴到游戏控制台'; toast('连接命令已复制'); }
  else { const field = $('#serverConnectCommand'); field.focus(); field.select(); $('#serverConnectionHint').textContent = '自动复制受限，可选中文本手动复制'; toast('自动复制受限，请按 Ctrl+C 或长按文本复制'); }
}
function icons() { if (window.lucide) lucide.createIcons(); }
function toast(message) { $('#toast span').textContent = message; $('#toast').classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => $('#toast').classList.remove('show'), 3000); }
function chapterById(id) { for (const campaign of campaigns) { const chapter = campaign.chapters.find(item => item.id === id); if (chapter) return { campaign, chapter }; } return null; }
function allChapters() { return campaigns.flatMap(campaign => campaign.chapters); }
function renderCurrentMap(id = currentMap) {
  const selected = chapterById(id);
  $('#currentMap').textContent = selected?.chapter.name || id || '未知';
  $('#currentMapEnglish').textContent = id || 'UNKNOWN';
  $('#currentMapSubtitle').textContent = selected ? `${selected.campaign.name} · ${selected.campaign.english}` : '服务器当前章节';
}
const panelViews = { overview: '总览', gameplay: '游戏模式', maps: '地图管理', plugins: '插件管理', diagnostics: '服务器自检', workshop: '内容下载', proxy: '代理管理', players: '在线玩家', logs: '操作日志', settings: '服务器设置' };
function savedPanelView() {
  const hash = location.hash.slice(1);
  if (hash) return Object.hasOwn(panelViews, hash) ? hash : 'overview';
  try { const saved = sessionStorage.getItem('l4d2-panel-view'); return Object.hasOwn(panelViews, saved) ? saved : 'overview'; }
  catch { return 'overview'; }
}
function navigate(view) {
  if (!Object.hasOwn(panelViews, view) || typeof isGuest !== 'undefined' && isGuest && !['overview', 'maps', 'plugins'].includes(view)) view = 'overview';
  try { sessionStorage.setItem('l4d2-panel-view', view); } catch {}
  try { if (location.hash !== `#${view}`) history.replaceState(null, '', `#${view}`); } catch {}
  $$('.content').forEach(element => element.classList.toggle('hidden', element.id !== `${view}View`));
  $$('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  $('#pageTitle').textContent = panelViews[view];
  if (view === 'gameplay') loadGameplay();
  if (view === 'proxy') loadProxy();
  if (view === 'players') loadPlayers();
  if (view === 'workshop') loadDownloads();
  if (view === 'diagnostics') { loadCloudBackup(); startCloudPolling(); } else stopCloudPolling();
  $$('.nav-item').forEach(button => { if (button.dataset.view === view) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); });
  icons();
}
document.addEventListener('DOMContentLoaded', () => navigate(savedPanelView()), { once: true });
window.addEventListener('hashchange', () => navigate(savedPanelView()));
async function api(url, options) {
  if (isGuest && !['/api/config','/api/status','/api/maps','/api/plugins','/api/openlist/map-download-info','/api/auth/session','/api/auth/logout'].includes(new URL(url,location.origin).pathname)) throw new Error('普通账号没有此操作权限');
  const settings = { ...options, headers: { ...options?.headers } };
  if (!['GET', 'HEAD'].includes((settings.method || 'GET').toUpperCase())) { settings.headers['x-csrf-token'] = panelCsrf; if (!settings.headers['content-type']) settings.headers['content-type'] = 'application/json'; }
  const response = await fetch(url, settings);
  if (response.status === 401) { location.replace('/login'); throw new Error('登录已过期，请重新登录'); }
  const type = response.headers.get('content-type') || '';
  const data = type.includes('json') ? await response.json() : await response.text();
  if (!response.ok) throw new Error(data.error || `请求失败 (${response.status})`);
  return data;
}
const post = (url, payload) => api(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
function record(title) { activities.unshift({ title, meta: `服务器 · ${new Date().toLocaleTimeString()}` }); renderActivity(); }
function renderActivity() {
  $('#activityList').innerHTML = activities.length ? activities.slice(0, 5).map(item => `<div class="activity-item"><i data-lucide="activity"></i><div><b>${escapeHtml(item.title)}</b><span>${escapeHtml(item.meta)}</span></div></div>`).join('') : '<div class="activity-item"><div><b>本次会话暂无操作</b></div></div>';
  $('#logPanel').innerHTML = activities.length ? activities.map(item => `<div class="log-entry"><time>${escapeHtml(item.meta.split('· ')[1])}</time><div><strong>${escapeHtml(item.title)}</strong><span>本次会话</span></div></div>`).join('') : '<div class="activity-item"><b>本次会话暂无操作</b></div>';
  icons();
}
function renderQuick() {
  const preferred = ['c1', 'c2', 'c4', 'c5'];
  const items = preferred.map(id => campaigns.find(campaign => campaign.id === id)).filter(Boolean).slice(0, 4);
  $('#quickMaps').innerHTML = items.map((campaign, index) => `<button class="quick-map" data-map="${escapeHtml(campaign.chapters[0].id)}"><span class="map-index">${String(index + 1).padStart(2, '0')}</span><span class="quick-map-main"><b>${escapeHtml(campaign.name)}</b><span>${escapeHtml(campaign.english)}</span></span><span class="tag">${campaign.chapters.length} 章</span><i class="arrow" data-lucide="arrow-up-right"></i></button>`).join('') || '<div class="activity-item">正在读取地图…</div>';
  icons();
}
function savedMapFilter() {
  try { const saved = sessionStorage.getItem('l4d2-map-filter'); return ['custom', 'official', 'other'].includes(saved) ? saved : 'custom'; }
  catch { return 'custom'; }
}
function syncMapFilterButtons() {
  $$('#mapFilters button').forEach(button => { const active = button.dataset.filter === mapFilter; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
}
function setMapFilter(value) {
  mapFilter = ['custom', 'official', 'other'].includes(value) ? value : 'custom';
  try { sessionStorage.setItem('l4d2-map-filter', mapFilter); } catch {}
  syncMapFilterButtons(); renderMaps();
}
function filteredCampaigns() {
  const query = $('#mapSearch').value.trim().toLowerCase();
  return campaigns.filter(campaign => campaign.type === mapFilter && (!query || `${campaign.name} ${campaign.english} ${campaign.chapters.map(chapter => `${chapter.name} ${chapter.id}`).join(' ')}`.toLowerCase().includes(query)));
}
function renderMaps() {
  const query = $('#mapSearch').value.trim().toLowerCase();
  const visible = filteredCampaigns();
  const autoExpanded = new Set(query ? visible.filter(campaign => campaign.chapters.some(chapter => `${chapter.name} ${chapter.id}`.toLowerCase().includes(query))).map(campaign => campaign.id) : []);
  $('#mapRows').innerHTML = visible.map(campaign => {
    const expanded = expandedCampaigns.has(campaign.id) || autoExpanded.has(campaign.id);
    return `<article class="campaign-card ${expanded ? 'expanded' : ''}"><button class="campaign-head" data-campaign-toggle="${escapeHtml(campaign.id)}" aria-expanded="${expanded}"><span class="campaign-head-copy"><strong>${escapeHtml(campaign.name)}</strong><span>${escapeHtml(campaign.english)}</span></span><span class="campaign-head-meta"><span class="campaign-count">${campaign.chapters.length} 章 · ${campaign.type === 'official' ? '官方' : campaign.type === 'custom' ? '自定义' : '其他'}</span><i data-lucide="${expanded ? 'chevron-up' : 'chevron-down'}"></i></span></button><div class="chapter-list ${expanded ? '' : 'hidden'}">${campaign.chapters.map(chapter => `<button class="chapter-row ${chapter.id === selectedMap ? 'selected' : ''}" data-map="${escapeHtml(chapter.id)}"><span class="chapter-number">${String(chapter.number).padStart(2, '0')}</span><span class="chapter-title"><strong>${escapeHtml(chapter.name)}</strong><small>${escapeHtml(chapter.id)}</small></span><span class="chapter-state ${chapter.id === currentMap ? 'current' : ''}">${chapter.id === currentMap ? '运行中' : isGuest ? '查看章节' : '可切换'}</span><i data-lucide="chevron-right"></i></button>`).join('')}</div>${campaign.type === 'custom' && campaign.package ? `<div class="campaign-actions"><span title="${escapeHtml(campaign.package)}">${escapeHtml(campaign.package)}</span><div class="library-item-actions"><button class="secondary-button" data-direct-map="${escapeHtml(campaign.package)}" ${libraryBusy || !openListState.enabled ? 'disabled' : ''} title="${openListState.enabled ? '从已备份到 OpenList 的地图文件获取全新的百度直链' : '请先在服务器配置 OpenList'}"><i data-lucide="zap"></i>直连下载导出（推荐）</button><button class="secondary-button" data-export-map="${escapeHtml(campaign.package)}" ${libraryBusy ? 'disabled' : ''}><i data-lucide="download"></i>服务器下载导出</button><button class="danger-button" data-delete-map="${escapeHtml(campaign.package)}" ${libraryBusy ? 'disabled' : ''}><i data-lucide="trash-2"></i>删除地图包</button></div></div>` : ''}</article>`;
  }).join('') || '<div class="empty-state"><p>没有匹配的战役或章节</p></div>';
  renderDetail(); icons();
}
function renderDetail() {
  const selected = chapterById(selectedMap) || chapterById(currentMap) || (campaigns[0] && { campaign: campaigns[0], chapter: campaigns[0].chapters[0] });
  if (!selected) { $('#mapDetail').innerHTML = '<h2>暂无可用地图</h2><p>请检查游戏目录与附加包。</p>'; return; }
  const { campaign, chapter } = selected; selectedMap = chapter.id;
  $('#mapDetail').innerHTML = `<span class="detail-kicker">已选章节 · ${String(chapter.number).padStart(2, '0')}</span><h2>${escapeHtml(campaign.name)}</h2><p class="detail-english">${escapeHtml(campaign.english)}</p><h3>${escapeHtml(chapter.name)}</h3><p>${escapeHtml(chapter.id)}</p><div class="detail-stats"><div><span>类型</span><b>${campaign.type === 'official' ? '官方战役' : '自定义战役'}</b></div><div><span>状态</span><b class="green-text">${chapter.id === currentMap ? '运行中' : isGuest ? '查看章节' : '可切换'}</b></div></div><button class="primary-button detail-button" id="changeMap"><i data-lucide="play"></i>${chapter.id === currentMap ? '重载当前章节' : '切换到此章节'}</button>`;
  $('#changeMap').onclick = () => changeMap(chapter.id); icons();
}
function selectMap(id) { selectedMap = id; const match = chapterById(id); if (match) { expandedCampaigns.add(match.campaign.id); if (match.campaign.type !== mapFilter) setMapFilter(match.campaign.type); } navigate('maps'); renderMaps(); }
async function changeMap(id) {
  const button = $('#changeMap'); if (button) button.disabled = true;
  try { await post('/api/map', { map: id }); currentMap = id; selectedMap = id; renderCurrentMap(id); renderMaps(); record(`切换地图至 ${id}`); toast('切图命令已发送到游戏服务器'); }
  catch (error) { toast(`切图失败：${error.message}`); }
  finally { if (button?.isConnected) button.disabled = false; }
}
async function loadMaps() {
  try {
    const data = await api('/api/maps'); campaigns = data.campaigns;
    $('#navMapCount').textContent = campaigns.length;
    $('#officialMapCount').textContent = campaigns.filter(item => item.type === 'official').length;
    $('#customMapCount').textContent = campaigns.filter(item => item.type === 'custom').length;
    $('#otherMapCount').textContent = campaigns.filter(item => item.type === 'other').reduce((sum, item) => sum + item.chapters.length, 0);
    $('#mapCoverage').textContent = `已识别 ${campaigns.length} 个地图分组、${data.chapterCount} 个${isGuest ? '可查看' : '可切换'}地图；附加包 ${data.addonCount} 个。`;
    renderMaps(); renderQuick();
  } catch (error) { $('#mapCoverage').textContent = `读取地图失败：${error.message}`; $('#mapRows').innerHTML = '<div class="empty-state"><p>无法读取服务器地图</p></div>'; }
}
let cloudLoading = false, cloudError = '', cloudTimer = null, cloudPolling = false, cloudActionBusy = false;
let cloudBackup = { enabled: false, running: false, completed: 0, total: 0, results: [] };
function cloudSize(value) { if (!Number.isFinite(Number(value))) return '—'; const n = Number(value); if (n < 1024) return `${n} B`; const units = ['KiB', 'MiB', 'GiB', 'TiB']; const rank = Math.min(3, Math.floor(Math.log(n) / Math.log(1024)) - 1); return `${(n / 1024 ** (rank + 1)).toFixed(rank > 0 ? 2 : 0)} ${units[rank]}`; }
function renderCloudBackup() {
  const status = $('#cloudBackupStatus');
  if (status) {
    status.className = `openlist-status ${cloudError ? 'error' : openListState.enabled ? 'ready' : ''}`;
    status.innerHTML = cloudError ? `<strong>备份状态读取失败</strong><span>${escapeHtml(cloudError)}；可以刷新重试。</span>` : openListState.enabled ? openListState.upload ? `<strong>已连接专用 OpenList 目录</strong><span>${escapeHtml(openListState.mapsPath)} · 每 5 分钟检查一次新增或变化的 VPK。</span>` : '<strong>已连接，但未启用上传</strong><span>服务器环境变量 OPENLIST_UPLOAD 未开启，备份功能当前为只读。</span>' : '<strong>尚未配置地图备份</strong><span>请在服务器配置 OpenList 地址和专用服务账号；服务凭据不会发送到浏览器。</span>';
  }
  const b = cloudBackup, toggle = $('#toggleCloudBackup');
  $('#backupCloudMaps').disabled = !openListState.enabled || !openListState.upload || b.running || cloudActionBusy;
  $('#refreshCloudBackup').disabled = cloudLoading;
  toggle.setAttribute('aria-checked', String(b.enabled)); toggle.textContent = b.enabled ? '自动备份已开启' : '开启自动备份'; toggle.classList.toggle('cloud-auto-on', b.enabled); toggle.disabled = !openListState.enabled || !openListState.upload || cloudActionBusy;
  $('#stopCloudBackup').classList.toggle('hidden', !b.running); $('#stopCloudBackup').disabled = cloudActionBusy;
  const phases = { idle: '等待备份', scanning: '正在扫描服务器地图', uploading: '正在备份到网盘', completed: '本轮备份完成', partial: '本轮部分文件需要重试', failed: '备份未完成', stopped: '本轮备份已停止' };
  const stages = { checking: '检查文件指纹', uploading: '正在传输', confirming: '网盘正在确认保存', completed: '保存已确认' };
  const progress = b.current;
  const last = b.lastRun?.finishedAt ? `最近一轮：${new Date(b.lastRun.finishedAt).toLocaleString()}` : '尚未完成首轮备份';
  const next = b.enabled ? b.nextRun ? `下次检查：${new Date(b.nextRun).toLocaleTimeString()}` : '本轮完成后继续定时检查' : '自动备份已关闭';
  $('#cloudBackupProgress').innerHTML = `<div class="cloud-progress-heading"><strong>${phases[b.phase] || '等待备份'}</strong><span>${b.completed || 0} / ${b.total || 0} 个文件</span></div>${b.running && progress ? `<div class="cloud-current"><b>${escapeHtml(progress.name)}</b><span>${stages[progress.stage] || '准备中'} · ${cloudSize(progress.transferred)} / ${cloudSize(progress.size)}</span></div><progress max="100" value="${progress.percentage || 0}" aria-label="当前文件备份进度"></progress>` : ''}<p>本轮上传 ${b.uploaded || 0} · 跳过 ${b.skipped || 0} · 失败 ${b.failed || 0}</p>${b.error ? `<p class="cloud-error">${escapeHtml(b.error)}</p>` : ''}<small>${last} · ${next}</small>`;
}
async function loadCloudBackup() {
  if (cloudLoading) return;
  cloudLoading = true; renderCloudBackup();
  try { openListState = { ...openListState, ...(await api('/api/openlist')) }; cloudBackup = await api('/api/openlist/backup'); cloudError = ''; }
  catch (error) { cloudError = error.message; }
  finally { cloudLoading = false; renderCloudBackup(); renderMaps(); }
}
function stopCloudPolling() { clearInterval(cloudTimer); cloudTimer = null; }
function startCloudPolling() {
  stopCloudPolling();
  cloudTimer = setInterval(async () => {
    if (cloudPolling || document.hidden) return;
    cloudPolling = true;
    try { cloudBackup = await api('/api/openlist/backup'); cloudError = ''; renderCloudBackup(); }
    catch (error) { cloudError = error.message; $('#cloudBackupProgress').textContent = `读取备份进度失败：${error.message}`; renderCloudBackup(); }
    finally { cloudPolling = false; }
  }, 2000);
}
async function cloudAction(route, payload = {}) {
  if (cloudActionBusy) return;
  cloudActionBusy = true; cloudError = ''; renderCloudBackup();
  try { cloudBackup = await post(route, payload); renderCloudBackup(); startCloudPolling(); }
  catch (error) { cloudError = error.message; toast(error.message); }
  finally { cloudActionBusy = false; renderCloudBackup(); }
}

function renderPlugins() {
  const query = $('#pluginSearch').value.trim().toLowerCase();
  const filtered = plugins.filter(item => (pluginFilter === 'all' || item.type === pluginFilter) && (!query || `${item.name} ${item.id}`.toLowerCase().includes(query)));
  $('#pluginGrid').innerHTML = filtered.map(item => `<article class="plugin-card"><div class="plugin-card-top"><div class="plugin-names"><h3>${escapeHtml(item.name)}</h3><span title="${escapeHtml(item.id)}.smx">${escapeHtml(item.id)}.smx</span></div><button class="switch ${item.enabled ? 'on' : ''}" data-plugin="${escapeHtml(item.id)}" role="switch" aria-checked="${item.enabled}" title="${item.enabled ? '停用' : '启用'} ${escapeHtml(item.name)}" aria-label="${item.enabled ? '停用' : '启用'} ${escapeHtml(item.name)}"></button></div><div class="plugin-meta"><span>${escapeHtml(item.category)}</span><span>${item.enabled ? '已启用' : '已停用'}</span></div><div class="plugin-actions"><button class="secondary-button" data-export-plugin="${escapeHtml(item.id)}" ${libraryBusy ? 'disabled' : ''}><i data-lucide="download"></i>导出插件</button>${corePlugins.has(item.id.toLowerCase()) ? '<span class="protected-note"><i data-lucide="shield-check"></i>核心管理插件</span>' : `<button class="danger-button" data-delete-plugin="${escapeHtml(item.id)}" ${libraryBusy ? 'disabled' : ''}><i data-lucide="trash-2"></i>删除插件</button>`}</div></article>`).join('') || '<div class="empty-state"><p>没有匹配的插件</p></div>';
  icons();
}
async function loadPlugins() {
  try { const data = await api('/api/plugins'); plugins = data.plugins; pluginInventoryLoaded = true; $('#navPluginCount').textContent = plugins.length; $('#overviewPluginCount').textContent = plugins.length; $('#pluginTotal').textContent = plugins.length; $('#pluginEnabled').textContent = plugins.filter(item => item.enabled).length; renderPlugins(); if (pluginStoreLoaded) renderPluginStoreResults(); }
  catch (error) { $('#pluginGrid').innerHTML = `<div class="empty-state"><p>读取插件失败：${escapeHtml(error.message)}</p></div>`; }
}
function renderProxy() {
  $('#proxyCount').textContent = `${proxyState.nodes.length} 个节点`;
  $('#proxyStatus').textContent = proxyState.nodes.length ? `${proxyState.engine === 'mihomo' ? 'Mihomo · ' : ''}当前节点：${proxyState.nodes.find(node => node.id === proxyState.activeId)?.name || '未选择'}` : '尚未导入节点';
  const mihomo = proxyState.engine === 'mihomo';
  $('#openProxyDashboard').classList.toggle('hidden', !mihomo);
  $('#proxyDashboardHelp').classList.toggle('hidden', !mihomo);
  $('#proxyControllerAddress').value = `${location.origin}/mihomo`;
  $('#proxyImportHelp').textContent = mihomo ? '支持 HTTPS 订阅、Clash YAML、VLESS / VMess / SS / Trojan 等常见节点。订阅地址仅保存于服务器。' : '当前为 Xray 内核，支持 VLESS TCP 链接。';
  const subscriptions = proxyState.subscriptions || [];
  $('#proxySubscriptions').classList.toggle('hidden', !subscriptions.length);
  $('#subscriptionList').innerHTML = subscriptions.map(item => `<div class="proxy-subscription"><strong>${escapeHtml(item.label)}</strong><span>更新于 ${escapeHtml(new Date(item.updatedAt).toLocaleString())}</span></div>`).join('');
  const query = $('#proxyNodeSearch').value.trim().toLowerCase();
  const visible = proxyState.nodes.filter(node => !query || `${node.name} ${node.host} ${node.type || ''}`.toLowerCase().includes(query));
  $('#proxyList').innerHTML = visible.map(node => `<article class="proxy-node"><div class="proxy-node-info"><h3>${escapeHtml(node.name)}</h3><span>${escapeHtml(node.type || 'vless')} · ${escapeHtml(node.host)}:${node.port}${node.subscription ? ' · 订阅' : ''}</span></div><span class="proxy-badge ${node.id === proxyState.activeId ? 'active' : ''}">${node.id === proxyState.activeId ? '当前使用' : '备用'}</span><div class="proxy-node-actions">${node.id === proxyState.activeId ? '' : `<button class="secondary-button" data-proxy-switch="${escapeHtml(node.id)}"><i data-lucide="refresh-cw"></i>切换</button><button class="icon-button" data-proxy-delete="${escapeHtml(node.id)}" title="删除节点" aria-label="删除 ${escapeHtml(node.name)}"><i data-lucide="trash-2"></i></button>`}</div></article>`).join('') || '<div class="workshop-empty"><p>没有匹配的节点</p></div>';
  icons();
}
async function loadProxy() {
  try { proxyState = await api('/api/proxy/nodes'); renderProxy(); }
  catch (error) { $('#proxyStatus').textContent = `节点不可用：${error.message}`; $('#proxyList').innerHTML = ''; }
}
const workshopItems = [
  ['战役地图', 'campaign map', '查找合作战役与完整地图包。', 'MAPS'],
  ['生存地图', 'survival map', '查找自定义生存场景。', 'SURVIVAL'],
  ['玩家模型', 'survivor model', '查找幸存者角色与模型。', 'MODELS'],
  ['武器外观', 'weapon skin', '查找武器替换与外观。', 'WEAPONS'],
  ['音效音乐', 'sound music', '查找音乐与音效。', 'AUDIO']
];
function renderWorkshop() {
  const query = $('#workshopSearch').value.trim().toLowerCase();
  $('#workshopGrid').innerHTML = workshopItems.filter(item => !query || item.join(' ').toLowerCase().includes(query)).map(([name, search, description, tag]) => `<article class="workshop-card"><div class="workshop-cover"><span>${tag}</span></div><div class="workshop-card-body"><h3>${name}</h3><p>${description}</p><div class="workshop-card-footer"><span>${contentSource === 'gamemaps' ? 'GameMaps' : '创意工坊'}</span><button data-workshop="${search}"><i data-lucide="search"></i>搜索</button></div></div></article>`).join(''); icons();
}
function renderWorkshopResults() {
  $('#workshopPage').textContent = `第 ${workshopPage} 页`;
  $('#workshopPrev').disabled = workshopPage <= 1;
  $('#workshopNext').disabled = !hasMoreResults;
  $('#workshopResultMeta').textContent = !workshopSearched ? '尚未搜索' : workshopResults.length ? `本页 ${workshopResults.length} 个项目` : '没有匹配项目';
  $('#workshopResults').innerHTML = workshopResults.map(item => {
    const job = [...downloadJobs].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).find(job => job.source === contentSource && job.itemId === item.id);
    const installed = job?.status === 'completed', pending = job && !['completed', 'failed', 'cancelled'].includes(job.status);
    return `<article class="workshop-result">${item.image ? `<img src="${escapeHtml(item.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<div class="result-placeholder"><i data-lucide="image"></i></div>'}<div class="workshop-result-body"><h3>${escapeHtml(item.title)}</h3><span>${contentSource === 'gamemaps' ? 'GameMaps' : 'Workshop'} ID · ${escapeHtml(item.id)}</span><div><button class="primary-button workshop-install ${installed ? 'is-installed' : ''}" data-install-workshop="${escapeHtml(item.id)}" ${installed || pending ? 'disabled' : ''}><i data-lucide="${installed ? 'check' : pending ? 'loader-circle' : 'download'}"></i>${installed ? '本次已安装' : pending ? job.phase : '安装到服务器'}</button><button class="text-button" data-copy-id="${escapeHtml(item.id)}"><i data-lucide="copy"></i>复制 ID</button></div></div></article>`;
  }).join('') || `<div class="workshop-empty"><p>${workshopSearched ? '没有匹配项目，请更换关键词' : '输入关键词后点击“搜索”，切换来源不会自动搜索。'}</p></div>`; icons();
}
function renderPluginStoreResults() {
  $('#pluginStorePage').textContent = `第 ${pluginStorePage} 页`;
  $('#pluginStorePrev').disabled = pluginStoreBusy || pluginStorePage <= 1;
  $('#pluginStoreNext').disabled = pluginStoreBusy || !pluginStoreHasMore;
  $('#pluginStoreResultMeta').textContent = pluginStoreBusy ? '正在读取仓库目录…' : pluginStoreLoaded ? `共 ${pluginStoreTotal} 个插件 · 当前 ${pluginStoreResults.length} 个` : '尚未载入';
  $('#pluginStoreResults').innerHTML = pluginStoreBusy && !pluginStoreResults.length ? '<div class="workshop-empty"><i data-lucide="loader-circle"></i><p>正在同步插件目录</p></div>' : pluginStoreResults.map(item => {
    const job = [...downloadJobs].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).find(job => job.source === 'plugin-store' && job.itemId === item.id);
    const targetId = item.fileName.replace(/\.smx$/i, '').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 118) || `plugin-${item.id.slice(0, 12)}`;
    const existing = plugins.find(plugin => plugin.id.toLowerCase() === targetId.toLowerCase());
    const installed = Boolean(existing) || (!pluginInventoryLoaded && job?.status === 'completed'), pending = job && !['completed', 'failed', 'cancelled'].includes(job.status);
    const label = existing ? existing.enabled ? '服务器已启用' : '已导入 · 停用' : installed ? '已导入 · 待核验' : pending ? escapeHtml(job.phase) : '下载并导入';
    return `<article class="plugin-store-card"><div class="plugin-store-card-icon"><i data-lucide="puzzle"></i></div><div class="plugin-store-card-body"><div class="plugin-store-card-heading"><h3>${escapeHtml(item.title)}</h3><span class="plugin-store-badge">${escapeHtml(item.category)}</span></div><span class="plugin-store-file" title="${escapeHtml(item.fileName)}">${escapeHtml(item.fileName)}</span><small>${bytesLabel(item.size)} · ${escapeHtml(item.id.slice(0, 12))}</small><div class="plugin-store-card-actions"><button class="primary-button workshop-install ${installed ? 'is-installed' : ''}" data-install-plugin-store="${escapeHtml(item.id)}" ${installed || pending || pluginStoreSyncing ? 'disabled' : ''}><i data-lucide="${installed ? 'check' : pending ? 'loader-circle' : 'download'}"></i>${label}</button><a class="text-button" href="${escapeHtml(item.repoUrl)}" target="_blank" rel="noopener noreferrer"><i data-lucide="external-link"></i>查看仓库说明</a></div></div></article>`;
  }).join('') || `<div class="workshop-empty"><i data-lucide="search"></i><p>${pluginStoreLoaded ? '没有找到符合条件的插件，换个关键词或分类试试。' : '插件目录尚未同步。点击右上角刷新重试。'}</p></div>`;
  icons();
}
async function searchPluginStore(query = $('#pluginStoreSearch').value.trim(), reset = true) {
  pluginStoreSearchController?.abort();
  pluginStoreSearchController = new AbortController();
  const version = ++pluginStoreSearchVersion;
  if (reset) pluginStorePage = 1;
  pluginStoreQuery = query; $('#pluginStoreSearch').value = query;
  pluginStoreBusy = true; pluginStoreResults = []; renderPluginStoreResults();
  try {
    const data = await api(`/api/plugin-store?query=${encodeURIComponent(query)}&category=${encodeURIComponent(pluginStoreCategory)}&page=${pluginStorePage}`, { signal: pluginStoreSearchController.signal });
    if (version !== pluginStoreSearchVersion) return;
    pluginStoreResults = data.items || []; pluginStoreTotal = Number(data.total) || 0; pluginStoreHasMore = Boolean(data.hasMore); pluginStoreLoaded = !data.unavailable;
    const state = $('#pluginStoreStatus');
    state.classList.toggle('error', Boolean(data.unavailable || data.error));
    const last = data.lastSyncAt ? new Date(data.lastSyncAt).toLocaleString() : '尚无成功同步记录';
    state.querySelector('span').textContent = data.unavailable ? `${data.error || '暂时无法连接插件仓库'} · 可尝试刷新` : `${data.error ? `同步异常，正在使用缓存 · ${data.error} · ` : ''}${pluginStoreTotal} 个插件 · 最近同步 ${last} · 每 ${Math.round((data.refreshIntervalSeconds || 21600) / 3600)} 小时更新`;
  } catch (error) {
    if (version !== pluginStoreSearchVersion || error.name === 'AbortError') return;
    pluginStoreResults = []; pluginStoreTotal = 0; pluginStoreHasMore = false;
    $('#pluginStoreStatus').classList.add('error'); $('#pluginStoreStatus').querySelector('span').textContent = `读取插件目录失败：${error.message}`;
  } finally { if (version === pluginStoreSearchVersion) { pluginStoreBusy = false; renderPluginStoreResults(); } }
}
async function refreshPluginStore() {
  if (pluginStoreSyncing) return;
  pluginStoreSyncing = true;
  renderPluginStoreResults();
  const button = $('#refreshPluginStore'); button.disabled = true; button.setAttribute('aria-busy', 'true');
  $('#pluginStoreStatus').querySelector('span').textContent = '正在从 GitHub 同步插件文件到服务器缓存…';
  try {
    const result = await post('/api/plugin-store/sync', {});
    const state = $('#pluginStoreStatus'); state.classList.toggle('error', Boolean(result.error));
    state.querySelector('span').textContent = result.error ? `目录刷新失败，保留上次缓存：${result.error}` : `已同步 ${result.count} 个插件到服务器缓存 · ${new Date(result.lastSyncAt).toLocaleString()} · 每 6 小时自动更新`;
    pluginStoreLoaded = !result.error || result.count > 0;
    await searchPluginStore(pluginStoreQuery, false);
  } catch (error) { $('#pluginStoreStatus').classList.add('error'); $('#pluginStoreStatus').querySelector('span').textContent = `同步失败：${error.message}`; }
  finally { pluginStoreSyncing = false; button.disabled = false; button.removeAttribute('aria-busy'); renderPluginStoreResults(); }
}
async function searchWorkshop(query = $('#workshopSearch').value.trim(), reset = true) {
  searchController?.abort(); searchController = new AbortController(); const version = ++searchVersion;
  if (reset) workshopPage = 1; workshopSearched = true; workshopQuery = query; workshopResults = []; hasMoreResults = false; $('#workshopSearch').value = query; const button = $('#searchWorkshop'); button.disabled = true; $('#workshopPrev').disabled = true; $('#workshopNext').disabled = true; $('#workshopResultMeta').textContent = `正在搜索 ${contentSource === 'gamemaps' ? 'GameMaps' : 'Steam'}…`; $('#workshopResults').innerHTML = '<div class="workshop-empty"><i data-lucide="loader-circle"></i><p>正在读取项目</p></div>'; icons();
  try { const data = await api(`/api/${contentSource === 'gamemaps' ? 'gamemaps' : 'workshop'}?query=${encodeURIComponent(query)}&page=${workshopPage}`, { signal: searchController.signal }); if (version !== searchVersion) return; workshopResults = data.items || []; hasMoreResults = data.hasMore ?? workshopResults.length >= 12; renderWorkshopResults(); if (data.unavailable) { $('#workshopResultMeta').textContent = data.errorCode === 'GAMEMAPS_CHALLENGE' ? '站点验证拦截' : '来源暂时不可用'; $('#workshopResults').innerHTML = `<div class="workshop-empty"><i data-lucide="cloud-off"></i><p>${escapeHtml(contentSource === 'gamemaps' ? data.error : '服务器暂时无法连接 Steam，请检查创意工坊代理节点')}</p><div class="source-recovery-actions"><button class="secondary-button" data-open-proxy>管理代理节点</button>${contentSource === 'gamemaps' ? '<button class="primary-button" data-search-steam>在 Steam 搜索相同关键词</button>' : ''}</div></div>`; } }
  catch (error) { if (version !== searchVersion || error.name === 'AbortError') return; $('#workshopResultMeta').textContent = '搜索失败'; $('#workshopResults').innerHTML = `<div class="workshop-empty"><p>${escapeHtml(error.message)}</p></div>`; }
  finally { if (version === searchVersion) button.disabled = false; icons(); }
}
const bytesLabel = bytes => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GiB` : bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MiB` : `${(bytes / 1024).toFixed(1)} KiB`;
function renderDownloads() {
  const expandedErrors = new Set($$('#downloadList .download-error-details[open]').map(element => element.dataset.job));
  const historyOpen = !!$('#downloadHistory')?.open;
  const isDone = job => ['completed', 'failed', 'cancelled'].includes(job.status);
  const activeSource = contentSection === 'plugins' ? 'plugin-store' : contentSource;
  const sourceJobs = downloadJobs.filter(job => job.source === activeSource).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const activeJobs = sourceJobs.filter(job => !isDone(job)), history = sourceJobs.filter(isDone);
  const otherActive = downloadJobs.filter(job => job.source !== activeSource && !isDone(job)).length;
  $('#downloadCount').textContent = `${activeSource === 'plugin-store' ? '插件商店' : contentSource === 'gamemaps' ? 'GameMaps' : 'Steam'} · ${activeJobs.length} 个进行中${otherActive ? ` · 另一板块 ${otherActive} 个进行中` : ''}`;
  const renderJob = job => {
    const done = ['completed', 'failed', 'cancelled'].includes(job.status), completed = job.status === 'completed';
    const mismatch = job.errorCode === 'STEAM_IDENTITY_MISMATCH' || /项目名称与 Steam 官方编号不一致/.test(job.error || '');
    const percentage = completed ? 100 : job.totalBytes && job.status === 'downloading' ? Math.min(100, Math.floor(job.receivedBytes / job.totalBytes * 100)) : null;
    const value = percentage !== null ? ` value="${percentage}"` : done ? ' value="0"' : '';
    const error = String(job.error || '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').trim();
    const detail = completed ? job.source === 'plugin-store' ? '已导入至停用目录 · 可在“插件管理”检查后启用' : `${job.alreadyInstalled ? '文件已存在' : '已安装'} · 重启游戏服务器后生效` : /No Connection/i.test(error) ? 'Steam 下载连接失败，请检查代理节点后重试' : error.length > 180 ? error.slice(0, 180) + '…' : error || `${bytesLabel(job.receivedBytes)}${job.totalBytes ? ` / ${bytesLabel(job.totalBytes)}` : ' · 总大小未知'}${percentage !== null ? ` · ${percentage}%` : ''}`;
    const errorDetails = error && error !== detail ? `<details class="download-error-details" data-job="${escapeHtml(job.id)}"${expandedErrors.has(job.id) ? ' open' : ''}><summary>错误详情</summary><p>${escapeHtml(error)}</p></details>` : '';
    const progress = `<div class="download-progress${percentage === null && !done ? ' indeterminate' : ''}"><progress max="100"${value} aria-label="${escapeHtml(job.title)}：${escapeHtml(job.phase)}"></progress></div>`;
    const action = !done ? `<button class="icon-button" data-cancel-download="${job.id}" title="取消下载" aria-label="取消 ${escapeHtml(job.title)}"><i data-lucide="x"></i></button>` : mismatch ? `<button class="secondary-button" data-search-download="${job.id}">重新搜索</button>` : !completed && job.retryable !== false ? `<button class="icon-button" data-retry-download="${job.id}" title="重试下载" aria-label="重试 ${escapeHtml(job.title)}"><i data-lucide="rotate-cw"></i></button>` : '';
    const dismiss = `<button class="danger-button" data-delete-download="${escapeHtml(job.id)}" title="${done ? '删除任务记录，保留已安装文件' : '终止下载并删除任务'}" ${deletingDownloads.has(job.id) ? 'disabled' : ''}><i data-lucide="trash-2"></i>${deletingDownloads.has(job.id) ? '删除中…' : '删除任务'}</button>`;
    const sourceName = job.source === 'plugin-store' ? '插件商店' : job.source === 'gamemaps' ? 'GameMaps' : 'Steam Workshop';
    return `<article class="download-task ${job.status}"><div class="download-task-heading"><div><h3>${escapeHtml(job.title)}</h3><span>${sourceName} · ${escapeHtml(job.itemId)}</span></div><strong>${mismatch ? '需要重新搜索' : escapeHtml(job.phase)}</strong>${action}${dismiss}</div>${done && !completed ? '' : progress}<p>${escapeHtml(detail)}</p>${errorDetails}</article>`;
  };
  $('#downloadList').innerHTML = (activeJobs.map(renderJob).join('') || '<div class="download-empty">当前来源没有进行中的下载</div>') + (history.length ? `<details id="downloadHistory" class="download-history"${historyOpen ? ' open' : ''}><summary>历史记录 · ${history.length} 条（${history.filter(job => job.status === 'failed').length} 条失败）</summary><div class="download-history-list">${history.map(renderJob).join('')}</div></details>` : ''); icons();
}
function selectContentSource(source, query = $('#workshopSearch').value.trim()) {
  searchController?.abort(); searchController = null; searchVersion++;
  workshopPage = 1; workshopQuery = query; workshopSearched = false;
  $('#searchWorkshop').disabled = false;
  contentSource = source;
  $$('#contentSources button').forEach(button => { const active = button.dataset.source === source; button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active)); });
  $('#contentSourceName').textContent = source === 'gamemaps' ? 'GameMaps · Left 4 Dead 2' : 'Steam Workshop · Left 4 Dead 2';
  $('#workshopSearch').placeholder = source === 'gamemaps' ? '关键词、GameMaps 编号或详情链接…' : '地图、模组或关键词…';
  $('#gameMapsHelp').classList.toggle('hidden', source !== 'gamemaps');
  $('#contentConnection').textContent = '内容下载专用代理';
  workshopResults = []; hasMoreResults = false;
  $('#workshopSearch').value = query;
  renderDownloads(); renderWorkshopResults(); renderWorkshop();

}
function selectContentSection(section) {
  contentSection = section;
  $$('#contentSections button').forEach(button => { const active = button.dataset.contentSection === section; button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active)); });
  $('#mapDownloadSection').classList.toggle('hidden', section !== 'maps');
  $('#pluginStoreSection').classList.toggle('hidden', section !== 'plugins');
  $('#openWorkshop').classList.toggle('hidden', section !== 'maps');
  $('#downloadHeading').childNodes[0].textContent = section === 'plugins' ? '插件下载任务 ' : '地图下载任务 ';
  renderDownloads();
  if (section === 'plugins' && !pluginStoreLoaded && !pluginStoreBusy) searchPluginStore();

}
async function loadDownloads() {
  if (isGuest || downloadsBusy) return; downloadsBusy = true;
  try {
    const data = await api('/api/downloads');
    const previous = new Map(downloadJobs.map(job => [job.id, job.status]));
    downloadJobs = data.jobs || []; $('#downloadConnection').textContent = '';
    renderDownloads();
    for (const job of downloadJobs) if (previous.has(job.id) && previous.get(job.id) !== job.status && job.status === 'completed') { record(job.source === 'plugin-store' ? `导入插件 ${job.title}` : `安装 ${job.source === 'gamemaps' ? 'GameMaps' : '创意工坊'}项目 ${job.itemId}`); if (job.source === 'plugin-store') { toast('插件已导入到停用目录'); loadPlugins(); renderPluginStoreResults(); } else { toast('安装完成，重启游戏服务器后生效'); loadMaps(); } }
    if (workshopResults.length) renderWorkshopResults();
    if (pluginStoreLoaded) renderPluginStoreResults();
  } catch (error) { $('#downloadConnection').textContent = `任务状态暂时无法同步：${error.message}`; }
  finally { downloadsBusy = false; }
}
async function startDownload(source, id, title) {
  const endpoint = source === 'plugin-store' ? '/api/plugin-store/install' : `/api/${source === 'gamemaps' ? 'gamemaps' : 'workshop'}/install`;
  const data = await post(endpoint, { id, title });
  if (!downloadJobs.some(job => job.id === data.job.id)) downloadJobs.push(data.job);
  renderDownloads(); if (workshopResults.length) renderWorkshopResults(); if (pluginStoreLoaded) renderPluginStoreResults(); toast('已加入下载队列');
}
let themeMode = ['auto', 'light', 'dark'].includes(localStorage.getItem('deadAirTheme')) ? localStorage.getItem('deadAirTheme') : 'auto';
function autoTheme() { const now = new Date(); const minutes = now.getHours() * 60 + now.getMinutes(); const toMinutes = value => { const [h, m] = value.split(':').map(Number); return h * 60 + m; }; const rise = toMinutes($('#sunriseTime').value), set = toMinutes($('#sunsetTime').value); return rise < set ? minutes >= rise && minutes < set : minutes >= rise || minutes < set; }
function applyTheme(mode) {
  themeMode = mode;
  const label = { auto: '跟随日出日落', light: '浅色', dark: '深色' }[mode];
  document.body.classList.toggle('light', mode === 'light' || mode === 'auto' && autoTheme());
  $('#themeToggle').title = '主题：' + label;
  $('#themeToggle').setAttribute('aria-label', '主题：' + label + '，点击切换');
  $('#themeToggle').innerHTML = '<i data-lucide="' + (mode === 'light' ? 'sun' : mode === 'dark' ? 'moon' : 'sun-moon') + '"></i>';
  $('#themeSettingLabel').textContent = label;
  $$('[data-theme]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.theme === mode)));
  localStorage.setItem('deadAirTheme', mode); icons();
}

async function syncStatus() {
  try { const data = await api('/api/status'); document.body.dataset.serverState = data.online ? 'online' : 'offline'; currentMap = data.currentMap || ''; if (isGuest) { $('#overviewPlayerCount').textContent = data.playerCount ?? '—'; $('#overviewPlayerHint').textContent = '真人在线数量 · 不公开玩家资料'; } renderCurrentMap(currentMap); $('#serverStatus strong').textContent = data.online ? '服务器运行正常' : '游戏进程未运行'; $('#serverStatus span:not(.latency)').textContent = `同步于 ${new Date(data.lastSync || Date.now()).toLocaleTimeString()}`; $('#serverStatus .latency').lastChild.textContent = data.online ? '在线' : '离线'; $('#overviewState').textContent = data.online ? '在线' : '离线'; $('#sidebarState').textContent = data.online ? '在线' : '离线'; renderMaps(); }
  catch (error) { document.body.dataset.serverState = 'offline'; $('#serverStatus strong').textContent = '无法连接服务器'; $('#serverStatus span:not(.latency)').textContent = error.message; $('#serverStatus .latency').lastChild.textContent = '离线'; $('#overviewState').textContent = '离线'; $('#sidebarState').textContent = '离线'; }
}
const runtimeLabels = {
  loaded: ['已加载', 'good'], error: ['加载报错', 'bad'], 'not-found': ['未加载', 'warn'],
  unknown: ['待确认', 'neutral'], disabled: ['已停用 · 未加载', 'neutral'],
  'unexpected-loaded': ['文件已停用，但仍在内存中', 'warn'], paused: ['已暂停', 'warn']
};
function renderDiagnostics(data) {
  const maps = data.maps, runtime = data.plugins;
  const mapTone = !maps.available || !maps.scannedPackages ? 'neutral' : maps.conflictCount || maps.partial ? 'warn' : 'good';
  const mapTitle = !maps.available ? '地图检查不可用' : maps.conflictCount ? `${maps.conflictCount} 条潜在重叠路径` : maps.partial ? '已扫描部分未发现重叠' : maps.scannedPackages ? '已扫描地图包未发现重叠' : '未找到可检查的地图包';
  $('#mapDiagnostics').innerHTML = `<div class="diagnostic-result ${mapTone}"><strong>${escapeHtml(mapTitle)}</strong><p>已扫描 ${maps.scannedPackages} 个地图包 · 跳过 ${maps.ignoredPackages || 0} 个非地图包或分卷</p></div><p>${escapeHtml(maps.scope || '')}</p><p>同路径仅表示可能覆盖；共享素材也会重叠，并不一定导致故障。包自身的 addoninfo 与预览图不计入冲突。</p>${maps.reason ? `<p class="diagnostic-note">${escapeHtml(maps.reason)}</p>` : ''}${maps.unreadablePackages.length ? `<details class="diagnostic-details" open><summary>未完成检查的包或目录 · ${maps.unreadablePackages.length}</summary>${maps.unreadablePackages.map(item => `<div class="diagnostic-row"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.reason)}</span></div>`).join('')}</details>` : ''}${maps.conflicts.length ? `<details class="diagnostic-details"><summary>查看重叠路径与涉及的地图包</summary>${maps.conflicts.map(item => `<div class="diagnostic-row"><code>${escapeHtml(item.path)}</code><span>${item.packages.map(escapeHtml).join(' · ')}</span></div>`).join('')}</details>` : ''}${maps.truncated ? '<p class="diagnostic-note">为保持页面流畅，仅展示前 200 条；上方数量包含本次扫描发现的全部重叠路径。</p>' : ''}`;
  const warnings = runtime.counts['not-found'] + runtime.counts['unexpected-loaded'] + runtime.counts.paused;
  const tone = runtime.counts.error ? 'bad' : warnings ? 'warn' : !runtime.available || runtime.partial || runtime.counts.unknown ? 'neutral' : 'good';
  const title = !runtime.available ? '运行状态暂时无法确认' : runtime.counts.error ? `${runtime.counts.error} 个插件加载报错` : warnings ? `${warnings} 个插件需要留意` : runtime.partial || runtime.counts.unknown ? '部分插件状态待确认' : '插件运行状态已核验';
  $('#pluginDiagnostics').innerHTML = `<div class="diagnostic-result ${tone}"><strong>${escapeHtml(title)}</strong><p>已确认加载 ${runtime.counts.loaded} · 报错 ${runtime.counts.error} · 待确认 ${runtime.counts.unknown}</p></div><p>文件启用不等于加载成功。通过 SourceMod 报告的文件名对应；未知、截断或变化中的响应不会被判为正常。</p>${runtime.reason ? `<p class="diagnostic-note">${escapeHtml(runtime.reason)}</p>` : ''}${['error', 'not-found', 'unexpected-loaded', 'paused', 'unknown', 'loaded', 'disabled'].map(state => {
    const items = runtime.plugins.filter(item => item.runtimeStatus === state);
    if (!items.length) return '';
    const [label, color] = runtimeLabels[state];
    return `<details class="diagnostic-details" ${['error', 'not-found', 'unexpected-loaded', 'paused'].includes(state) ? 'open' : ''}><summary><span class="diagnostic-badge ${color}">${label}</span> ${items.length} 个</summary>${items.map(item => `<div class="diagnostic-row"><strong>${escapeHtml(item.name)}</strong><code>${escapeHtml(item.id)}.smx</code><span>文件：${item.enabled ? '启用目录' : '停用目录'}${item.runtimeName ? ' · 游戏内名称：' + escapeHtml(item.runtimeName) : ''}</span>${item.detail ? `<p class="diagnostic-error">${escapeHtml(item.detail)}</p>` : ''}</div>`).join('')}</details>`;
  }).join('')}${runtime.runtimeOnly.length ? `<details class="diagnostic-details"><summary>其他运行条目 · ${runtime.runtimeOnly.length}</summary><p>不在当前管理清单中，或未取得文件名；不据此判断加载失败。</p>${runtime.runtimeOnly.map(item => `<div class="diagnostic-row"><strong>${escapeHtml(item.name)}</strong><code>${escapeHtml(item.filename || '文件名待确认')}</code><span>${escapeHtml(runtimeLabels[item.state]?.[0] || '待确认')}</span></div>`).join('')}</details>` : ''}`;
}
async function runDiagnostics() {
  if (diagnosticsBusy) return;
  diagnosticsBusy = true;
  const button = $('#runDiagnostics'); button.disabled = true; button.setAttribute('aria-busy', 'true');
  $('#diagnosticsTimestamp').textContent = '正在读取地图索引和本次游戏响应，请稍候…';
  $('#mapDiagnostics').innerHTML = '<div class="diagnostics-empty">正在检查地图包…</div>';
  $('#pluginDiagnostics').innerHTML = '<div class="diagnostics-empty">正在核对运行状态…</div>';
  try {
    const data = await api('/api/diagnostics'); renderDiagnostics(data);
    $('#diagnosticsTimestamp').textContent = `检查完成于 ${new Date(data.completedAt).toLocaleString()} · 结果为本次快照，安装、启停插件或切图后请重新检查`;
    record('完成服务器只读自检');
  } catch (error) {
    $('#diagnosticsTimestamp').textContent = `检查失败：${error.message}`;
    $('#mapDiagnostics').innerHTML = $('#pluginDiagnostics').innerHTML = '<div class="diagnostics-empty">未取得本次结果，请重试。</div>';
  } finally { diagnosticsBusy = false; button.disabled = false; button.removeAttribute('aria-busy'); }
}
$('#runDiagnostics').onclick = runDiagnostics;

$$('.nav-item,[data-view]').forEach(button => button.onclick = () => navigate(button.dataset.view));
$$('.nav-item').forEach(button => { button.title = button.textContent.trim(); });
$('#mapSearch').oninput = renderMaps; $('#pluginSearch').oninput = renderPlugins;
$$('#mapFilters button').forEach(button => button.onclick = () => setMapFilter(button.dataset.filter));
syncMapFilterButtons();
$$('#pluginFilters button').forEach(button => button.onclick = () => { $$('#pluginFilters button').forEach(item => item.classList.remove('active')); button.classList.add('active'); pluginFilter = button.dataset.filter; renderPlugins(); });
$('#mapRows').onclick = event => { const direct = event.target.closest('[data-direct-map]'); if (direct) { openMapDirectDownload(direct.dataset.directMap, direct); return; } const exp = event.target.closest('[data-export-map]'); if (exp) { exportLibraryItem('maps', exp.dataset.exportMap, exp); return; } const remove = event.target.closest('[data-delete-map]'); if (remove) { deleteLibraryItem('maps', remove.dataset.deleteMap); return; } const toggle = event.target.closest('[data-campaign-toggle]'); if (toggle) { const id = toggle.dataset.campaignToggle; if (expandedCampaigns.has(id)) expandedCampaigns.delete(id); else expandedCampaigns.add(id); renderMaps(); return; } const button = event.target.closest('[data-map]'); if (button) selectMap(button.dataset.map); };
$('#quickMaps').onclick = event => { const button = event.target.closest('[data-map]'); if (button) selectMap(button.dataset.map); };
$('#randomMapBtn').onclick = () => { const chapters = allChapters(); if (chapters.length) selectMap(chapters[Math.floor(Math.random() * chapters.length)].id); else toast('还没有可用地图'); };
$('#quickMapBtn').onclick = () => { $('#modalMapList').innerHTML = campaigns.map(campaign => `<div class="modal-campaign"><strong>${escapeHtml(campaign.name)}</strong>${campaign.chapters.map(chapter => `<button data-map="${escapeHtml(chapter.id)}">${escapeHtml(chapter.name)}<small>${escapeHtml(chapter.id)}</small></button>`).join('')}</div>`).join(''); openMapDialog(); };
$('#modalMapList').onclick = event => { const button = event.target.closest('[data-map]'); if (button) { closeMapDialog(); selectMap(button.dataset.map); changeMap(button.dataset.map); } };
function openMapDialog() {
  $('#mapModal').classList.remove('hidden'); document.body.classList.add('modal-open');
  $('.app-shell').inert = true; $('#modalClose').focus();
}
function closeMapDialog() {
  $('#mapModal').classList.add('hidden'); document.body.classList.remove('modal-open');
  $('.app-shell').inert = false; $('#quickMapBtn').focus();
}
$('#modalClose').onclick = closeMapDialog;
$('#mapModal').onclick = event => { if (event.target.id === 'mapModal') closeMapDialog(); };
$('#mapModal').addEventListener('keydown', event => {
  if (event.key === 'Escape') { event.preventDefault(); closeMapDialog(); return; }
  if (event.key !== 'Tab') return;
  const buttons = [...$('#mapModal').querySelectorAll('button:not(:disabled)')];
  const first = buttons[0], last = buttons[buttons.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});
$('#pluginGrid').onclick = async event => { const exp = event.target.closest('[data-export-plugin]'); if (exp) { await exportLibraryItem('plugins', exp.dataset.exportPlugin, exp); return; } const remove = event.target.closest('[data-delete-plugin]'); if (remove) { await deleteLibraryItem('plugins', remove.dataset.deletePlugin); return; } const button = event.target.closest('[data-plugin]'); if (!button) return; const item = plugins.find(plugin => plugin.id === button.dataset.plugin); if (!item) return; const enabled = !item.enabled; if (!confirm(`确定${enabled ? '启用' : '停用'}“${item.name}”吗？`)) return; button.disabled = true; try { await post('/api/plugin', { id: item.id, enabled }); await loadPlugins(); record(`${enabled ? '启用' : '停用'}插件 ${item.id}`); toast('插件状态已更新'); } catch (error) { toast(`操作失败：${error.message}`); button.disabled = false; } };
$('#reloadPlugins').onclick = async () => { try { await post('/api/plugins/reload', {}); record('重载插件'); toast('重载命令已发送'); await loadPlugins(); } catch (error) { toast(`重载失败：${error.message}`); } };
$('#proxyFile').onchange = async event => { const file = event.target.files[0]; if (!file) return; if (file.size > 2 * 1024 * 1024) { toast('文件不能超过 2 MB'); return; } $('#proxyLinks').value = await file.text(); };
$('#proxyNodeSearch').oninput = renderProxy;
$('#openProxyDashboard').onclick = () => { window.open(proxyState.dashboard || '/proxy-dashboard/', '_blank', 'noopener'); };
$('#copyProxyController').onclick = async () => { try { await navigator.clipboard.writeText($('#proxyControllerAddress').value); toast('连接地址已复制'); } catch { toast('复制失败，请选中地址复制'); } };
$('#updateProxySubscriptions').onclick = async () => { const button = $('#updateProxySubscriptions'); button.disabled = true; $('#proxyStatus').textContent = '正在更新订阅…'; try { proxyState = await post('/api/proxy/update', {}); renderProxy(); record('更新代理订阅'); toast('订阅已更新'); } catch (error) { $('#proxyStatus').textContent = error.message; toast(`更新失败：${error.message}`); } finally { button.disabled = false; } };
$('#importNodes').onclick = async () => { const button = $('#importNodes'); button.disabled = true; try { proxyState = await post('/api/proxy/import', { links: $('#proxyLinks').value }); $('#proxyLinks').value = ''; renderProxy(); record('导入代理节点'); toast('节点已导入'); } catch (error) { toast(`导入失败：${error.message}`); } finally { button.disabled = false; } };
$('#proxyList').onclick = async event => { const switchButton = event.target.closest('[data-proxy-switch]'); const deleteButton = event.target.closest('[data-proxy-delete]'); const button = switchButton || deleteButton; if (!button) return; const node = proxyState.nodes.find(item => item.id === (switchButton?.dataset.proxySwitch || deleteButton?.dataset.proxyDelete)); if (!node) return; if (!confirm(`${switchButton ? '切换到' : '删除'}节点“${node.name}”？`)) return; button.disabled = true; $('#proxyStatus').textContent = switchButton ? '正在校验并切换节点…' : '正在删除节点…'; try { proxyState = await post(`/api/proxy/${switchButton ? 'switch' : 'delete'}`, { id: node.id }); renderProxy(); record(`${switchButton ? '切换' : '删除'}代理节点 ${node.name}`); toast(switchButton ? '节点已切换，创意工坊连通正常' : '节点已删除'); } catch (error) { $('#proxyStatus').textContent = error.message; toast(`操作失败：${error.message}`); button.disabled = false; } };
$('#exportNodes').onclick = async () => { try { const content = await api('/api/proxy/export'); const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' })); link.download = proxyState.engine === 'mihomo' ? 'workshop nodes.yaml' : 'workshop nodes.txt'; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); toast('节点已导出'); } catch (error) { toast(`导出失败：${error.message}`); } };
$('#workshopSearch').oninput = renderWorkshop; $('#workshopSearch').onkeydown = event => { if (event.key === 'Enter') searchWorkshop(); };
$('#searchWorkshop').onclick = () => searchWorkshop(); $('#openWorkshop').onclick = () => searchWorkshop('');
$('#workshopPrev').onclick = () => { if (workshopPage > 1) { workshopPage--; searchWorkshop(workshopQuery, false); } };
$('#workshopNext').onclick = () => { workshopPage++; searchWorkshop(workshopQuery, false); };
$('#workshopGrid').onclick = event => { const button = event.target.closest('[data-workshop]'); if (button) searchWorkshop(button.dataset.workshop); };
$('#workshopResults').onclick = async event => { if (event.target.closest('[data-open-proxy]')) { navigate('proxy'); return; } if (event.target.closest('[data-search-steam]')) { selectContentSource('steam-workshop', workshopQuery); await searchWorkshop(workshopQuery); return; } const install = event.target.closest('[data-install-workshop]'); const copy = event.target.closest('[data-copy-id]'); if (install && !install.disabled) { const id = install.dataset.installWorkshop; install.disabled = true; try { await startDownload(contentSource, id, workshopResults.find(item => item.id === id)?.title); } catch (error) { toast(`安装失败：${error.message}`); install.disabled = false; } } if (copy) { try { await navigator.clipboard.writeText(copy.dataset.copyId); toast('项目 ID 已复制'); } catch { toast('复制失败'); } } };
$('#contentSources').onclick = event => { const button = event.target.closest('[data-source]'); if (button && button.dataset.source !== contentSource) selectContentSource(button.dataset.source); };
$('#contentSections').onclick = event => { const button = event.target.closest('[data-content-section]'); if (button && button.dataset.contentSection !== contentSection) selectContentSection(button.dataset.contentSection); };
$('#pluginStoreResults').onclick = async event => {
  const button = event.target.closest('[data-install-plugin-store]'); if (!button || button.disabled) return;
  const item = pluginStoreResults.find(candidate => candidate.id === button.dataset.installPluginStore); if (!item) return;
  button.disabled = true;
  try { await startDownload('plugin-store', item.id, item.title); }
  catch (error) { toast(`插件导入失败：${error.message}`); button.disabled = false; }
};
$('#pluginStoreSearch').onkeydown = event => { if (event.key === 'Enter') searchPluginStore(); };
$('#searchPluginStore').onclick = () => searchPluginStore();
$('#refreshPluginStore').onclick = refreshPluginStore;
$('#pluginStorePrev').onclick = () => { if (pluginStorePage > 1) { pluginStorePage--; searchPluginStore(pluginStoreQuery, false); } };
$('#pluginStoreNext').onclick = () => { if (pluginStoreHasMore) { pluginStorePage++; searchPluginStore(pluginStoreQuery, false); } };
$('#pluginStoreFilters').onclick = event => { const button = event.target.closest('[data-plugin-category]'); if (!button || button.dataset.pluginCategory === pluginStoreCategory) return; pluginStoreCategory = button.dataset.pluginCategory; $$('#pluginStoreFilters button').forEach(item => item.classList.toggle('active', item === button)); searchPluginStore(pluginStoreQuery); };
$('#downloadList').onclick = async event => {
  const button = event.target.closest('[data-cancel-download],[data-retry-download],[data-search-download],[data-delete-download]');
  if (!button || button.disabled) return;
  button.disabled = true;
  try {
    const id = button.dataset.cancelDownload || button.dataset.retryDownload || button.dataset.searchDownload || button.dataset.deleteDownload;
    const job = downloadJobs.find(item => item.id === id);
    if (!job) return;
    if (button.hasAttribute('data-search-download')) { selectContentSource(job.source, job.title); await searchWorkshop(job.title); $('#workshopSearch').focus(); return; }
    if (button.hasAttribute('data-delete-download')) {
      if (deletingDownloads.has(id)) return;
      const active = !['completed', 'failed', 'cancelled'].includes(job.status);
      if (!confirm(`${active ? '终止下载并删除任务' : '删除任务记录'}“${job.title}”？\n已安装的地图或模组会保留。`)) return;
      deletingDownloads.add(id); renderDownloads();
      try { await post('/api/downloads/delete', { id }); downloadJobs = downloadJobs.filter(item => item.id !== id); renderDownloads(); renderWorkshopResults(); renderPluginStoreResults(); record(`删除下载任务 ${job.title}`); toast('任务已删除，已安装文件保留'); }
      finally { deletingDownloads.delete(id); renderDownloads(); }
    }
    else if (button.hasAttribute('data-cancel-download')) await post('/api/downloads/cancel', { id });
    else if (job.retryable !== false) await startDownload(job.source, job.itemId, job.title);
    await loadDownloads();
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; }
};
$('#refreshDownloads').onclick = loadDownloads;
$('#importMaps').onclick = () => $('#mapFiles').click();
$('#importPlugins').onclick = () => $('#pluginFiles').click();
$('#mapFiles').onchange = event => importLibraryFiles('maps', event.target);
$('#pluginFiles').onchange = event => importLibraryFiles('plugins', event.target);
$$('[data-theme]').forEach(button => button.onclick = () => applyTheme(button.dataset.theme));
$('#themeToggle').onclick = () => applyTheme(themeMode === 'auto' ? 'light' : themeMode === 'light' ? 'dark' : 'auto');
$('#copyAddress').onclick = $('#copyServerConnection').onclick = copyGameConnection;
$('#serverConnectCommand').onclick = event => { event.currentTarget.select(); copyGameConnection(); };
$('#sunriseTime').value = localStorage.getItem('deadAirSunrise') || '07:00'; $('#sunsetTime').value = localStorage.getItem('deadAirSunset') || '19:00';
$('#sunriseTime').onchange = $('#sunsetTime').onchange = () => { localStorage.setItem('deadAirSunrise', $('#sunriseTime').value); localStorage.setItem('deadAirSunset', $('#sunsetTime').value); if (themeMode === 'auto') applyTheme('auto'); toast('主题时段已更新'); };
$('#refreshBtn').onclick = async () => { const button = $('#refreshBtn'); button.disabled = true; button.setAttribute('aria-busy', 'true'); try { await Promise.all([loadMaps(), loadPlugins(), loadConnection()]); await syncStatus(); toast('状态检查已完成'); } finally { button.disabled = false; button.removeAttribute('aria-busy'); } };
renderActivity(); renderWorkshop(); applyTheme(themeMode);
loadDownloads();
setInterval(() => { if (!document.hidden && (!$('#workshopView').classList.contains('hidden') || downloadJobs.some(job => !['completed', 'failed', 'cancelled'].includes(job.status)))) loadDownloads(); }, 1500);
loadConnection();
Promise.all([loadMaps(), loadPlugins()]).then(syncStatus);
setInterval(() => { if (themeMode === 'auto') applyTheme('auto'); }, 15 * 60 * 1000);

function libraryControls(busy) {
  libraryBusy = busy;
  for (const id of ['importMaps', 'importPlugins', 'reloadPlugins']) $('#' + id).disabled = busy;
  for (const button of $$('[data-delete-map],[data-delete-plugin],[data-export-map],[data-export-plugin],[data-direct-map],[data-plugin]')) button.disabled = busy || button.hasAttribute('data-direct-map') && !openListState.enabled;
}
function uploadLibraryFile(kind, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/' + kind + '/import?name=' + encodeURIComponent(file.name));
    xhr.setRequestHeader('x-csrf-token', panelCsrf); xhr.setRequestHeader('content-type', 'application/octet-stream'); xhr.timeout = 30 * 60 * 1000;
    xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress(Math.min(100, Math.floor(event.loaded / event.total * 100))); };
    xhr.onload = () => { let data; try { data = JSON.parse(xhr.responseText); } catch { reject(new Error('服务器未返回有效结果')); return; } if (xhr.status >= 200 && xhr.status < 300) resolve(data); else reject(new Error(data.error || '上传失败 (' + xhr.status + ')')); };
    xhr.onerror = () => reject(new Error('上传连接中断，请刷新列表确认结果'));
    xhr.ontimeout = () => reject(new Error('上传超时，请刷新列表确认结果'));
    xhr.onabort = () => reject(new Error('上传已取消')); xhr.send(file);
  });
}
async function importLibraryFiles(kind, input) {
  const files = [...input.files]; input.value = '';
  if (!files.length || libraryBusy) return;
  const status = $('#' + kind + 'ImportStatus'); status.classList.remove('hidden');
  libraryControls(true); const results = [];
  try {
    for (const [index, file] of files.entries()) {
      const show = percent => { status.innerHTML = '<strong>' + escapeHtml(file.name) + ' · ' + (index + 1) + '/' + files.length + '</strong><progress max="100" value="' + percent + '" aria-label="上传进度"></progress><span>' + (percent === 100 ? '上传完成，正在校验和安装…' : '正在上传 ' + percent + '%') + '</span>'; };
      try {
        const limit = kind === 'maps' ? 2 * 1024 ** 3 : 64 * 1024 ** 2;
        if (file.size > limit || !file.size) throw new Error('文件为空或超过大小限制');
        show(0); const result = await uploadLibraryFile(kind, file, show);
        results.push(file.name + '：已导入' + (kind === 'plugins' ? '（默认停用）' : '（' + result.files.length + ' 个地图包）'));
        record('导入' + (kind === 'maps' ? '地图 ' : '插件 ') + file.name);
      } catch (error) { results.push(file.name + '：失败 · ' + error.message); }
    }
    if (kind === 'maps') { await loadMaps(); renderCurrentMap(); } else await loadPlugins();
  } finally {
    libraryControls(false); status.innerHTML = '<strong>导入结果</strong>' + results.map(result => '<p>' + escapeHtml(result) + '</p>').join('');
  }
}
async function deleteLibraryItem(kind, id) {
  if (libraryBusy) return;
  const groups = campaigns.filter(item => item.package === id);
  const item = kind === 'maps' ? groups[0] : plugins.find(item => item.id === id);
  if (!item) return;
  const prompt = kind === 'maps' ? '删除地图包“' + item.name + '”？\n文件：' + id + '\n该文件内的全部地图和章节将从服务器移除，请确保没有玩家正在使用。' : '删除插件“' + item.name + '”？\n文件：' + id + '.smx\n' + (item.enabled ? '将先发送卸载命令，再移除文件。依赖此插件的功能可能受影响。' : '插件文件将从停用列表移除。');
  if (!confirm(prompt)) return;
  libraryControls(true);
  try {
    await post('/api/' + kind + '/delete', kind === 'maps' ? { package: id } : { id });
    if (kind === 'maps') { await loadMaps(); renderCurrentMap(); } else await loadPlugins();
    record('删除' + (kind === 'maps' ? '地图包 ' : '插件 ') + id); toast('已删除' + (kind === 'maps' ? '地图包' : '插件'));
  } catch (error) { toast('删除失败：' + error.message); }
  finally { libraryControls(false); }
}

async function exportLibraryItem(kind, id, button) {
  if (libraryBusy || button.disabled) return;
  const url = '/api/' + kind + '/export?' + (kind === 'maps' ? 'package' : 'id') + '=' + encodeURIComponent(id);
  button.disabled = true;
  try {
    const response = await fetch(url, { method: 'HEAD' });
    if (!response.ok) throw new Error(response.status === 404 ? '文件已不存在，请刷新列表' : '文件暂时无法导出 (' + response.status + ')');
    const link = document.createElement('a'); link.href = url; link.download = kind === 'maps' ? id : id + '.smx';
    document.body.appendChild(link); link.click(); link.remove();
    record('请求导出' + (kind === 'maps' ? '地图包 ' : '插件 ') + id); toast('已交给浏览器下载，请在下载列表查看进度');
  } catch (error) { toast('导出失败：' + error.message); }
  finally { button.disabled = libraryBusy; }
}

$('#refreshCloudBackup').onclick = loadCloudBackup;
$('#backupCloudMaps').onclick = () => cloudAction('/api/openlist/backup');
$('#toggleCloudBackup').onclick = () => cloudAction('/api/openlist/backup/settings', { enabled: !cloudBackup.enabled });
$('#stopCloudBackup').onclick = () => cloudAction('/api/openlist/backup/stop');
let cloudDirectInfo = null, cloudDirectController = null, cloudDownloadBusy = false;
const cloudDownloadDialog = $('#cloudDownloadDialog');
function requestDownloadHelper(action, detail = {}, signal = cloudDirectController?.signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('操作已取消', 'AbortError'));
    const requestId = crypto.randomUUID();
    const cleanup = () => { clearTimeout(timer); window.removeEventListener('message', receive); signal?.removeEventListener('abort', abort); };
    const abort = () => { cleanup(); reject(new DOMException('操作已取消', 'AbortError')); };
    const receive = event => {
      if (event.source !== window || event.origin !== location.origin || event.data?.source !== 'l4d2-download-helper' || event.data.requestId !== requestId) return;
      cleanup(); event.data.ok ? resolve(event.data) : reject(new Error(event.data.error || '扩展下载失败，请重新绑定。'));
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error(action === 'status' ? '未检测到 1.2.1 或更新版下载助手。请下载新版扩展包，在浏览器扩展页重新加载，再回到本页点击扩展图标“绑定当前面板标签页”。仅刷新网页不会更新扩展。' : '下载检查超时，请在浏览器下载列表确认是否已启动，再重试。')); }, action === 'status' ? 1500 : 60000);
    window.addEventListener('message', receive); signal?.addEventListener('abort', abort, { once: true });
    window.postMessage({ source: 'l4d2-control', requestId, action, ...detail }, location.origin);
  });
}
function updateCloudDownloadCommand() {
  if (!cloudDirectInfo) return;
  const quote = value => "'" + String(value).replace(/'/g, "''") + "'";
  const name = cloudDirectInfo.name.replace(/[<>:"/\\|?*]/g, '-');
  const ua = quote(cloudDirectInfo.userAgent), referer = cloudDirectInfo.referer ? ' --referer=' + quote(cloudDirectInfo.referer) : '', url = quote(cloudDirectInfo.url), output = quote(name);
  $('#cloudDownloadCommand').value = $('#cloudDownloadTool').value === 'aria2' ? 'aria2c --continue=true --split=4 --max-connection-per-server=4 --user-agent=' + ua + referer + ' --out=' + output + ' -- ' + url : 'curl.exe --fail --location --retry 2 --user-agent ' + ua + referer + ' --continue-at - --output ' + output + ' -- ' + url;
  const directLink = $('#browserDirectDownload');
  directLink.disabled = cloudDownloadBusy;
  const directUrl = new URL(cloudDirectInfo.url);
  directLink.hidden = !cloudDirectInfo.direct || cloudDirectInfo.userAgent !== 'pan.baidu.com' || directUrl.protocol !== 'https:' || !/(^|\.)(baidupcs\.com|pcs\.baidu\.com)$/i.test(directUrl.hostname);
  $('#copyCloudDownloadCommand').disabled = !cloudDirectInfo.direct;
}
async function refreshCloudDirectInfo(signal = cloudDirectController?.signal) {
  const packageName = cloudDirectInfo?.package;
  if (!packageName) throw new Error('请关闭此窗口并重新打开直连下载');
  const info = await api('/api/openlist/map-download-info', { method: 'POST', body: JSON.stringify({ package: packageName }), signal });
  if (signal?.aborted) throw new DOMException('下载链接刷新已取消', 'AbortError');
  cloudDirectInfo = { ...info, package: packageName }; updateCloudDownloadCommand();
  return cloudDirectInfo;
}
$('#cloudDownloadTool').onchange = updateCloudDownloadCommand;
$('#browserDirectDownload').onclick = async event => {
  event.preventDefault();
  if (cloudDownloadBusy || !cloudDirectInfo || !cloudDirectController) return;
  const controller = cloudDirectController;
  cloudDownloadBusy = true; $('#browserDirectDownload').disabled = true;
  $('#cloudDownloadMessage').textContent = '正在检查下载助手是否已绑定…';
  try {
    await requestDownloadHelper('status', {}, controller.signal);
    const info = await refreshCloudDirectInfo(controller.signal);
    $('#cloudDownloadMessage').textContent = '正在由本机扩展验证地图文件；文件不经过游戏服务器…';
    await requestDownloadHelper('download', { url: info.url, name: info.name, size: info.size }, controller.signal);
    const frame = document.createElement('iframe');
    frame.hidden = true; frame.title = '地图直连下载'; frame.referrerPolicy = 'no-referrer';
    frame.setAttribute('sandbox', 'allow-downloads allow-same-origin');
    frame.src = info.url; document.body.append(frame); setTimeout(() => frame.remove(), 60000);
    $('#cloudDownloadMessage').textContent = '地图内容检查通过，已交给浏览器下载。请在浏览器下载列表查看进度；文件由百度直接传到你的电脑。';
    toast('直连下载已启动，面板会保持打开');
  } catch (error) { if (error.name !== 'AbortError' && cloudDirectController === controller) $('#cloudDownloadMessage').textContent = error.message; }
  finally { cloudDownloadBusy = false; $('#browserDirectDownload').disabled = false; }
};
$('#closeCloudDownload').onclick = () => cloudDownloadDialog.close();
cloudDownloadDialog.addEventListener('close', () => { cloudDirectController?.abort(); cloudDirectInfo = null; $('#cloudDownloadCommand').value = ''; $('#browserDirectDownload').hidden = true; $('#browserDirectDownload').removeAttribute('href'); });
$('#copyCloudDownloadCommand').onclick = async () => {
  if (!cloudDirectInfo || !cloudDirectController) return;
  const button = $('#copyCloudDownloadCommand'); button.disabled = true; $('#cloudDownloadMessage').textContent = '正在重新获取签名链接…';
  try {
    await refreshCloudDirectInfo(cloudDirectController.signal);
    try { await navigator.clipboard.writeText($('#cloudDownloadCommand').value); $('#cloudDownloadMessage').textContent = '已复制新生成的链接；请尽快在 PowerShell / aria2 中使用。'; toast('下载命令已复制，粘贴到电脑的 PowerShell 执行'); }
    catch { $('#cloudDownloadCommand').focus(); $('#cloudDownloadCommand').select(); $('#cloudDownloadMessage').textContent = '签名已刷新，但浏览器不允许自动复制。请复制下方已选中的命令。'; toast('请复制已选中的下载命令'); }
  } catch (error) { if (error.name !== 'AbortError') { $('#cloudDownloadMessage').textContent = error.message; toast(`刷新下载链接失败：${error.message}`); } }
  finally { if (button.isConnected) button.disabled = !cloudDirectInfo; }
};
async function openMapDirectDownload(packageName, button) {
  if (button.disabled || !openListState.enabled) return;
  cloudDirectController?.abort(); cloudDirectController = new AbortController();
  const controller = cloudDirectController;
  cloudDirectInfo = { package: packageName }; $('#cloudDownloadName').textContent = packageName;
  $('#browserDirectDownload').hidden = true; $('#browserDirectDownload').removeAttribute('href');
  $('#cloudDownloadMessage').textContent = '正在刷新专用网盘中的地图直链…'; $('#cloudDownloadCommand').value = ''; $('#copyCloudDownloadCommand').disabled = true;
  cloudDownloadDialog.showModal(); button.disabled = true;
  try {
    const info = await refreshCloudDirectInfo(controller.signal);
    if (controller.signal.aborted) return;
    $('#copyCloudDownloadCommand').disabled = !info.direct;
    $('#cloudDownloadMessage').textContent = info.direct ? '需要下载助手 1.2.1 或更新版，并绑定当前标签页。点击后会刷新链接，由扩展检查实际地图内容并启动浏览器下载；不会再跳转到百度错误页。同一标签页刷新后会自动恢复连接；扩展更新后请刷新面板并重新绑定。' : (isGuest ? '该地图暂时无法直连下载，请联系管理员。' : '该网盘当前返回中转地址，直连不可用；可关闭此窗口后使用“服务器下载导出”，速度会受服务器带宽影响。');
    record(`生成地图直连下载链接 ${packageName}`);
  } catch (error) { if (error.name !== 'AbortError') $('#cloudDownloadMessage').textContent = error.message; }
  finally { if (button.isConnected) button.disabled = libraryBusy || !openListState.enabled; }
}

function applyAccessPresentation() {
  $('#sessionRole').textContent = isGuest ? '普通账号' : '授权账号';
  $('#sessionHint').textContent = isGuest ? '仅查看与直连下载' : '服务器管理权限';
  $('#sessionAvatar').textContent = isGuest ? 'P' : 'A';
  if (isGuest) {
    $('#mapsView .library-help').textContent = '展开查看战役和章节。已完成云端备份的自定义地图可以“直连下载导出（推荐）”；官方地图不提供导出。';
    $('#pluginsView .library-help').textContent = '这里展示服务器安装的插件及启用状态。普通账号只能查看，不能启用、停用或导出插件。';
    $('#overviewView .recent-panel h2').textContent = '地图快速浏览'; $('#overviewView .recent-panel .panel-heading p').textContent = '展开查看你想玩的战役';
    $('#overviewView .activity-panel .panel-heading h2').textContent = '普通账号权限'; $('#overviewView .activity-panel .panel-heading p').textContent = '公开内容与个人直连下载';
    $('#activityList').innerHTML = '<div class="activity-item"><div><b>查看地图、章节和插件状态</b><span>下载已备份的自定义地图，请到地图管理点击直连下载导出。</span></div></div>';
  }
}
applyAccessPresentation();
$('#logoutPanelMobile').onclick = $('#logoutPanel').onclick = async () => { try { await post('/api/auth/logout', {}); location.replace('/login'); } catch (error) { toast(error.message); } };
