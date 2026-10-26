(function () {
  const root = document.getElementById('broadcastView');
  if (!root) return;
  const el = id => document.getElementById(id), memory = window.panelState;
  const read = (key, fallback) => memory?.get('radio:' + key, fallback) ?? fallback;
  const store = (key, value) => memory?.set('radio:' + key, value);
  const e = escapeHtml, names = { classic: '经典地图', recent: '近期更新', candidate: '待核验条目', guide: '网络攻略', review: '地图测评', qa: '问题答疑' };
  const date = value => value ? new Date(value).toLocaleDateString('zh-CN') : '';
  let tab = read('tab', 'maps') === 'guides' ? 'guides' : 'maps';
  let filter = '', tag = '', page = 1, data = null, loading = null, editing = null, detail = null, saving = false;
  const savedFavorites = read('favorites', []), favorites = new Set(Array.isArray(savedFavorites) ? savedFavorites.filter(id => typeof id === 'string').slice(0, 1000) : []);
  function restoreFilters() {
    const allowed = tab === 'maps' ? ['classic', 'recent', 'favorites', ...(isGuest ? [] : ['candidate'])] : ['all', 'guide', 'review', 'qa', 'favorites'];
    const saved = read('filter:' + tab, allowed[0]); filter = allowed.includes(saved) ? saved : allowed[0];
    tag = read('tag:' + tab, '');
    page = Math.max(1, Math.min(1000, Number(read('page:' + tab, 1)) || 1));
  }
  restoreFilters();
  function entries() { return [...(data?.entries || []), ...(data?.feeds.maps.items || []), ...(isGuest ? [] : data?.feeds.maps.reviewItems || []), ...(data?.feeds.guides.items || [])]; }
  const isMap = item => ['classic', 'recent', 'candidate'].includes(item.kind);
  function sourceLink(item, label) { return item.url ? `<a class="text-button" href="${e(item.url)}" target="_blank" rel="noopener noreferrer">${label || (item.linkType === 'search' ? '查找地图版本' : item.source?.startsWith('项目整理') ? '参考资料' : '查看原文')} <i data-lucide="arrow-up-right"></i></a>` : ''; }
  function meta(item) {
    return [item.source, item.author && `作者：${item.author}`, ['recent', 'candidate'].includes(item.kind) ? `项目更新：${date(item.updatedAt)}${item.isNew ? ' · 新发布' : ''}` : item.updatedAt ? `记录更新：${date(item.updatedAt)}` : '', item.verifiedAt ? `验证：${item.verifiedAt}` : ''].filter(Boolean).join(' · ');
  }
  function render() {
    root.querySelectorAll('[data-radio-tab]').forEach(button => {
      const active = button.dataset.radioTab === tab; button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1;
    });
    el('broadcastMapsPage').classList.toggle('hidden', tab !== 'maps'); el('broadcastGuidesPage').classList.toggle('hidden', tab !== 'guides');
    root.querySelectorAll('[data-radio-filter]').forEach(button => { const active = button.dataset.radioFilter === filter; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
    el('broadcastIntroTitle').textContent = tab === 'maps' ? '好地图，值得一起出发' : '把经验留给下一位生还者';
    el('broadcastIntroText').textContent = tab === 'maps' ? '精选经典战役，关注近一个月的地图更新。' : '攻略有出处，问题有解法。收藏好内容，记录已验证的经验。';
    const all = entries(), subset = all.filter(item => isMap(item) === (tab === 'maps'));
    el('broadcastStats').innerHTML = tab === 'maps' ? `<span><b>${all.filter(x => x.kind === 'classic').length}</b>经典推荐</span><span><b>${data?.feeds.maps.items.length || 0}</b>近期条目</span>` : `<span><b>${all.filter(x => ['guide', 'review'].includes(x.kind)).length}</b>攻略测评</span><span><b>${all.filter(x => x.kind === 'qa').length}</b>问题答疑</span>`;
    const categoryRows = subset.filter(item => filter === 'all' || filter === 'favorites' ? filter !== 'favorites' || favorites.has(item.id) : item.kind === filter);
    const tags = [...new Set(categoryRows.flatMap(item => item.tags || []))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
    if (!tags.includes(tag)) tag = '';
    el('broadcastTag').innerHTML = '<option value="">全部标签</option>' + tags.map(value => `<option value="${e(value)}">${e(value)}</option>`).join(''); el('broadcastTag').value = tag;
    const query = el('broadcastSearch').value.trim().toLowerCase();
    const rows = categoryRows.filter(item => (!tag || item.tags?.includes(tag)) && (!query || [item.title, item.english, item.summary, item.content, item.map, item.author, item.source, ...(item.tags || [])].join(' ').toLowerCase().includes(query))).sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));
    const pages = Math.max(1, Math.ceil(rows.length / 12)); page = Math.min(page, pages); store('page:' + tab, page);
    el('broadcastList').innerHTML = rows.slice((page - 1) * 12, page * 12).map(item => `<article class="radio-card${isMap(item) ? ' radio-map-card' : ''}"><div class="radio-card-top"><span class="radio-pill ${item.kind === 'recent' && item.isNew ? 'radio-new' : ''}">${item.pinned ? '置顶 · ' : ''}${item.kind === 'recent' && item.isNew ? '近期新发布' : names[item.kind]}</span><button class="icon-button small radio-favorite${favorites.has(item.id) ? ' active' : ''}" data-radio-favorite="${e(item.id)}" aria-label="${favorites.has(item.id) ? '取消收藏' : '收藏'} ${e(item.title)}" aria-pressed="${favorites.has(item.id)}" title="${favorites.has(item.id) ? '取消收藏' : '收藏'}"><i data-lucide="bookmark"></i></button></div><h3><button data-radio-detail="${e(item.id)}">${e(item.title)}</button></h3>${item.english && item.english !== item.title ? `<p class="radio-english">${e(item.english)}</p>` : ''}<p class="radio-summary">${e(item.summary || item.content?.slice(0, 180) || '打开详情查看来源和说明。')}</p><div class="radio-tags">${(item.tags || []).slice(0, 4).map(t => `<span>${e(t)}</span>`).join('')}</div>${item.map && !isMap(item) ? `<p class="radio-meta">关联地图：${e(item.map)}</p>` : ''}<p class="radio-meta">${e(meta(item) || '经典入门清单 · 可由管理员调整')}</p><div class="radio-card-actions"><button class="text-button" data-radio-detail="${e(item.id)}">查看详情 <i data-lucide="arrow-right"></i></button>${sourceLink(item)}${!isGuest && data.entries.some(x => x.id === item.id) ? `<button class="text-button" data-radio-edit="${e(item.id)}" aria-label="编辑 ${e(item.title)}">编辑</button>` : ''}</div></article>`).join('') || `<div class="radio-empty"><i data-lucide="${filter === 'favorites' ? 'bookmark' : 'radio'}"></i><h3>${!data ? '暂时无法读取广播' : filter === 'favorites' ? '这里还没有收藏' : query || tag ? '没有找到匹配内容' : filter === 'recent' ? '暂无近一个月更新条目' : '暂无收录内容'}</h3><p>${!data ? '点击“读取已存内容”重试。' : filter === 'favorites' ? '点击卡片右上角书签，把想看的内容留在这里。' : query || tag ? '试试其他关键词，或清除搜索和标签。' : filter === 'recent' ? '管理员可点击“更新地图资讯”读取 Steam 最新战役目录。' : '管理员可收录来源链接，或写下一条解决方案。'}</p></div>`;
    el('broadcastResultCount').textContent = `${rows.length} 条内容`; el('broadcastPageNumber').textContent = `${page} / ${pages}`;
    el('broadcastPrev').disabled = page <= 1; el('broadcastNext').disabled = page >= pages;
    const feedName = tab === 'maps' ? 'maps' : 'guides', feed = data?.feeds[feedName];
    el('broadcastFeedStatus').textContent = feed ? [feed.updatedAt ? `网络资讯采集于 ${new Date(feed.updatedAt).toLocaleString('zh-CN')}` : '尚未采集网络资讯', feed.scope || (tab === 'maps' ? '经典清单可由管理员维护；近一个月以地图更新时间计算。' : '网络链接保留作者与出处；自定义答疑可补充版本和验证日期。'), feed.error ? `上次更新失败：${feed.error}。已保留原有内容。` : ''].join(' · ') : '正在读取广播内容…';
    el('refreshBroadcastFeed').disabled = Boolean(feed?.refreshing); el('refreshBroadcastFeed').innerHTML = `<i data-lucide="${feed?.refreshing ? 'loader-circle' : 'cloud-download'}"></i>${feed?.refreshing ? '正在采集…' : tab === 'maps' ? '更新地图资讯' : '更新网络攻略'}`;
    const keyword = `求生之路2 ${el('broadcastSearch').value.trim() || '地图攻略'}`;
    el('radioBiliSearch').href = 'https://search.bilibili.com/all?keyword=' + encodeURIComponent(keyword);
    el('radioHeyboxSearch').href = 'https://www.xiaoheihe.cn/app/bbs/home';
    icons();
  }
  function error(message = '') { el('broadcastError').textContent = message; el('broadcastError').classList.toggle('hidden', !message); }
  async function load(force = false) {
    if (loading) return loading;
    if (data && !force) { render(); return; }
    loading = (async () => {
      el('reloadBroadcast').disabled = true;
      try { data = await api('/api/broadcast'); error(); }
      catch (failure) { error(`读取失败：${failure.message}`); }
      finally { loading = null; el('reloadBroadcast').disabled = false; render(); }
    })(); return loading;
  }
  window.loadBroadcast = load;
  function selectTab(value) { tab = value; store('tab', tab); restoreFilters(); render(); }
  el('broadcastTabs').addEventListener('click', event => { const button = event.target.closest('[data-radio-tab]'); if (button) selectTab(button.dataset.radioTab); });
  el('broadcastTabs').addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); selectTab(event.key === 'Home' ? 'maps' : event.key === 'End' ? 'guides' : tab === 'maps' ? 'guides' : 'maps'); el(tab === 'maps' ? 'broadcastMapsTab' : 'broadcastGuidesTab').focus();
  });
  root.addEventListener('click', event => {
    const button = event.target.closest('[data-radio-filter]');
    if (button) { filter = button.dataset.radioFilter; page = 1; store('filter:' + tab, filter); render(); }
  });
  el('broadcastSearch').addEventListener('input', () => { page = 1; render(); });
  el('broadcastTag').addEventListener('change', () => { tag = el('broadcastTag').value; page = 1; store('tag:' + tab, tag); render(); });
  el('broadcastPrev').onclick = () => { page--; render(); };
  el('broadcastNext').onclick = () => { page++; render(); };
  el('reloadBroadcast').onclick = () => load(true);
  el('refreshBroadcastFeed').onclick = async () => {
    const feed = tab === 'maps' ? 'maps' : 'guides', button = el('refreshBroadcastFeed'); button.disabled = true; error();
    if (data) data.feeds[feed].refreshing = true; render();
    try { data = await post('/api/broadcast/refresh', { feed }); toast(feed === 'maps' ? '地图资讯已更新' : '网络攻略已更新'); }
    catch (failure) { await load(true); error(failure.message); }
    finally { if (data) data.feeds[feed].refreshing = false; button.disabled = false; render(); }
  };
  function favorite(id) { if (favorites.has(id)) favorites.delete(id); else { if (favorites.size >= 1000) { toast('收藏已达 1000 条，请先整理'); return; } favorites.add(id); } store('favorites', [...favorites]); render(); if (detail?.id === id) showDetail(id, false); }
  function showDetail(id, open = true) {
    const item = entries().find(x => x.id === id); if (!item) return; detail = item;
    el('broadcastDetailTitle').textContent = item.title; el('broadcastDetailKind').textContent = names[item.kind]; el('broadcastDetailMeta').textContent = meta(item);
    el('broadcastDetailBody').textContent = [item.english && item.english !== item.title ? item.english : '', item.content || item.summary, item.applicability ? `适用条件：${item.applicability}` : '', item.verifiedAt ? `管理员记录的验证日期：${item.verifiedAt}` : '', item.kind === 'recent' ? `项目发布：${date(item.publishedAt) || '未知'}\n项目更新：${date(item.updatedAt)}\n请查看作者说明，确认完整分包、依赖与适用玩法。` : item.kind === 'candidate' ? '作者标注了战役分类，但缺少明确的地图说明，尚不能确认为地图。核对作者页面后，可以收录为经典地图或移除资讯。' : '', item.linkType === 'search' ? '此链接打开地图名称搜索，请核对作者、版本与全部分包。' : ''].filter(Boolean).join('\n\n');
    const map = (item.map || (isMap(item) ? item.english || item.title : '')).toLowerCase();
    const related = map ? entries().filter(x => x.id !== id && x.map && (x.map.toLowerCase().includes(map) || map.includes(x.map.toLowerCase()))).slice(0, 8) : [];
    el('broadcastRelated').innerHTML = related.length ? '<h3>关联内容</h3>' + related.map(x => `<button class="text-button" data-radio-detail="${e(x.id)}">${e(x.title)} <i data-lucide="arrow-right"></i></button>`).join('') : '';
    const own = data.entries.some(x => x.id === id);
    el('broadcastDetailActions').innerHTML = sourceLink(item) + `<button class="secondary-button" data-radio-favorite="${e(id)}"><i data-lucide="bookmark"></i>${favorites.has(id) ? '取消收藏' : '收藏'}</button>` + (isGuest ? '' : `${isMap(item) ? `<button class="primary-button" data-radio-download="${e(id)}"><i data-lucide="search"></i>查找下载项</button>` : ''}<button class="secondary-button" data-radio-edit="${e(id)}">${own ? '编辑内容' : isMap(item) ? '收录为经典' : '收录并补充'}</button><button class="danger-button" data-radio-delete="${e(id)}">${own ? '删除' : '移除资讯'}</button>`);
    if (open && !el('broadcastDetailDialog').open) el('broadcastDetailDialog').showModal(); icons();
  }
  function edit(id) {
    if (isGuest || saving) return;
    const item = entries().find(x => x.id === id), own = item && data.entries.some(x => x.id === id);
    editing = own ? id : null;
    const form = el('broadcastForm'); form.reset();
    const values = item ? { ...item, kind: ['recent', 'candidate'].includes(item.kind) ? 'classic' : item.kind, map: item.map || (isMap(item) ? item.english || item.title : ''), tags: (item.tags || []).slice(0, 8).join('，') } : { kind: tab === 'maps' ? 'classic' : filter === 'review' ? 'review' : 'qa' };
    for (const [key, value] of Object.entries(values)) { const field = form.elements.namedItem(key); if (!field) continue; if (field.type === 'checkbox') field.checked = Boolean(value); else field.value = value || ''; }
    el('broadcastEditorTitle').textContent = own ? '编辑收录内容' : '收录内容'; el('broadcastSaveError').textContent = '';
    if (el('broadcastDetailDialog').open) el('broadcastDetailDialog').close(); el('broadcastEditor').showModal();
  }
  async function handleAction(event) {
    const button = event.target.closest('[data-radio-detail],[data-radio-favorite],[data-radio-edit],[data-radio-delete],[data-radio-download]'); if (!button) return;
    if (button.dataset.radioDetail) { showDetail(button.dataset.radioDetail); return; }
    if (button.dataset.radioFavorite) { favorite(button.dataset.radioFavorite); return; }
    if (isGuest) return;
    if (button.dataset.radioEdit) { edit(button.dataset.radioEdit); return; }
    if (button.dataset.radioDelete) {
      const id = button.dataset.radioDelete, item = entries().find(x => x.id === id);
      if (!await window.PanelDialogs.confirm(`删除“${item.title}”？\n此操作只删除广播收录记录。`, { title: '删除收录内容', danger: true, confirmLabel: '确认删除' })) return;
      button.disabled = true;
      try { data = await post('/api/broadcast/delete', { id, confirmed: true }); el('broadcastDetailDialog').close(); render(); toast('收录内容已删除'); }
      catch (failure) { toast(failure.message); button.disabled = false; } return;
    }
    const item = entries().find(x => x.id === button.dataset.radioDownload);
    el('broadcastDetailDialog').close(); selectContentSection('maps'); selectContentSource('steam-workshop', item.english || item.title); navigate('workshop'); await searchWorkshop(item.english || item.title);
  }
  el('broadcastList').addEventListener('click', handleAction); el('broadcastDetailDialog').addEventListener('click', handleAction);
  el('closeBroadcastDetail').onclick = () => el('broadcastDetailDialog').close();
  el('addBroadcast').onclick = () => edit();
  const closeEditor = () => { if (!saving) el('broadcastEditor').close(); };
  el('closeBroadcastEditor').onclick = closeEditor; el('cancelBroadcastEditor').onclick = closeEditor;
  el('broadcastEditor').addEventListener('cancel', event => { if (saving) event.preventDefault(); });
  el('broadcastForm').onsubmit = async event => {
    event.preventDefault(); if (isGuest || saving) return;
    const form = event.currentTarget, payload = Object.fromEntries(new FormData(form));
    payload.tags = String(payload.tags || '').split(/[,，]/).map(x => x.trim()).filter(Boolean); payload.pinned = form.elements.pinned.checked;
    if (editing) payload.id = editing;
    const existing = data?.entries.find(x => x.id === editing); if (existing?.linkType === 'search' && payload.url === existing.url) payload.linkType = 'search';
    saving = true; el('saveBroadcast').disabled = true; el('broadcastSaveError').textContent = '';
    try { data = await post('/api/broadcast/save', payload); el('broadcastEditor').close(); tab = payload.kind === 'classic' ? 'maps' : 'guides'; store('tab', tab); filter = payload.kind; store('filter:' + tab, filter); tag = ''; store('tag:' + tab, ''); page = 1; el('broadcastSearch').value = ''; el('broadcastSearch').dispatchEvent(new Event('input', { bubbles: true })); render(); toast('内容已保存'); }
    catch (failure) { el('broadcastSaveError').textContent = failure.message; }
    finally { saving = false; el('saveBroadcast').disabled = false; }
  };
  el('broadcastForm').elements.url.addEventListener('change', event => {
    const field = el('broadcastForm').elements.source;
    if (field.value) return;
    try { const host = new URL(event.target.value).hostname; field.value = /(^|\.)bilibili\.com$|^b23\.tv$/.test(host) ? 'B 站' : /(^|\.)(xiaoheihe\.cn|heybox\.com)$/.test(host) ? '小黑盒' : host === 'steamcommunity.com' ? 'Steam 社区' : host; } catch { /* The server validates the entered URL on save. */ }
  });
  el('exportBroadcast').onclick = () => {
    if (!data || isGuest) return;
    const blob = new Blob([JSON.stringify({ schema: 1, exportedAt: new Date().toISOString(), entries: data.entries }, null, 2)], { type: 'application/json' }), url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = `L4D2-Control-无线广播-${new Date().toISOString().slice(0, 10)}.json`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
})();
