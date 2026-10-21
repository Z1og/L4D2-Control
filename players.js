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
  status.textContent = !data ? '正在连接玩家采集插件…' : [data.available ? `实时数据更新于 ${playerTime(data.checkedAt)} · 每 5 秒自动刷新` : data.reason, data.configError, data.historyError].filter(Boolean).join(' · ');
  if (!data) { $('#playerList').innerHTML = '<div class="player-empty">正在读取玩家数据…</div>'; return; }
  const query = $('#playerSearch').value.trim().toLowerCase();
  let rows = data.players.filter(p => playerTab === 'online' ? p.online : playerTab === 'admins' ? p.flags || p.permissionSource !== 'none' : true);
  rows = rows.filter(p => `${p.name} ${p.steam2} ${p.steam3} ${p.steam64}`.toLowerCase().includes(query));
  $('#playerListTitle').textContent = { online: '当前在线', history: '玩家记录', admins: '管理员权限' }[playerTab];
  $('#playerListCount').textContent = `${rows.length} 位玩家`;
  $('#playerList').innerHTML = rows.length ? rows.map(p => {
    const profile = data.profiles.find(x => x.flags === p.flags);
    const role = p.permissionSource === 'external' ? '外部配置管理员' : p.permissionSource === 'runtime' ? '其他来源权限' : p.flags ? profile?.name || '自定义管理员' : '普通玩家';
    const live = p.online ? `${playerTeam(p.team)} · ${p.ping} ms · 已连接 ${playerDuration(p.connectedSeconds)}` : `最后出现：${playerTime(p.lastSeen)}`;
    return `<article class="player-row"><div class="player-avatar ${p.online ? 'online' : ''}"><i data-lucide="user-round"></i></div><div class="player-main"><div class="player-name-line"><h3>${escapeHtml(p.name)}</h3><span class="player-state ${p.online ? 'online' : ''}">${p.online ? '在线' : data.available ? '离线' : '在线状态未知'}</span></div><p>${escapeHtml(live)}</p><div class="player-identities"><code>${escapeHtml(p.steam2)}</code><code>${escapeHtml(p.steam64)}</code><button class="player-copy" data-player-copy="${escapeHtml(p.steam64)}" aria-label="复制 ${escapeHtml(p.name)} 的 SteamID64"><i data-lucide="copy"></i>复制 ID</button></div><small>首次记录：${playerTime(p.firstSeen)}</small>${p.readOnlyReason ? `<small class="player-config-note">${escapeHtml(p.readOnlyReason)}</small>` : ''}</div><div class="player-role"><strong>${escapeHtml(role)}</strong><span>${p.flags ? `标记 ${escapeHtml(p.flags)} · 免疫 ${p.immunity}` : '没有面板管理授权'}</span>${p.online && p.managed ? `<small>游戏实际标记：${escapeHtml(p.runtimeFlags || '无')}</small>` : ''}<button class="secondary-button" data-player-edit="${escapeHtml(p.steam64)}" ${p.readOnly || !data.available || playerSaving ? 'disabled' : ''}><i data-lucide="shield-check"></i>${p.managed ? '修改 / 撤销权限' : '设置权限'}</button></div></article>`;
  }).join('') : `<div class="player-empty"><i data-lucide="users"></i><h3>${query ? '没有匹配的玩家' : playerTab === 'online' ? data.available ? '当前没有真人玩家在线' : '暂时无法确认在线玩家' : playerTab === 'admins' ? '暂无管理员记录' : '尚未记录玩家'}</h3><p>${playerTab === 'online' && !query ? '机器人不会被记录为 Steam 玩家。真实玩家加入后，会自动记录身份与最近在线时间。' : '可用昵称、SteamID2、SteamID3 或 SteamID64 搜索。'}</p></div>`;
  $('#playerAudit').innerHTML = data.audit.length ? data.audit.map(a => `<div class="player-audit-row"><time>${playerTime(a.at)}</time><code>${escapeHtml(a.steam2)}</code><span>${escapeHtml(a.before || '普通玩家')} → ${escapeHtml(a.after || '普通玩家')} · 免疫 ${a.immunity}</span></div>`).join('') : '<p class="player-audit-empty">尚无面板权限变更。已有管理员不会被自动修改。</p>';
  icons();
}
async function loadPlayers() {
  if (playerLoading) return;
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
$('#playerSearch').oninput = renderPlayers;
$('#playerTabs').onclick = e => { const b = e.target.closest('[data-player-tab]'); if (!b) return; playerTab = b.dataset.playerTab; $$('#playerTabs button').forEach(x => { x.classList.toggle('active', x === b); x.setAttribute('aria-pressed', String(x === b)); }); renderPlayers(); };
$('#playerList').onclick = async e => { const copy = e.target.closest('[data-player-copy]'); if (copy) { try { await navigator.clipboard.writeText(copy.dataset.playerCopy); toast('SteamID64 已复制'); } catch { prompt('复制 SteamID64', copy.dataset.playerCopy); } return; } const edit = e.target.closest('[data-player-edit]'); if (edit && !edit.disabled) openPlayerPermission(edit.dataset.playerEdit); };
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
setInterval(() => { if (!document.hidden && (!$('#playersView').classList.contains('hidden') || !$('#overviewView').classList.contains('hidden')) && !$('#playerPermissionDialog').open) loadPlayers(); }, 5000);
