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
  $('#accountPasswordTitle').textContent = player ? '重置普通账号密码' : '修改我的面板密码';
  $('#accountPasswordIdentity').textContent = player ? `${accountPasswordTarget.name} · ${player.steam64}` : '仅修改当前普通账号的面板密码。';
  $('#passwordCurrentField').hidden = Boolean(player); $('#passwordCurrent').required = !player;
  $('#passwordCurrent').disabled = Boolean(player); $('#passwordResetConfirmField').hidden = !player;
  $('#passwordResetConfirm').required = Boolean(player);
  $('#accountPasswordHelp').textContent = player ? '此操作不会修改 Steam 密码或解除拉黑。请通过私密方式将新面板密码告知本人。' : '修改后，该账号在所有设备上的登录都会失效。请使用新密码重新登录。';
  $('#saveAccountPassword').textContent = player ? '确认重置密码' : '确认修改密码';
  $('#accountPasswordMessage').textContent = '';passwordDialog.showModal();
  $(player ? '#passwordNew' : '#passwordCurrent').focus({preventScroll:true});
}
$('#changeAccountPassword').onclick = () => openAccountPassword();
$('#closeAccountPassword').onclick = $('#cancelAccountPassword').onclick = () => { if (!accountPasswordBusy) passwordDialog.close(); };
passwordDialog.addEventListener('cancel',event => { if (accountPasswordBusy) event.preventDefault(); });
passwordDialog.addEventListener('close',() => { clearAccountPassword();accountPasswordTarget = null;if (accountPasswordFocus?.isConnected) accountPasswordFocus.focus({preventScroll:true}); });
$('#accountPasswordForm').onsubmit = async event => {
  event.preventDefault();if (accountPasswordBusy) return;
  const reset = Boolean(accountPasswordTarget), target = accountPasswordTarget;
  const payload = {newPassword:$('#passwordNew').value,confirmPassword:$('#passwordRepeat').value};
  if (payload.newPassword !== payload.confirmPassword) { $('#accountPasswordMessage').textContent = '两次输入的新密码不一致';return; }
  if (reset) { if (!$('#passwordResetConfirm').checked) return;payload.steamId=target.steam64;payload.confirmed=true; }
  else payload.currentPassword=$('#passwordCurrent').value;
  accountPasswordBusy=true;
  const controls=[...passwordDialog.querySelectorAll('button,input')];controls.forEach(e=>e.disabled=true);
  $('#accountPasswordMessage').textContent=reset?'正在重置密码…':'正在修改密码…';
  try {
    const result=await post(reset?'/api/auth/reset-password':'/api/auth/password',payload);
    clearAccountPassword();passwordDialog.close();
    if (result.reauthenticate) { location.replace('/login?password=changed');return; }
    toast(result.message);record('重置普通账号面板密码');await loadPlayers();
  } catch (error) { $('#accountPasswordMessage').textContent=error.message; }
  finally { accountPasswordBusy=false;controls.forEach(e=>e.disabled=false);$('#passwordCurrent').disabled=reset; }
};
