const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const categories = { admin: '管理权限', vote: '地图与投票', players: '玩家与人数', gameplay: '玩法与物品', fix: '修复与优化', framework: '框架依赖' };
let campaigns = [], plugins = [], currentMap = '', selectedMap = '', mapFilter = 'all', pluginFilter = 'all';
const expandedCampaigns = new Set();
let proxyState = { activeId: null, nodes: [] }, workshopPage = 1, workshopQuery = '', workshopResults = [];
let contentSource = 'steam-workshop', downloadJobs = [], searchVersion = 0, searchController = null, hasMoreResults = false, downloadsBusy = false;
const activities = [];
const corePlugins = new Set(['admin-flatfile', 'adminmenu', 'basecommands', 'basechat']);
const deletingDownloads = new Set();
let libraryBusy = false;
let gameAddress = '';
async function loadConnection() {
  try { const config = await api('/api/config'); gameAddress = config.gameAddress || ''; } catch { gameAddress = ''; }
  $('[data-game-address]').forEach(element => { element.textContent = gameAddress || '未配置连接地址'; });
  $('#copyAddress').disabled = !gameAddress;
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
function navigate(view) {
  $$('.content').forEach(element => element.classList.toggle('hidden', element.id !== `${view}View`));
  $$('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  $('#pageTitle').textContent = { overview: '总览', maps: '地图管理', plugins: '插件管理', workshop: '内容下载', proxy: '代理管理', players: '在线玩家', logs: '操作日志', settings: '服务器设置' }[view];
  if (view === 'proxy') loadProxy();
  if (view === 'workshop') loadDownloads();
  $$('.nav-item').forEach(button => { if (button.dataset.view === view) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); });
  icons();
}
async function api(url, options) {
  const response = await fetch(url, options);
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
function filteredCampaigns() {
  const query = $('#mapSearch').value.trim().toLowerCase();
  return campaigns.filter(campaign => (mapFilter === 'all' || campaign.type === mapFilter) && (!query || `${campaign.name} ${campaign.english} ${campaign.chapters.map(chapter => `${chapter.name} ${chapter.id}`).join(' ')}`.toLowerCase().includes(query)));
}
function renderMaps() {
  const query = $('#mapSearch').value.trim().toLowerCase();
  const visible = filteredCampaigns();
  const autoExpanded = new Set(query ? visible.filter(campaign => campaign.chapters.some(chapter => `${chapter.name} ${chapter.id}`.toLowerCase().includes(query))).map(campaign => campaign.id) : []);
  $('#mapRows').innerHTML = visible.map(campaign => {
    const expanded = expandedCampaigns.has(campaign.id) || autoExpanded.has(campaign.id);
    return `<article class="campaign-card ${expanded ? 'expanded' : ''}"><button class="campaign-head" data-campaign-toggle="${escapeHtml(campaign.id)}" aria-expanded="${expanded}"><span class="campaign-head-copy"><strong>${escapeHtml(campaign.name)}</strong><span>${escapeHtml(campaign.english)}</span></span><span class="campaign-head-meta"><span class="campaign-count">${campaign.chapters.length} 章 · ${campaign.type === 'official' ? '官方' : campaign.type === 'custom' ? '自定义' : '其他'}</span><i data-lucide="${expanded ? 'chevron-up' : 'chevron-down'}"></i></span></button><div class="chapter-list ${expanded ? '' : 'hidden'}">${campaign.chapters.map(chapter => `<button class="chapter-row ${chapter.id === selectedMap ? 'selected' : ''}" data-map="${escapeHtml(chapter.id)}"><span class="chapter-number">${String(chapter.number).padStart(2, '0')}</span><span class="chapter-title"><strong>${escapeHtml(chapter.name)}</strong><small>${escapeHtml(chapter.id)}</small></span><span class="chapter-state ${chapter.id === currentMap ? 'current' : ''}">${chapter.id === currentMap ? '运行中' : '可切换'}</span><i data-lucide="chevron-right"></i></button>`).join('')}</div>${campaign.type === 'custom' && campaign.package ? `<div class="campaign-actions"><span title="${escapeHtml(campaign.package)}">${escapeHtml(campaign.package)}</span><div class="library-item-actions"><button class="secondary-button" data-export-map="${escapeHtml(campaign.package)}" ${libraryBusy ? 'disabled' : ''}><i data-lucide="download"></i>导出地图包</button><button class="danger-button" data-delete-map="${escapeHtml(campaign.package)}" ${libraryBusy ? 'disabled' : ''}><i data-lucide="trash-2"></i>删除地图包</button></div></div>` : ''}</article>`;
  }).join('') || '<div class="empty-state"><p>没有匹配的战役或章节</p></div>';
  renderDetail(); icons();
}
function renderDetail() {
  const selected = chapterById(selectedMap) || chapterById(currentMap) || (campaigns[0] && { campaign: campaigns[0], chapter: campaigns[0].chapters[0] });
  if (!selected) { $('#mapDetail').innerHTML = '<h2>暂无可用地图</h2><p>请检查游戏目录与附加包。</p>'; return; }
  const { campaign, chapter } = selected; selectedMap = chapter.id;
  $('#mapDetail').innerHTML = `<span class="detail-kicker">已选章节 · ${String(chapter.number).padStart(2, '0')}</span><h2>${escapeHtml(campaign.name)}</h2><p class="detail-english">${escapeHtml(campaign.english)}</p><h3>${escapeHtml(chapter.name)}</h3><p>${escapeHtml(chapter.id)}</p><div class="detail-stats"><div><span>类型</span><b>${campaign.type === 'official' ? '官方战役' : '自定义战役'}</b></div><div><span>状态</span><b class="green-text">${chapter.id === currentMap ? '运行中' : '可切换'}</b></div></div><button class="primary-button detail-button" id="changeMap"><i data-lucide="play"></i>${chapter.id === currentMap ? '重载当前章节' : '切换到此章节'}</button>`;
  $('#changeMap').onclick = () => changeMap(chapter.id); icons();
}
function selectMap(id) { selectedMap = id; const match = chapterById(id); if (match) expandedCampaigns.add(match.campaign.id); navigate('maps'); renderMaps(); }
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
    $('#allMapCount').textContent = campaigns.length;
    $('#officialMapCount').textContent = campaigns.filter(item => item.type === 'official').length;
    $('#customMapCount').textContent = campaigns.filter(item => item.type === 'custom').length;
    $('#otherMapCount').textContent = campaigns.filter(item => item.type === 'other').reduce((sum, item) => sum + item.chapters.length, 0);
    $('#mapCoverage').textContent = `已识别 ${campaigns.length} 个地图分组、${data.chapterCount} 个可切换地图；附加包 ${data.addonCount} 个。`;
    renderMaps(); renderQuick();
  } catch (error) { $('#mapCoverage').textContent = `读取地图失败：${error.message}`; $('#mapRows').innerHTML = '<div class="empty-state"><p>无法读取服务器地图</p></div>'; }
}
function renderPlugins() {
  const query = $('#pluginSearch').value.trim().toLowerCase();
  const filtered = plugins.filter(item => (pluginFilter === 'all' || item.type === pluginFilter) && (!query || `${item.name} ${item.id}`.toLowerCase().includes(query)));
  $('#pluginGrid').innerHTML = filtered.map(item => `<article class="plugin-card"><div class="plugin-card-top"><div class="plugin-names"><h3>${escapeHtml(item.name)}</h3><span title="${escapeHtml(item.id)}.smx">${escapeHtml(item.id)}.smx</span></div><button class="switch ${item.enabled ? 'on' : ''}" data-plugin="${escapeHtml(item.id)}" role="switch" aria-checked="${item.enabled}" title="${item.enabled ? '停用' : '启用'} ${escapeHtml(item.name)}" aria-label="${item.enabled ? '停用' : '启用'} ${escapeHtml(item.name)}"></button></div><div class="plugin-meta"><span>${escapeHtml(item.category)}</span><span>${item.enabled ? '已启用' : '已停用'}</span></div><div class="plugin-actions"><button class="secondary-button" data-export-plugin="${escapeHtml(item.id)}" ${libraryBusy ? 'disabled' : ''}><i data-lucide="download"></i>导出插件</button>${corePlugins.has(item.id.toLowerCase()) ? '<span class="protected-note"><i data-lucide="shield-check"></i>核心管理插件</span>' : `<button class="danger-button" data-delete-plugin="${escapeHtml(item.id)}" ${libraryBusy ? 'disabled' : ''}><i data-lucide="trash-2"></i>删除插件</button>`}</div></article>`).join('') || '<div class="empty-state"><p>没有匹配的插件</p></div>';
  icons();
}
async function loadPlugins() {
  try { const data = await api('/api/plugins'); plugins = data.plugins; $('#navPluginCount').textContent = plugins.length; $('#overviewPluginCount').textContent = plugins.length; $('#pluginTotal').textContent = plugins.length; $('#pluginEnabled').textContent = plugins.filter(item => item.enabled).length; renderPlugins(); }
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
  $('#workshopResultMeta').textContent = workshopResults.length ? `本页 ${workshopResults.length} 个项目` : '没有匹配项目';
  $('#workshopResults').innerHTML = workshopResults.map(item => {
    const job = [...downloadJobs].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).find(job => job.source === contentSource && job.itemId === item.id);
    const installed = job?.status === 'completed', pending = job && !['completed', 'failed', 'cancelled'].includes(job.status);
    return `<article class="workshop-result">${item.image ? `<img src="${escapeHtml(item.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<div class="result-placeholder"><i data-lucide="image"></i></div>'}<div class="workshop-result-body"><h3>${escapeHtml(item.title)}</h3><span>${contentSource === 'gamemaps' ? 'GameMaps' : 'Workshop'} ID · ${escapeHtml(item.id)}</span><div><button class="primary-button workshop-install ${installed ? 'is-installed' : ''}" data-install-workshop="${escapeHtml(item.id)}" ${installed || pending ? 'disabled' : ''}><i data-lucide="${installed ? 'check' : pending ? 'loader-circle' : 'download'}"></i>${installed ? '本次已安装' : pending ? job.phase : '安装到服务器'}</button><button class="text-button" data-copy-id="${escapeHtml(item.id)}"><i data-lucide="copy"></i>复制 ID</button></div></div></article>`;
  }).join('') || '<div class="workshop-empty"><p>没有匹配项目，请更换关键词</p></div>'; icons();
}
async function searchWorkshop(query = $('#workshopSearch').value.trim(), reset = true) {
  searchController?.abort(); searchController = new AbortController(); const version = ++searchVersion;
  if (reset) workshopPage = 1; workshopQuery = query; workshopResults = []; hasMoreResults = false; $('#workshopSearch').value = query; const button = $('#searchWorkshop'); button.disabled = true; $('#workshopPrev').disabled = true; $('#workshopNext').disabled = true; $('#workshopResultMeta').textContent = `正在搜索 ${contentSource === 'gamemaps' ? 'GameMaps' : 'Steam'}…`; $('#workshopResults').innerHTML = '<div class="workshop-empty"><i data-lucide="loader-circle"></i><p>正在读取项目</p></div>'; icons();
  try { const data = await api(`/api/${contentSource === 'gamemaps' ? 'gamemaps' : 'workshop'}?query=${encodeURIComponent(query)}&page=${workshopPage}`, { signal: searchController.signal }); if (version !== searchVersion) return; workshopResults = data.items || []; hasMoreResults = data.hasMore ?? workshopResults.length >= 12; renderWorkshopResults(); if (data.unavailable) { $('#workshopResultMeta').textContent = data.errorCode === 'GAMEMAPS_CHALLENGE' ? '站点验证拦截' : '来源暂时不可用'; $('#workshopResults').innerHTML = `<div class="workshop-empty"><i data-lucide="cloud-off"></i><p>${escapeHtml(contentSource === 'gamemaps' ? data.error : '服务器暂时无法连接 Steam，请检查创意工坊代理节点')}</p><div class="source-recovery-actions"><button class="secondary-button" data-open-proxy>管理代理节点</button>${contentSource === 'gamemaps' ? '<button class="primary-button" data-search-steam>在 Steam 搜索相同关键词</button>' : ''}</div></div>`; } }
  catch (error) { if (version !== searchVersion || error.name === 'AbortError') return; $('#workshopResultMeta').textContent = '搜索失败'; $('#workshopResults').innerHTML = `<div class="workshop-empty"><p>${escapeHtml(error.message)}</p></div>`; }
  finally { if (version === searchVersion) button.disabled = false; icons(); }
}
const bytesLabel = bytes => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GiB` : bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MiB` : `${(bytes / 1024).toFixed(1)} KiB`;
function renderDownloads() {
  const expandedErrors = new Set($$('#downloadList .download-error-details[open]').map(element => element.dataset.job));
  const historyOpen = !!$('#downloadHistory')?.open;
  const isDone = job => ['completed', 'failed', 'cancelled'].includes(job.status);
  const sourceJobs = downloadJobs.filter(job => job.source === contentSource).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const activeJobs = sourceJobs.filter(job => !isDone(job)), history = sourceJobs.filter(isDone);
  const otherActive = downloadJobs.filter(job => job.source !== contentSource && !isDone(job)).length;
  $('#downloadCount').textContent = `${contentSource === 'gamemaps' ? 'GameMaps' : 'Steam'} · ${activeJobs.length} 个进行中${otherActive ? ` · 另一来源 ${otherActive} 个进行中` : ''}`;
  const renderJob = job => {
    const done = ['completed', 'failed', 'cancelled'].includes(job.status), completed = job.status === 'completed';
    const mismatch = job.errorCode === 'STEAM_IDENTITY_MISMATCH' || /项目名称与 Steam 官方编号不一致/.test(job.error || '');
    const percentage = completed ? 100 : job.totalBytes && job.status === 'downloading' ? Math.min(100, Math.floor(job.receivedBytes / job.totalBytes * 100)) : null;
    const value = percentage !== null ? ` value="${percentage}"` : done ? ' value="0"' : '';
    const error = String(job.error || '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').trim();
    const detail = completed ? `${job.alreadyInstalled ? '文件已存在' : '已安装'} · 重启游戏服务器后生效` : /No Connection/i.test(error) ? 'Steam 下载连接失败，请检查代理节点后重试' : error.length > 180 ? error.slice(0, 180) + '…' : error || `${bytesLabel(job.receivedBytes)}${job.totalBytes ? ` / ${bytesLabel(job.totalBytes)}` : ' · 总大小未知'}${percentage !== null ? ` · ${percentage}%` : ''}`;
    const errorDetails = error && error !== detail ? `<details class="download-error-details" data-job="${escapeHtml(job.id)}"${expandedErrors.has(job.id) ? ' open' : ''}><summary>错误详情</summary><p>${escapeHtml(error)}</p></details>` : '';
    const progress = `<div class="download-progress${percentage === null && !done ? ' indeterminate' : ''}"><progress max="100"${value} aria-label="${escapeHtml(job.title)}：${escapeHtml(job.phase)}"></progress></div>`;
    const action = !done ? `<button class="icon-button" data-cancel-download="${job.id}" title="取消下载" aria-label="取消 ${escapeHtml(job.title)}"><i data-lucide="x"></i></button>` : mismatch ? `<button class="secondary-button" data-search-download="${job.id}">重新搜索</button>` : !completed && job.retryable !== false ? `<button class="icon-button" data-retry-download="${job.id}" title="重试下载" aria-label="重试 ${escapeHtml(job.title)}"><i data-lucide="rotate-cw"></i></button>` : '';
    const dismiss = `<button class="danger-button" data-delete-download="${escapeHtml(job.id)}" title="${done ? '删除任务记录，保留已安装文件' : '终止下载并删除任务'}" ${deletingDownloads.has(job.id) ? 'disabled' : ''}><i data-lucide="trash-2"></i>${deletingDownloads.has(job.id) ? '删除中…' : '删除任务'}</button>`;
    return `<article class="download-task ${job.status}"><div class="download-task-heading"><div><h3>${escapeHtml(job.title)}</h3><span>${job.source === 'gamemaps' ? 'GameMaps' : 'Steam Workshop'} · ${escapeHtml(job.itemId)}</span></div><strong>${mismatch ? '需要重新搜索' : escapeHtml(job.phase)}</strong>${action}${dismiss}</div>${done && !completed ? '' : progress}<p>${escapeHtml(detail)}</p>${errorDetails}</article>`;
  };
  $('#downloadList').innerHTML = (activeJobs.map(renderJob).join('') || '<div class="download-empty">当前来源没有进行中的下载</div>') + (history.length ? `<details id="downloadHistory" class="download-history"${historyOpen ? ' open' : ''}><summary>历史记录 · ${history.length} 条（${history.filter(job => job.status === 'failed').length} 条失败）</summary><div class="download-history-list">${history.map(renderJob).join('')}</div></details>` : ''); icons();
}
function selectContentSource(source, query = $('#workshopSearch').value.trim()) {
  contentSource = source;
  $$('#contentSources button').forEach(button => { const active = button.dataset.source === source; button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active)); });
  $('#contentSourceName').textContent = source === 'gamemaps' ? 'GameMaps · Left 4 Dead 2' : 'Steam Workshop · Left 4 Dead 2';
  $('#workshopSearch').placeholder = source === 'gamemaps' ? '关键词、GameMaps 编号或详情链接…' : '地图、模组或关键词…';
  $('#gameMapsHelp').classList.toggle('hidden', source !== 'gamemaps');
  $('#contentConnection').textContent = '内容下载专用代理';
  workshopResults = []; hasMoreResults = false;
  $('#workshopSearch').value = query;
  renderDownloads(); renderWorkshopResults(); renderWorkshop();
  return searchWorkshop(query);
}
async function loadDownloads() {
  if (downloadsBusy) return; downloadsBusy = true;
  try {
    const data = await api('/api/downloads');
    const previous = new Map(downloadJobs.map(job => [job.id, job.status]));
    downloadJobs = data.jobs || []; $('#downloadConnection').textContent = '';
    renderDownloads();
    for (const job of downloadJobs) if (previous.has(job.id) && previous.get(job.id) !== job.status && job.status === 'completed') { record(`安装 ${job.source === 'gamemaps' ? 'GameMaps' : '创意工坊'}项目 ${job.itemId}`); toast('安装完成，重启游戏服务器后生效'); loadMaps(); }
    if (workshopResults.length) renderWorkshopResults();
  } catch (error) { $('#downloadConnection').textContent = `任务状态暂时无法同步：${error.message}`; }
  finally { downloadsBusy = false; }
}
async function startDownload(source, id, title) {
  const data = await post(`/api/${source === 'gamemaps' ? 'gamemaps' : 'workshop'}/install`, { id, title });
  if (!downloadJobs.some(job => job.id === data.job.id)) downloadJobs.push(data.job);
  renderDownloads(); if (workshopResults.length) renderWorkshopResults(); toast('已加入下载队列');
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
  try { const data = await api('/api/status'); document.body.dataset.serverState = data.online ? 'online' : 'offline'; currentMap = data.currentMap || ''; renderCurrentMap(currentMap); $('#serverStatus strong').textContent = data.online ? '服务器运行正常' : '游戏进程未运行'; $('#serverStatus span:not(.latency)').textContent = `同步于 ${new Date(data.lastSync || Date.now()).toLocaleTimeString()}`; $('#serverStatus .latency').lastChild.textContent = data.online ? '在线' : '离线'; $('#overviewState').textContent = data.online ? '在线' : '离线'; $('#sidebarState').textContent = data.online ? '在线' : '离线'; renderMaps(); }
  catch (error) { document.body.dataset.serverState = 'offline'; $('#serverStatus strong').textContent = '无法连接服务器'; $('#serverStatus span:not(.latency)').textContent = error.message; $('#serverStatus .latency').lastChild.textContent = '离线'; $('#overviewState').textContent = '离线'; $('#sidebarState').textContent = '离线'; }
}
$$('.nav-item,[data-view]').forEach(button => button.onclick = () => navigate(button.dataset.view));
$$('.nav-item').forEach(button => { button.title = button.textContent.trim(); });
$('#mapSearch').oninput = renderMaps; $('#pluginSearch').oninput = renderPlugins;
$$('#mapFilters button').forEach(button => button.onclick = () => { $$('#mapFilters button').forEach(item => item.classList.remove('active')); button.classList.add('active'); mapFilter = button.dataset.filter; renderMaps(); });
$$('#pluginFilters button').forEach(button => button.onclick = () => { $$('#pluginFilters button').forEach(item => item.classList.remove('active')); button.classList.add('active'); pluginFilter = button.dataset.filter; renderPlugins(); });
$('#mapRows').onclick = event => { const exp = event.target.closest('[data-export-map]'); if (exp) { exportLibraryItem('maps', exp.dataset.exportMap, exp); return; } const remove = event.target.closest('[data-delete-map]'); if (remove) { deleteLibraryItem('maps', remove.dataset.deleteMap); return; } const toggle = event.target.closest('[data-campaign-toggle]'); if (toggle) { const id = toggle.dataset.campaignToggle; if (expandedCampaigns.has(id)) expandedCampaigns.delete(id); else expandedCampaigns.add(id); renderMaps(); return; } const button = event.target.closest('[data-map]'); if (button) selectMap(button.dataset.map); };
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
$('#workshopResults').onclick = async event => { if (event.target.closest('[data-open-proxy]')) { navigate('proxy'); return; } if (event.target.closest('[data-search-steam]')) { await selectContentSource('steam-workshop', workshopQuery); return; } const install = event.target.closest('[data-install-workshop]'); const copy = event.target.closest('[data-copy-id]'); if (install && !install.disabled) { const id = install.dataset.installWorkshop; install.disabled = true; try { await startDownload(contentSource, id, workshopResults.find(item => item.id === id)?.title); } catch (error) { toast(`安装失败：${error.message}`); install.disabled = false; } } if (copy) { try { await navigator.clipboard.writeText(copy.dataset.copyId); toast('项目 ID 已复制'); } catch { toast('复制失败'); } } };
$('#contentSources').onclick = event => { const button = event.target.closest('[data-source]'); if (button && button.dataset.source !== contentSource) selectContentSource(button.dataset.source); };
$('#downloadList').onclick = async event => {
  const button = event.target.closest('[data-cancel-download],[data-retry-download],[data-search-download],[data-delete-download]');
  if (!button || button.disabled) return;
  button.disabled = true;
  try {
    const id = button.dataset.cancelDownload || button.dataset.retryDownload || button.dataset.searchDownload || button.dataset.deleteDownload;
    const job = downloadJobs.find(item => item.id === id);
    if (!job) return;
    if (button.hasAttribute('data-search-download')) { await selectContentSource(job.source, job.title); $('#workshopSearch').focus(); return; }
    if (button.hasAttribute('data-delete-download')) {
      if (deletingDownloads.has(id)) return;
      const active = !['completed', 'failed', 'cancelled'].includes(job.status);
      if (!confirm(`${active ? '终止下载并删除任务' : '删除任务记录'}“${job.title}”？\n已安装的地图或模组会保留。`)) return;
      deletingDownloads.add(id); renderDownloads();
      try { await post('/api/downloads/delete', { id }); downloadJobs = downloadJobs.filter(item => item.id !== id); renderDownloads(); renderWorkshopResults(); record(`删除下载任务 ${job.title}`); toast('任务已删除，已安装文件保留'); }
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
$('#copyAddress').onclick = async () => { if (!gameAddress) { toast('请先配置游戏连接地址'); return; } try { await navigator.clipboard.writeText(`connect ${gameAddress}`); toast('连接命令已复制'); } catch { toast('浏览器不允许复制'); } };
$('#sunriseTime').value = localStorage.getItem('deadAirSunrise') || '07:00'; $('#sunsetTime').value = localStorage.getItem('deadAirSunset') || '19:00';
$('#sunriseTime').onchange = $('#sunsetTime').onchange = () => { localStorage.setItem('deadAirSunrise', $('#sunriseTime').value); localStorage.setItem('deadAirSunset', $('#sunsetTime').value); if (themeMode === 'auto') applyTheme('auto'); toast('主题时段已更新'); };
$('#refreshBtn').onclick = async () => { const button = $('#refreshBtn'); button.disabled = true; button.setAttribute('aria-busy', 'true'); try { await Promise.all([loadMaps(), loadPlugins()]); await syncStatus(); toast('状态检查已完成'); } finally { button.disabled = false; button.removeAttribute('aria-busy'); } };
renderActivity(); renderWorkshop(); applyTheme(themeMode);
loadDownloads();
setInterval(() => { if (!document.hidden && (!$('#workshopView').classList.contains('hidden') || downloadJobs.some(job => !['completed', 'failed', 'cancelled'].includes(job.status)))) loadDownloads(); }, 1500);
loadConnection();
Promise.all([loadMaps(), loadPlugins()]).then(syncStatus);
setInterval(() => { if (themeMode === 'auto') applyTheme('auto'); }, 15 * 60 * 1000);

function libraryControls(busy) {
  libraryBusy = busy;
  for (const id of ['importMaps', 'importPlugins', 'reloadPlugins']) $('#' + id).disabled = busy;
  for (const button of $$('[data-delete-map],[data-delete-plugin],[data-export-map],[data-export-plugin],[data-plugin]')) button.disabled = busy;
}
function uploadLibraryFile(kind, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/' + kind + '/import?name=' + encodeURIComponent(file.name));
    xhr.setRequestHeader('content-type', 'application/octet-stream'); xhr.timeout = 30 * 60 * 1000;
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
