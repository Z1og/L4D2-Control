// L4D2-Control project identity: l4d2-control-bf312edc896c79baad5c | SPDX-License-Identifier: LicenseRef-L4D2-Control-NonCommercial-1.0
let accountPasswordTarget = null, accountPasswordBusy = false, accountPasswordFocus = null;
const passwordDialog = $('#accountPasswordDialog');
$('#changeAccountPassword').hidden = !isGuest;
function clearAccountPassword() {
  for (const id of ['passwordCurrent','passwordNew','passwordRepeat']) $('#' + id).value = '';
  $('#passwordResetConfirm').checked = false;
}
function openAccountPassword(player = null) {
  if (accountPasswordBusy || (player ? isGuest || !player.panelAccount : !isGuest)) return;
  accountPasswordTarget = player ? {steam64:player.steam64,name:player.panelName || player.name} : null;
  accountPasswordFocus = document.activeElement; clearAccountPassword();
  $('#accountPasswordTitle').textContent = player ? '清除普通账号密码' : '修改我的面板密码';
  $('#accountPasswordIdentity').textContent = player ? `${accountPasswordTarget.name} · ${player.steam64}` : '仅修改当前普通账号的面板密码。';
  $('#passwordCurrentField').hidden = Boolean(player); $('#passwordCurrent').required = !player;
  $('#passwordCurrent').disabled = Boolean(player); $('#passwordResetConfirmField').hidden = !player;
  $('#passwordResetConfirm').required = Boolean(player);
  for(const id of ['passwordNew','passwordRepeat']){const input=$('#'+id);input.closest('label').hidden=Boolean(player);input.required=!player;input.disabled=Boolean(player);}
  $('#accountPasswordHelp').textContent = player ? '仅删除该账号的密码凭据并退出全部登录。玩家记录、昵称、备注、游戏权限和拉黑状态均保留；玩家需使用同一 SteamID 重新注册。请确认是本人提出的请求。' : '修改后，该账号在所有设备上的登录都会失效。请使用新密码重新登录。';
  $('#saveAccountPassword').textContent = player ? '确认清除密码' : '确认修改密码';
  $('#accountPasswordMessage').textContent = '';passwordDialog.showModal();
  $(player ? '#passwordResetConfirm' : '#passwordCurrent').focus({preventScroll:true});
}
$('#changeAccountPassword').onclick = () => openAccountPassword();
$('#closeAccountPassword').onclick = $('#cancelAccountPassword').onclick = () => { if (!accountPasswordBusy) passwordDialog.close(); };
passwordDialog.addEventListener('cancel',event => { if (accountPasswordBusy) event.preventDefault(); });
passwordDialog.addEventListener('close',() => { clearAccountPassword();accountPasswordTarget = null;if (accountPasswordFocus?.isConnected) accountPasswordFocus.focus({preventScroll:true}); });
$('#accountPasswordForm').onsubmit = async event => {
  event.preventDefault();if (accountPasswordBusy) return;
  const reset = Boolean(accountPasswordTarget), target = accountPasswordTarget;
  const payload = reset ? {} : {newPassword:$('#passwordNew').value,confirmPassword:$('#passwordRepeat').value};
  if (!reset && payload.newPassword !== payload.confirmPassword) { $('#accountPasswordMessage').textContent = '两次输入的新密码不一致';return; }
  if (reset) { if (!$('#passwordResetConfirm').checked) return;payload.steamId=target.steam64;payload.confirmed=true; }
  else payload.currentPassword=$('#passwordCurrent').value;
  accountPasswordBusy=true;
  const controls=[...passwordDialog.querySelectorAll('button,input')];controls.forEach(e=>e.disabled=true);
  $('#accountPasswordMessage').textContent=reset?'正在清除密码…':'正在修改密码…';
  try {
    const result=await post(reset?'/api/auth/reset-password':'/api/auth/password',payload);
    clearAccountPassword();passwordDialog.close();
    if (result.reauthenticate) { location.replace('/login?password=changed');return; }
    toast(result.message);record('清除普通账号面板密码');await loadPlayers();
  } catch (error) { $('#accountPasswordMessage').textContent=error.message; }
  finally { accountPasswordBusy=false;controls.forEach(e=>e.disabled=false);$('#passwordCurrent').disabled=reset;for(const id of ['passwordNew','passwordRepeat'])$('#'+id).disabled=reset; }
};
