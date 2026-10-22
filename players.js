let playerBatchMode = false, playerActionBusy = false, playerAction = null, restartBusy = false, restartTimer = null;
const selectedPlayers = new Set();
let playerData = null, playerTab = 'online', playerLoading = false, playerSaving = false, playerReturnFocus = null;
const playerTeam = team => ({ 1: '旁观者', 2: '生还者', 3: '感染者' })[team] || '连接中';
const playerTime = value => value ? new Date(value).toLocaleString() : '尚未记录';
function playerDuration(seconds) { const n = Math.max(0, Math.floor(seconds || 0)); return n >= 3600 ? `${Math.floor(n / 3600)} 小时 ${Math.floor(n % 3600 / 60)} 分` : `${Math.floor(n / 60)} 分 ${n % 60} 秒`; }
function renderPlayers() {
  const data = playerData;
  $('#playerOnlineCount').textContent = data?.available ? data.onlineCount : '—';
  $('#overviewPlayerCount').textContent = data?.available ? data.onlineCount : '未连接';
  $('#overviewPlayerHint').textContent = data?.available ? `真人玩家 · ${data.bots} 个机器人不计入` : '等待游戏玩家采集插件响应';
  $('#playerBotCount').textContent = data?.available ? data.bots : '—';
  $('#playerHistoryCount').textContent = data?.total ?? '—';
  const admins = data?.players.filter(p => p.flags || p.permissionSource !== 'none') || [];
  $('#playerAdminCount').textContent = data ? admins.length : '—';
  $('#addPlayerAdmin').disabled = !data?.available || Boolean(data?.configError) || playerSaving;
  const status = $('#playerStatus');
  status.className = 'player-status' + (data && !data.available || data?.configError ? ' warning' : '');
  status.textContent = !data ? '正在连接玩家采集插件…' : [data.available ? `实时数据更新于 ${playerTime(data.checkedAt)} · 每 5 秒自动刷新` : data.reason, data.configError, data.historyError, data.moderationError, data.available && !data.moderationAvailable ? '玩家处置插件未就绪' : ''].filter(Boolean).join(' · ');
  if (!data) { $('#playerList').innerHTML = '<div class="player-empty">正在读取玩家数据…</div>'; return; }
  const query = $('#playerSearch').value.trim().toLowerCase();
  let rows = playerRows();
  rows = rows.filter(p => `${p.name} ${p.steam2} ${p.steam3} ${p.steam64}`.toLowerCase().includes(query));
  $('#playerListTitle').textContent = { online: '当前在线', history: '玩家记录', panel: '面板账号', admins: '管理员权限', banned: '已拉黑玩家' }[playerTab];
  $('#playerListCount').textContent = `${rows.length} 位玩家`;
  $('#playerList').innerHTML = rows.length ? rows.map(p => {
    const profile = data.profiles.find(x => x.flags === p.flags);
    const role = p.permissionSource === 'external' ? '外部配置管理员' : p.permissionSource === 'runtime' ? '其他来源权限' : p.flags ? profile?.name || '自定义管理员' : '普通玩家';
    const live = p.online ? `${playerTeam(p.team)} · ${p.ping} ms · 已连接 ${playerDuration(p.connectedSeconds)}` : `最后出现：${playerTime(p.lastSeen)}`;
    return `<article class="player-row">${playerBatchMode && playerTab !== 'admins' ? `<label class="player-select"><input type="checkbox" data-player-select="${p.steam64}" aria-label="选择 ${escapeHtml(p.name)}" ${selectedPlayers.has(p.steam64) ? 'checked' : ''} ${playerActionBusy ? 'disabled' : ''}></label>` : ''}<div class="player-avatar ${p.online ? 'online' : ''}"><i data-lucide="user-round"></i></div><div class="player-main"><div class="player-name-line"><h3>${escapeHtml(p.name)}</h3><span class="player-state ${p.online ? 'online' : ''}">${p.online ? '在线' : data.available ? '离线' : '在线状态未知'}</span></div><p>${escapeHtml(live)}</p><div class="player-identities"><code>${escapeHtml(p.steam2)}</code><code>${escapeHtml(p.steam64)}</code><button class="player-copy" data-player-copy="${escapeHtml(p.steam64)}" aria-label="复制 ${escapeHtml(p.name)} 的 SteamID64"><i data-lucide="copy"></i>复制 ID</button></div><small>首次记录：${playerTime(p.firstSeen)}</small>${p.panelAccount ? `<small>面板账号 · ${escapeHtml(p.panelName)} · 资料归属未验证 · 登录 ${p.loginCount || 0} 次</small><small>最近登录：${playerTime(p.lastLoginAt)}</small>` : ''}${p.lastLoginIp ? `<small class="player-network">面板 IP：<code>${escapeHtml(p.lastLoginIp)}</code> · ${escapeHtml(p.lastLoginRegion?.label || '未知省份')}</small>` : ''}${p.gameIp ? `<small class="player-network">游戏 IP：<code>${escapeHtml(p.gameIp)}</code> · ${escapeHtml(p.gameRegion?.label || '未知省份')}</small>` : ''}${p.ban ? `<small class="player-ban-expiry">已拉黑 · 到期：${playerTime(p.ban.expiresAt)}</small>` : ''}${p.readOnlyReason ? `<small class="player-config-note">${escapeHtml(p.readOnlyReason)}</small>` : ''}</div><div class="player-role"><strong>${escapeHtml(role)}</strong><span>${p.flags ? `标记 ${escapeHtml(p.flags)} · 免疫 ${p.immunity}` : '没有面板管理授权'}</span>${p.online && p.managed ? `<small>游戏实际标记：${escapeHtml(p.runtimeFlags || '无')}</small>` : ''}<button class="secondary-button" data-player-edit="${escapeHtml(p.steam64)}" ${p.readOnly || !data.available || playerSaving ? 'disabled' : ''}><i data-lucide="shield-check"></i>${p.managed ? '修改 / 撤销权限' : '设置权限'}</button><div class="player-row-actions">${playerActionButtons(p)}</div></div></article>`;
  }).join('') : `<div class="player-empty"><i data-lucide="users"></i><h3>${query ? '没有匹配的玩家' : playerTab === 'online' ? data.available ? '当前没有真人玩家在线' : '暂时无法确认在线玩家' : playerTab === 'banned' ? '暂无已拉黑玩家' : playerTab === 'admins' ? '暂无管理员记录' : '尚未记录玩家'}</h3><p>${playerTab === 'online' && !query ? '机器人不会被记录为 Steam 玩家。真实玩家加入后，会自动记录身份与最近在线时间。' : '可用昵称、SteamID2、SteamID3 或 SteamID64 搜索。'}</p></div>`;
  $('#playerAudit').innerHTML = data.audit.length ? data.audit.map(a => `<div class="player-audit-row"><time>${playerTime(a.at)}</time><code>${escapeHtml(a.steam2)}</code><span>${escapeHtml(a.before || '普通玩家')} → ${escapeHtml(a.after || '普通玩家')} · 免疫 ${a.immunity}</span></div>`).join('') : '<p class="player-audit-empty">尚无面板权限变更。已有管理员不会被自动修改。</p>';
  const actionNames = {login:'登录',register:'注册','login-denied':'登录被拒绝','register-denied':'注册被拒绝','/api/openlist/map-download-info':'生成地图直连下载','/api/players/moderation':'玩家处置','/api/server/restart':'重启服务器','/api/map':'切换地图','/api/plugin':'切换插件','/api/players/permissions':'修改游戏权限'};
  $('#accessAudit').innerHTML = (data.accessEvents || []).map(event => '<div class="player-access-row"><time>' + playerTime(event.at) + '</time><strong>' + escapeHtml(event.actor || event.steam64 || '未登录') + '</strong><span>' + escapeHtml(actionNames[event.action] || event.action) + ' · ' + (event.ok ? '成功' : '未完成') + '</span><code>' + escapeHtml(event.steam64 || '') + '</code><span>' + escapeHtml(event.ip || '未知 IP') + ' · ' + escapeHtml(event.region?.label || '未知省份') + '</span>' + (event.target ? '<small>' + escapeHtml(event.target) + '</small>' : '') + '</div>').join('') || '<p class="player-audit-empty">尚无面板登录和操作记录。</p>';
  syncPlayerSelection(); icons();
}
async function loadPlayers() {
  if (typeof isGuest !== 'undefined' && isGuest || playerLoading) return;
  playerLoading = true; $('#refreshPlayers').disabled = true;
  try { playerData = await api('/api/players'); renderPlayers(); }
  catch (e) { playerData = { ...(playerData || { players: [], profiles: [], flags: [], audit: [], total: 0 }), available: false, onlineCount: null, reason: `读取失败：${e.message}。下方为历史记录，不代表当前在线状态。`, players: (playerData?.players || []).map(p => ({ ...p, online: false })) }; renderPlayers(); }
  finally { playerLoading = false; $('#refreshPlayers').disabled = false; }
}
function selectedPlayerFlags() { return $$('#playerFlagChoices input:checked').map(x => x.value).join(''); }
function syncPlayerFlags() {
  const flags = selectedPlayerFlags(); $('#playerFlagSummary').textContent = flags || '无管理员权限';
  $('#playerRootWarning').hidden = !flags.includes('z');
  $('#playerRootConfirm').checked = false;
  $('#playerImmunity').disabled = !flags || playerSaving;
  $('#playerProfile').value = playerData.profiles.find(p => p.flags === flags)?.id || 'custom';
}
function openPlayerPermission(steam64 = '') {
  if (!playerData?.available || playerData.configError || playerSaving) return;
  const player = playerData.players.find(p => p.steam64 === steam64);
  if (player?.readOnly) return toast(player.readOnlyReason);
  playerReturnFocus = document.activeElement;
  $('#playerPermissionTitle').textContent = player ? `管理 ${player.name} 的权限` : '按 SteamID 设置权限';
  $('#playerSteamId').value = player?.steam64 || ''; $('#playerSteamId').readOnly = Boolean(player);
  $('#playerImmunity').value = player?.immunity ?? 10;
  $('#playerProfile').innerHTML = playerData.profiles.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('') + '<option value="custom">自定义权限</option>';
  $('#playerFlagChoices').innerHTML = playerData.flags.map(f => `<label class="player-flag-option"><input type="checkbox" value="${f.flag}" ${player?.flags.includes(f.flag) ? 'checked' : ''}><span><b>${escapeHtml(f.label)}</b><code>${f.flag}</code></span></label>`).join('');
  $('#playerPermissionMessage').textContent = ''; syncPlayerFlags();
  $('#playerPermissionDialog').showModal();
}
$('#refreshPlayers').onclick = loadPlayers;
$('#playerSearch').oninput = () => { selectedPlayers.clear(); renderPlayers(); };
$('#playerTabs').onclick = e => { const b = e.target.closest('[data-player-tab]'); if (!b) return; playerTab = b.dataset.playerTab; selectedPlayers.clear(); $$('#playerTabs button').forEach(x => { x.classList.toggle('active', x === b); x.setAttribute('aria-pressed', String(x === b)); }); renderPlayers(); };
$('#playerList').onclick = async e => { const action = e.target.closest('[data-player-action]'); if (action && !action.disabled) { openPlayerModeration(action.dataset.playerAction, [action.dataset.playerId]); return; } const copy = e.target.closest('[data-player-copy]'); if (copy) { try { await navigator.clipboard.writeText(copy.dataset.playerCopy); toast('SteamID64 已复制'); } catch { prompt('复制 SteamID64', copy.dataset.playerCopy); } return; } const edit = e.target.closest('[data-player-edit]'); if (edit && !edit.disabled) openPlayerPermission(edit.dataset.playerEdit); };
$('#addPlayerAdmin').onclick = () => openPlayerPermission();
$('#closePlayerPermission').onclick = () => { if (!playerSaving) $('#playerPermissionDialog').close(); };
$('#cancelPlayerPermission').onclick = () => { if (!playerSaving) $('#playerPermissionDialog').close(); };
$('#playerPermissionDialog').addEventListener('cancel', e => { if (playerSaving) e.preventDefault(); });
$('#playerPermissionDialog').addEventListener('close', () => playerReturnFocus?.isConnected && playerReturnFocus.focus());
$('#playerFlagChoices').onchange = syncPlayerFlags;
$('#playerProfile').onchange = () => { const profile = playerData.profiles.find(p => p.id === $('#playerProfile').value); if (!profile) return; $$('#playerFlagChoices input').forEach(x => x.checked = profile.flags.includes(x.value)); syncPlayerFlags(); };
$('#playerPermissionForm').onsubmit = async e => {
  e.preventDefault(); if (playerSaving) return;
  const flags = selectedPlayerFlags(), steamId = $('#playerSteamId').value.trim();
  if (flags.includes('z') && !$('#playerRootConfirm').checked) { $('#playerPermissionMessage').textContent = '请先确认最高权限授权'; return; }
  if (!confirm(`确认${flags ? '设置' : '撤销面板授予的'}游戏内管理员权限？\nSteamID：${steamId}\n权限标记：${flags || '无'}\n将重载 SourceMod 管理员缓存，不重启游戏。`)) return;
  playerSaving = true; $$('#playerPermissionForm button, #playerPermissionForm input, #playerPermissionForm select').forEach(x => x.disabled = true); $('#closePlayerPermission').disabled = true;
  try { const result = await post('/api/players/permissions', { steamId, flags, immunity: flags ? Number($('#playerImmunity').value) : 0, confirmRoot: $('#playerRootConfirm').checked }); toast(result.message); record(`更新玩家权限 ${result.steam2}：${result.flags || '普通玩家'}`); $('#playerPermissionDialog').close(); await loadPlayers(); }
  catch (error) { $('#playerPermissionMessage').textContent = error.message; }
  finally { playerSaving = false; $$('#playerPermissionForm button, #playerPermissionForm input, #playerPermissionForm select').forEach(x => x.disabled = false); $('#closePlayerPermission').disabled = false; $('#playerImmunity').disabled = !selectedPlayerFlags(); renderPlayers(); }
};
loadPlayers();
setInterval(() => { if (!document.hidden && (!$('#playersView').classList.contains('hidden') || !$('#overviewView').classList.contains('hidden')) && !$('#playerPermissionDialog').open && !$('#playerModerationDialog').open && !playerActionBusy) loadPlayers(); }, 5000);

function playerRows() {
  if (!playerData) return [];
  const bans = new Map((playerData.bans || []).map(ban => [ban.steam64, ban]));
  const rows = playerTab === 'banned' ? (playerData.bans || []).map(ban => ({ flags: '', permissionSource: 'none', online: false, readOnly: true, ...playerData.players.find(player => player.steam64 === ban.steam64), ...ban, ban })) : playerData.players.map(player => ({ ...player, ban: bans.get(player.steam64) }));
  const query = $('#playerSearch').value.trim().toLowerCase();
  return rows.filter(player => (playerTab !== 'online' || player.online) && (playerTab !== 'panel' || player.panelAccount) && (playerTab !== 'admins' || player.flags || player.permissionSource !== 'none') && `${player.name} ${player.steam2} ${player.steam3} ${player.steam64}`.toLowerCase().includes(query));
}
function playerActionButtons(player) {
  const disabled = !playerData?.available || !playerData?.moderationAvailable || playerActionBusy ? 'disabled' : '';
  const button = (action, label, danger = false) => `<button class="${danger ? 'danger-button' : 'secondary-button'}" data-player-action="${action}" data-player-id="${player.steam64}" ${disabled}>${label}</button>`;
  if (playerTab === 'banned') return button('duration', '修改时长') + button('unban', '取消拉黑');
  return (player.online ? button('kick', '踢出', true) : '') + (player.ban ? button('duration', '修改拉黑时间') : button('ban', '拉黑', true));
}
function syncPlayerSelection() {
  const rows = playerRows(), visible = new Set(rows.map(player => player.steam64));
  for (const id of selectedPlayers) if (!visible.has(id)) selectedPlayers.delete(id);
  $('#playerBanCount').textContent = String(playerData?.bans?.length || 0);
  $('#playerBulkMode').disabled = playerTab === 'admins' || playerActionBusy;
  $('#playerBulkActions').classList.toggle('hidden', !playerBatchMode || playerTab === 'admins');
  $('#playerSelectedCount').textContent = `已选 ${selectedPlayers.size} 位`;
  $('#playerSelectAll').checked = rows.length > 0 && rows.every(player => selectedPlayers.has(player.steam64));
  $('#playerSelectAll').indeterminate = selectedPlayers.size > 0 && !$('#playerSelectAll').checked;
  $('#playerSelectAll').disabled = playerActionBusy || !rows.length;
  const banned = playerTab === 'banned', disabled = !selectedPlayers.size || !playerData?.available || !playerData?.moderationAvailable || playerActionBusy;
  for (const id of ['bulkKickPlayers', 'bulkBanPlayers', 'bulkBanDuration', 'bulkUnbanPlayers']) $('#' + id).disabled = disabled;
  $('#bulkKickPlayers').classList.toggle('hidden', playerTab !== 'online'); $('#bulkBanPlayers').classList.toggle('hidden', banned);
  $('#bulkBanDuration').classList.toggle('hidden', !banned); $('#bulkUnbanPlayers').classList.toggle('hidden', !banned);
}
function setPlayerActionMode(mode) {
  playerAction.mode = mode;
  const kick = mode === 'kick';
  $('#playerModerationTitle').textContent = ({ kick: '确认踢出玩家？', ban: '确认拉黑玩家？', 'kick-ban': '踢出并拉黑玩家', duration: '修改拉黑时间', unban: '确认取消拉黑？' })[mode];
  $('#playerModerationIntro').textContent = kick ? '仅踢出允许玩家重新连接；选择“踢出和拉黑”后可设置禁止加入的时间。' : mode === 'unban' ? '解除所选玩家的面板拉黑记录，其他插件的封禁不会被修改。' : '请选择拉黑时间。从本次确认重新计时，到期自动解除；在线玩家会断开。';
  $('#playerBanDurationField').hidden = !['ban', 'kick-ban', 'duration'].includes(mode);
  $('#kickOnlyPlayers').hidden = !kick; $('#kickAndBanPlayers').hidden = !kick; $('#confirmPlayerModeration').hidden = kick;
  $('#confirmPlayerModeration').textContent = ({ ban: '确认拉黑', 'kick-ban': '确认踢出并拉黑', duration: '确认修改时长', unban: '确认取消拉黑' })[mode] || '确认';
}
function openPlayerModeration(mode, ids) {
  if (playerActionBusy || !playerData?.moderationAvailable || !playerData.available || !ids.length) return;
  if (ids.length > 100) return toast('每次最多选择 100 位玩家');
  const known = new Map([...playerData.players, ...(playerData.bans || [])].map(player => [player.steam64, player]));
  const targets = [...new Set(ids)].map(id => known.get(id)).filter(Boolean); if (!targets.length) return;
  playerAction = { ids: targets.map(player => player.steam64), focus: document.activeElement, mode };
  $('#playerModerationTargets').innerHTML = targets.map(player => `<li><strong>${escapeHtml(player.name)}</strong><code>${player.steam64}</code></li>`).join('');
  $('#playerBanDays').value = String(mode === 'duration' && targets.length === 1 && [1, 3, 7, 30, 180, 3650].includes(targets[0].days) ? targets[0].days : 1);
  $('#playerModerationMessage').textContent = ''; setPlayerActionMode(mode); $('#playerModerationDialog').showModal();
}
async function submitPlayerModeration(mode) {
  if (playerActionBusy || !playerAction) return; playerActionBusy = true;
  const action = { ...playerAction };
  $$('#playerModerationDialog button, #playerModerationDialog select').forEach(element => element.disabled = true);
  $('#playerModerationMessage').textContent = '正在逐个处理，请稍候…';
  try {
    const result = await post('/api/players/moderation', { action: mode, steamIds: action.ids, days: Number($('#playerBanDays').value), confirmed: true });
    const box = $('#playerModerationResult'); box.classList.remove('hidden'); box.classList.toggle('warning', Boolean(result.failed || result.auditWarning));
    box.textContent = result.message + (result.auditWarning ? ' · ' + result.auditWarning : '') + (result.failed ? '；' + result.results.filter(item => !item.ok).map(item => `${item.steam2}：${item.message}`).join('；') : '');
    selectedPlayers.clear(); result.results.filter(item => !item.ok).forEach(item => selectedPlayers.add(item.steam64));
    record(`玩家管理：${({ kick: '踢出', ban: '拉黑', 'kick-ban': '踢出并拉黑', duration: '修改拉黑时长', unban: '取消拉黑' })[mode]} · ${result.message}`);
    toast(result.message); $('#playerModerationDialog').close(); await loadPlayers();
  } catch (error) { $('#playerModerationMessage').textContent = error.message; }
  finally { playerActionBusy = false; $$('#playerModerationDialog button, #playerModerationDialog select').forEach(element => element.disabled = false); renderPlayers(); }
}
$('#playerBulkMode').onchange = event => { playerBatchMode = event.target.checked; selectedPlayers.clear(); renderPlayers(); };
$('#playerSelectAll').onchange = event => { selectedPlayers.clear(); if (event.target.checked) playerRows().slice(0, 100).forEach(player => selectedPlayers.add(player.steam64)); renderPlayers(); };
$('#playerList').onchange = event => { const checkbox = event.target.closest('[data-player-select]'); if (!checkbox || playerActionBusy) return; if (checkbox.checked && selectedPlayers.size >= 100) { checkbox.checked = false; return toast('每次最多选择 100 位玩家'); } if (checkbox.checked) selectedPlayers.add(checkbox.dataset.playerSelect); else selectedPlayers.delete(checkbox.dataset.playerSelect); syncPlayerSelection(); };
for (const [id, mode] of [['bulkKickPlayers', 'kick'], ['bulkBanPlayers', 'ban'], ['bulkBanDuration', 'duration'], ['bulkUnbanPlayers', 'unban']]) $('#' + id).onclick = () => openPlayerModeration(mode, [...selectedPlayers]);
$('#cancelPlayerModeration').onclick = () => { if (!playerActionBusy) $('#playerModerationDialog').close(); };
$('#kickOnlyPlayers').onclick = () => submitPlayerModeration('kick');
$('#kickAndBanPlayers').onclick = () => setPlayerActionMode('kick-ban');
$('#confirmPlayerModeration').onclick = () => submitPlayerModeration(playerAction.mode);
$('#playerModerationDialog').addEventListener('cancel', event => { if (playerActionBusy) event.preventDefault(); });
$('#playerModerationDialog').addEventListener('close', () => { if (playerAction?.focus?.isConnected) playerAction.focus.focus(); });

function displayRestartStatus(state) {
  restartBusy = state.status === 'restarting'; $('#restartServer').disabled = restartBusy;
  const message = $('#restartServerStatus'); message.classList.toggle('hidden', state.status === 'idle'); message.classList.toggle('warning', state.status === 'failed'); message.textContent = state.message;
  if (restartBusy && !restartTimer) restartTimer = setInterval(checkRestartStatus, 2000);
  if (!restartBusy && restartTimer) { clearInterval(restartTimer); restartTimer = null; syncStatus(); loadPlayers(); }
}
async function checkRestartStatus() { if (typeof isGuest !== 'undefined' && isGuest) return; try { displayRestartStatus(await api('/api/server/restart')); } catch { if (restartBusy) $('#restartServerStatus').textContent = '正在重连以确认重启状态…'; } }
$('#restartServer').onclick = () => { if (!restartBusy) { $('#restartServerMessage').textContent = ''; $('#restartServerDialog').showModal(); } };
$('#cancelServerRestart').onclick = () => { if (!restartBusy) $('#restartServerDialog').close(); };
$('#restartServerDialog').addEventListener('cancel', event => { if (restartBusy) event.preventDefault(); });
$('#confirmServerRestart').onclick = async () => {
  if (restartBusy) return; restartBusy = true; $('#confirmServerRestart').disabled = true; $('#cancelServerRestart').disabled = true;
  try { const result = await post('/api/server/restart', { confirmed: true }); displayRestartStatus(result); $('#restartServerDialog').close(); record('已确认重启游戏服务器'); toast('服务器正在重启'); }
  catch (error) { restartBusy = false; $('#restartServerMessage').textContent = error.message; }
  finally { $('#confirmServerRestart').disabled = false; $('#cancelServerRestart').disabled = false; }
};
checkRestartStatus();
