const ruleId = 1;
const $ = id => document.getElementById(id);

function show(message, state = '') {
  $('status').textContent = message;
  $('dot').className = `dot ${state}`;
}

function ruleFor(host, tabId) {
  return {
    id: ruleId,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [{ header: 'user-agent', operation: 'set', value: 'pan.baidu.com' }]
    },
    condition: {
      requestDomains: ['baidupcs.com', 'pcs.baidu.com'],
      initiatorDomains: [host],
      tabIds: [tabId],
      resourceTypes: ['main_frame', 'xmlhttprequest', 'other']
    }
  };
}

async function refresh() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const rules = await chrome.declarativeNetRequest.getSessionRules();
  const rule = rules.find(item => item.id === ruleId);
  const enabled = Boolean(rule);
  const current = enabled && tab?.id !== undefined && rule.condition.tabIds?.includes(tab.id);
  const host = rule?.condition.initiatorDomains?.[0] || '';
  $('origin').textContent = current ? host : enabled ? `已绑定其他标签页 · ${host}` : '尚未绑定面板';
  $('dot').className = `dot ${current ? 'active' : ''}`;
  $('status').textContent = current ? '此面板标签页已启用' : enabled ? '扩展已绑定到其他标签页' : '扩展规则已关闭';
  $('disable').hidden = !enabled;
}

$('bind').addEventListener('click', async () => {
  $('bind').disabled = true;
  $('notice').textContent = '';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    let url;
    try { url = new URL(tab?.url || ''); } catch { throw new Error('请先打开 L4D2-Control 面板，再点击扩展图标。'); }
    if (tab?.id === undefined || !['http:', 'https:'].includes(url.protocol) || !url.hostname || url.hostname === 'baidupcs.com' || url.hostname.endsWith('.baidupcs.com') || url.hostname === 'baidu.com' || url.hostname.endsWith('.baidu.com')) throw new Error('当前标签页不是可绑定的控制面板，请切回面板后再试。');
    const host = url.hostname.toLowerCase();
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId], addRules: [ruleFor(host, tab.id)] });
    show('此面板标签页已启用', 'active');
    $('origin').textContent = host;
    $('disable').hidden = false;
  } catch (error) {
    show('无法启用扩展规则', 'error');
    $('notice').textContent = error?.message || '浏览器拒绝创建规则，请重试。';
  } finally { $('bind').disabled = false; }
});

$('disable').addEventListener('click', async () => {
  $('disable').disabled = true;
  try {
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId] });
    await refresh();
    $('notice').textContent = '扩展规则已关闭。';
  } catch (error) { $('notice').textContent = error?.message || '关闭失败，请重试。'; }
  finally { $('disable').disabled = false; }
});

refresh().catch(error => { show('无法读取扩展状态', 'error'); $('notice').textContent = error.message; });
