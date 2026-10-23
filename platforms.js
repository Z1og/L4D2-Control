// L4D2-Control project identity: l4d2-control-bf312edc896c79baad5c | SPDX-License-Identifier: LicenseRef-L4D2-Control-NonCommercial-1.0
(function () {
  let data = null, busy = false, loading = null, updateErrors = {};
  let selected = 'plugins';
  const label = { running: '正在运行', error: '加载失败', unknown: '未确认' };
  const names = { metamod: 'MetaMod:Source', sourcemod: 'SourceMod', l4dtoolz: 'L4DToolZ', stripper: 'Stripper:Source' };
  const choices = new Map();
  function chosen(item) {
    const saved = choices.get(item.id) || window.panelState?.get?.('platformVersion:' + item.id, '');
    return (item.versions || []).find(version => version.id === saved) || item.latest || item.versions?.[0] || null;
  }
  function notes(item, release) { return [item.caution, ...(release?.notes || [])].join('\n'); }
  const message = text => { $('#platformStatus').textContent = text; };
  window.selectPluginPage = value => {
    selected = !isGuest && value === 'platforms' ? 'platforms' : 'plugins';
    window.panelState?.set('pluginPage', selected);
    $('#pluginPage').hidden = selected !== 'plugins';
    $('#platformPage').hidden = selected !== 'platforms';
    for (const [id, page] of [['pluginTab', 'plugins'], ['platformTab', 'platforms']]) {
      const active = page === selected, tab = $('#' + id);
      tab.classList.toggle('active', active); tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
    }
    if (selected === 'platforms') return load();
  };
  for (const [id, page] of [['pluginTab', 'plugins'], ['platformTab', 'platforms']]) {
    $('#' + id).onclick = () => window.selectPluginPage(page);
    $('#' + id).onkeydown = event => {
      if (isGuest || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); const next = event.key === 'Home' ? 'plugins' : event.key === 'End' ? 'platforms' : selected === 'plugins' ? 'platforms' : 'plugins';
      window.selectPluginPage(next); $(next === 'plugins' ? '#pluginTab' : '#platformTab').focus();
    };
  }
  function renderDependencies() {
    const dependencies = window.pluginDependencies || data?.dependencies;
    if (!dependencies) return;
    const rows = Object.entries(dependencies.platforms).filter(([, required]) => required.length).map(([id, required]) => `<p><strong>${escapeHtml(names[id])}</strong><span>依赖 ${required.map(key => escapeHtml(names[key])).join('、')}</span></p>`);
    const plugins = dependencies.plugins || [];
    rows.push(...plugins.map(plugin => `<p><strong>${escapeHtml(plugin.name)}<small>${escapeHtml(plugin.id)}.smx</small></strong><span>依赖 SourceMod · ${plugin.enabled ? '磁盘已启用' : '磁盘已停用'}</span><button type="button" class="secondary-button" data-related-plugin="${escapeHtml(plugin.id)}">在插件管理中查看</button></p>`));
    if (!plugins.length) rows.push('<p>Left4DHooks：未在插件目录检测到。需要时请在插件管理中导入。</p>');
    $('#platformDependencies').innerHTML = rows.join('');
  }
  window.refreshPlatformDependencies = renderDependencies;
  function render() {
    if (!data) return;
    const pending = busy || data.busy;
    $('#refreshPlatforms').disabled = pending; $('#checkPlatformUpdates').disabled = pending;
    $('#platformGrid').innerHTML = data.components.map(item => {
      const required = item.requires.filter(id => !data.components.some(component => component.id === id && component.installed));
      const release = chosen(item), versions = item.versions || [];
      const disabled = pending || !data.supported || required.length || !release;
      const branches = [...new Set(versions.map(version => version.branch || '官方发行'))];
      const branch = release?.branch || branches[0];
      return `<article class="panel platform-card"><header><div><h2>${escapeHtml(item.name)}</h2><span class="platform-install-status ${item.installed ? 'installed' : ''}">${item.installed ? '已安装' : '未安装'}</span></div><span class="platform-runtime ${item.runtime.status}">${escapeHtml(label[item.runtime.status] || '未确认')}</span></header>
        <p class="platform-description">${escapeHtml(item.description)}</p>
        <dl class="platform-versions"><div><dt>磁盘版本</dt><dd>${escapeHtml(item.diskVersion || (item.installed ? '版本未知' : '—'))}</dd></div><div><dt>运行版本</dt><dd>${escapeHtml(item.runtime.version || '未取得')}</dd></div><div><dt>官方稳定版</dt><dd>${escapeHtml(item.latest?.version || '点击检查更新')}</dd></div></dl>
        <div class="platform-version-picker"><label for="platformBranch-${item.id}">分支 / 兼容构建<select id="platformBranch-${item.id}" data-platform-branch="${item.id}" ${pending || !versions.length ? 'disabled' : ''}>${branches.length ? branches.map(value => `<option value="${escapeHtml(value)}" ${value === branch ? 'selected' : ''}>${escapeHtml(value)}</option>`).join('') : '<option>请先获取版本</option>'}</select></label><label for="platformVersion-${item.id}">目标版本 <small>共 ${versions.length} 个可用构建</small><select id="platformVersion-${item.id}" data-platform-version="${item.id}" ${pending || !versions.length ? 'disabled' : ''}>${versions.length ? versions.filter(version => (version.branch || '官方发行') === branch).map(version => `<option value="${escapeHtml(version.id)}" ${version.id === release?.id ? 'selected' : ''}>${escapeHtml(version.version)}${version.recommended ? ' · 推荐' : ''}${version.channel ? ' · ' + escapeHtml(version.channel) : ''}</option>`).join('') : '<option>点击右上方获取版本</option>'}</select></label></div>
        ${release ? `<section class="platform-version-notes" aria-live="polite"><h3>${escapeHtml(release.version)} · 使用注意</h3><p class="platform-caution"><i data-lucide="info"></i><span>${escapeHtml(notes(item, release))}</span></p><details><summary>官方发行说明${release.publishedAt ? ' · ' + escapeHtml(new Date(release.publishedAt).toLocaleDateString()) : ''}</summary><pre>${escapeHtml(release.releaseNotes || '官方未提供该版本的详细说明。')}</pre></details></section>` : `<p class="platform-caution">${escapeHtml(item.caution)}</p>`}
        ${(item.catalogWarnings || []).map(warning => `<p class="platform-error">版本列表未完整：${escapeHtml(warning)}</p>`).join('')}
        ${item.restartRequired ? '<p class="platform-restart">磁盘文件已变更，需重启游戏进程后核验。</p>' : ''}
        ${required.length ? `<p class="platform-restart">请先安装 ${required.map(id => escapeHtml(names[id])).join('、')}。</p>` : ''}
        ${updateErrors[item.id] ? `<p class="platform-error">检查更新失败：${escapeHtml(updateErrors[item.id])}</p>` : ''}
        <footer><a class="secondary-button" href="${escapeHtml(item.home)}" target="_blank" rel="noopener noreferrer">使用说明<i data-lucide="external-link"></i></a><button type="button" class="primary-button" data-platform-id="${item.id}" data-platform-action="${item.installed ? 'update' : 'install'}" ${disabled ? 'disabled' : ''}>${item.installed ? '切换 / 修复所选版本' : '安装所选版本'}</button><button type="button" class="secondary-button" data-platform-id="${item.id}" data-platform-action="rollback" ${pending || !data.supported || !item.canRollback ? 'disabled' : ''}>回退</button></footer></article>`;
    }).join('');
    renderDependencies(); icons();
  }
  async function load(check = false) {
    if (isGuest || busy) return;
    if (loading) return loading;
    busy = true; render(); message(check ? '正在读取官方分支和历史发行版本，请稍候…' : '正在读取磁盘与游戏内运行状态…');
    loading = (async () => {
      try {
        data = check ? await post('/api/platforms/check', {}) : await api('/api/platforms');
        if (check) updateErrors = data.updateErrors || {};
        window.pluginDependencies = data.dependencies;
        const cachedDates = data.components.map(item => item.catalogCheckedAt).filter(Boolean).sort();
        const catalogStatus = cachedDates.length ? `版本列表来自服务器缓存（${new Date(cachedDates[0]).toLocaleString()}）；点击“获取 / 刷新版本”才会联网更新。` : '尚无版本缓存，请点击“获取 / 刷新版本”手动读取官方列表。';
        message(!data.supported ? '当前系统不支持自动安装；请在 Linux 游戏服务器本机运行面板。' : data.runtimeError || (data.busy ? '平台任务正在执行，稍后刷新查看结果。' : `状态检查：${new Date(data.checkedAt).toLocaleString()} · ${catalogStatus}`));
      } catch (error) { message('读取失败：' + error.message); }
      finally { busy = false; loading = null; render(); }
    })();
    return loading;
  }
  $('#refreshPlatforms').onclick = () => load();
  $('#checkPlatformUpdates').onclick = () => load(true);
  $('#platformGrid').onchange = event => {
    const id = event.target.dataset.platformVersion || event.target.dataset.platformBranch;
    if (!id || busy || !data || data.busy) return;
    const item = data.components.find(component => component.id === id);
    const release = event.target.dataset.platformBranch ? item?.versions.find(version => (version.branch || '官方发行') === event.target.value) : item?.versions.find(version => version.id === event.target.value);
    if (!release) return;
    choices.set(id, release.id); window.panelState?.set('platformVersion:' + id, release.id);
    const focus = event.target.id; render(); $('#' + focus)?.focus({ preventScroll: true });
    message(`已选择 ${item.name} ${release.version}，注意事项已更新；尚未修改服务器文件。`);
  };
  $('#platformDependencies').onclick = event => {
    const button = event.target.closest('[data-related-plugin]'); if (!button) return;
    window.selectPluginPage('plugins'); $('#pluginSearch').value = button.dataset.relatedPlugin;
    window.panelState?.set('input:pluginSearch', button.dataset.relatedPlugin);
    pluginFilter = 'all'; window.panelState?.set('pluginFilter', 'all'); renderPlugins();
  };
  $('#platformGrid').onclick = async event => {
    const button = event.target.closest('[data-platform-action]'); if (!button || busy || !data || data.busy) return;
    const id = button.dataset.platformId, action = button.dataset.platformAction, item = data.components.find(component => component.id === id);
    if (!item || !data.supported) return;
    const release = chosen(item); if (action !== 'rollback' && !release) return;
    const title = action === 'rollback' ? `回退 ${item.name} 的上一次文件变更` : `${action === 'install' ? '安装' : '切换 / 修复'} ${item.name} 至 ${release.version}（${release.branch || '官方发行'}）`;
    if (!confirm(`${title}？\n\n${action === 'rollback' ? item.caution : notes(item, release)}\n保留已有配置与 SMX 插件。操作后需要重启游戏进程，当前不会自动重启。${action === 'rollback' ? '\n回退后将清除这次回退记录。' : '\n包含升级和降级；只保留本次改动文件的上一版本。'}`)) return;
    busy = true; render(); message('正在' + title + '，请等待完成…');
    let result;
    try {
      result = await post('/api/platforms/action', { id, action, version: release?.version, releaseId: release?.id, confirmed: true });
      record(title); toast(result.message); await loadPlugins();
    } catch (error) { result = { message: '操作失败：' + error.message }; toast(result.message); }
    finally { busy = false; await load(); if (result) message(result.message); }
  };
})();
