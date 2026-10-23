// L4D2-Control project identity: l4d2-control-bf312edc896c79baad5c | SPDX-License-Identifier: LicenseRef-L4D2-Control-NonCommercial-1.0
(function () {
  const dialog = document.getElementById('panelConfirmDialog');
  const title = document.getElementById('panelConfirmTitle');
  const message = document.getElementById('panelConfirmMessage');
  const field = document.getElementById('panelConfirmField');
  const label = document.getElementById('panelConfirmLabel');
  const input = document.getElementById('panelConfirmInput');
  const confirmButton = document.getElementById('panelConfirmAccept');
  const cancelButton = document.getElementById('panelConfirmCancel');
  const queue = [];
  let active = null;

  function openNext() {
    if (active || !queue.length) return;
    active = queue.shift();
    const { kind, text, value, options } = active;
    const lines = text.split('\n');
    title.textContent = options.title || lines.shift() || '确认操作';
    message.textContent = options.title ? text : lines.join('\n').trim();
    message.hidden = !message.textContent;
    field.hidden = kind !== 'prompt';
    label.textContent = options.label || '内容';
    input.value = value;
    input.readOnly = Boolean(options.readOnly);
    confirmButton.textContent = options.confirmLabel || '确认操作';
    confirmButton.className = options.danger ? 'danger-button' : 'primary-button';
    cancelButton.textContent = options.cancelLabel || '取消';
    dialog.returnValue = '';
    try {
      dialog.showModal();
      if (kind === 'prompt') { input.focus({ preventScroll: true }); input.select(); }
      else cancelButton.focus({ preventScroll: true });
    } catch (error) {
      const failed = active; active = null;
      failed.reject(error);
      openNext();
    }
  }

  function request(kind, text, value = '', options = {}) {
    return new Promise((resolve, reject) => {
      queue.push({ kind, text: String(text), value: String(value), options, resolve, reject, trigger: document.activeElement });
      openNext();
    });
  }

  function close(accepted) {
    if (!active || active.closing) return;
    active.closing = true;
    active.result = accepted ? (active.kind === 'prompt' ? input.value : true) : (active.kind === 'prompt' ? null : false);
    dialog.close(accepted ? 'confirm' : 'cancel');
  }

  document.getElementById('panelConfirmForm').addEventListener('submit', event => { event.preventDefault(); close(true); });
  cancelButton.addEventListener('click', () => close(false));
  document.getElementById('panelConfirmClose').addEventListener('click', () => close(false));
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(false); });
  dialog.addEventListener('close', () => {
    if (!active) return;
    const completed = active; active = null;
    const result = completed.closing ? completed.result : (completed.kind === 'prompt' ? null : false);
    message.textContent = ''; input.value = '';
    if (completed.trigger?.isConnected) completed.trigger.focus({ preventScroll: true });
    completed.resolve(result);
    queueMicrotask(openNext);
  });

  window.PanelDialogs = Object.freeze({
    confirm: (text, options) => request('confirm', text, '', options),
    prompt: (text, value, options) => request('prompt', text, value, options)
  });
})();
