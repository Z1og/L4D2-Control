const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const dns = require('dns');
const net = require('net');
const { execFile } = require('child_process');
const YAML = require('yaml');

const home = process.env.WORKSHOP_MIHOMO_HOME || path.join(require('os').homedir(), '.config', 'dead-air-mihomo');
const binary = process.env.WORKSHOP_MIHOMO_BIN || path.join(__dirname, 'bin', 'mihomo');
const statePath = path.join(home, 'nodes.json');
const configPath = path.join(home, 'config.json');
const group = '内容下载';
const controllerPort = Number(process.env.WORKSHOP_MIHOMO_CONTROLLER_PORT || 9090);
const socksPort = Number(process.env.WORKSHOP_MIHOMO_SOCKS_PORT || 10808);
if (![controllerPort, socksPort].every(port => Number.isInteger(port) && port > 0 && port < 65536)) throw new Error('代理端口无效');
let busy = false;

function writePrivate(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, typeof data === 'string' ? data : JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.chmodSync(temporary, 0o600);
  fs.renameSync(temporary, file);
}
const load = () => JSON.parse(fs.readFileSync(statePath, 'utf8'));
const secret = () => fs.readFileSync(path.join(home, 'secret.txt'), 'utf8').trim();
function controller(route, method = 'GET', payload) {
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port: controllerPort, path: route, method,
      headers: { authorization: `Bearer ${secret()}`, 'content-type': 'application/json' }, timeout: 15000 }, response => {
      let body = '';
      response.on('data', bytes => { body += bytes; if (body.length > 4 * 1024 * 1024) request.destroy(new Error('代理响应过大')); });
      response.on('error', reject);
      response.on('end', () => {
        if (response.statusCode >= 400) { reject(new Error(`代理控制失败（${response.statusCode}）`)); return; }
        try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('代理响应无效')); }
      });
    });
    request.on('timeout', () => request.destroy(new Error('代理控制超时')));
    request.on('error', () => reject(new Error('代理服务暂时不可用')));
    request.end(payload === undefined ? undefined : JSON.stringify(payload));
  });
}
function execute(file, args, timeout = 20000) {
  return new Promise((resolve, reject) => execFile(file, args, { timeout, maxBuffer: 2 * 1024 * 1024 }, (error, stdout) => {
    if (error) reject(new Error('节点配置校验或连通性检查失败'));
    else resolve(stdout.trim());
  }));
}
function publicAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return a > 0 && a !== 10 && a !== 127 && a < 224 && !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && b === 168) && !(a === 100 && b >= 64 && b <= 127);
  }
  return net.isIPv6(address) && /^[23]/.test(address);
}
function publicLookup(host, options, callback) {
  dns.lookup(host, { all: true }, (error, addresses) => {
    if (error || !addresses?.length || addresses.some(item => !publicAddress(item.address))) return callback(new Error('订阅地址必须是公网地址'));
    const filtered = options.family ? addresses.filter(item => item.family === options.family) : addresses;
    if (!filtered.length) return callback(new Error('订阅地址解析失败'));
    callback(null, ...(options.all ? [filtered] : [filtered[0].address, filtered[0].family]));
  });
}
function subscriptionUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('订阅地址无效'); }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || url.href.length > 4096) throw new Error('订阅仅支持 HTTPS 公网地址');
  return url;
}
async function fetchSubscription(value, redirects = 0) {
  if (redirects > 3) throw new Error('订阅重定向过多');
  const url = subscriptionUrl(value);
  const response = await new Promise((resolve, reject) => {
    const request = https.get(url, { lookup: publicLookup, timeout: 30000,
      headers: { 'user-agent': 'clash.meta', accept: 'application/yaml,text/yaml,text/plain,*/*' } }, resolve);
    request.on('timeout', () => request.destroy());
    request.on('error', () => reject(new Error('订阅读取失败，请检查地址或服务状态')));
  });
  if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
    response.resume();
    return fetchSubscription(new URL(response.headers.location, url).href, redirects + 1);
  }
  if (response.statusCode !== 200) { response.resume(); throw new Error(`订阅读取失败（HTTP ${response.statusCode}）`); }
  return new Promise((resolve, reject) => {
    let body = '';
    response.setEncoding('utf8');
    response.on('data', chunk => { body += chunk; if (Buffer.byteLength(body) > 2 * 1024 * 1024) response.destroy(new Error('订阅内容过大')); });
    response.on('end', () => resolve(body));
    response.on('error', () => reject(new Error('订阅内容读取失败或超过 2 MB')));
  });
}
function parseUri(value) {
  if (value.startsWith('vmess://')) {
    let item;
    try { item = JSON.parse(Buffer.from(value.slice(8), 'base64').toString()); } catch { throw new Error('VMess 链接无效'); }
    const config = { name: item.ps || item.add, type: 'vmess', server: item.add, port: +item.port, uuid: item.id, alterId: +(item.aid || 0), cipher: item.scy || 'auto', tls: item.tls === 'tls', servername: item.sni || item.host || item.add };
    if (item.net && item.net !== 'tcp') config.network = item.net;
    if (config.network === 'ws') config['ws-opts'] = { path: item.path || '/', headers: { Host: item.host || item.add } };
    if (config.network === 'grpc') config['grpc-opts'] = { 'grpc-service-name': item.path || '' };
    return config;
  }
  let url;
  try { url = new URL(value); } catch { throw new Error('节点链接格式无效'); }
  const type = url.protocol.slice(0, -1);
  if (!['vless', 'trojan', 'ss', 'hysteria2', 'hy2', 'tuic'].includes(type)) throw new Error('仅支持 Clash YAML、订阅或常见代理节点链接');
  const config = { name: decodeURIComponent(url.hash.slice(1)) || url.hostname, type: type === 'hy2' ? 'hysteria2' : type, server: url.hostname, port: +(url.port || (type === 'trojan' ? 443 : 0)) };
  const params = url.searchParams;
  if (type === 'ss') {
    const credentials = decodeURIComponent(url.username);
    const raw = credentials.includes(':') ? credentials : Buffer.from(credentials, 'base64').toString();
    const separator = raw.indexOf(':');
    if (separator < 1) throw new Error('SS 链接无效');
    config.cipher = raw.slice(0, separator); config.password = raw.slice(separator + 1);
  } else if (type === 'vless') {
    config.uuid = decodeURIComponent(url.username); config.tls = ['tls', 'reality'].includes(params.get('security'));
    if (params.get('flow')) config.flow = params.get('flow');
    if (params.get('security') === 'reality') config['reality-opts'] = { 'public-key': params.get('pbk'), 'short-id': params.get('sid') || '' };
  } else if (type === 'tuic') { config.uuid = decodeURIComponent(url.username); config.password = decodeURIComponent(url.password); }
  else { config.password = decodeURIComponent(url.username); config.tls = true; }
  if (params.get('sni')) config.servername = params.get('sni');
  if (params.get('fp')) config['client-fingerprint'] = params.get('fp');
  const network = params.get('type');
  if (network && network !== 'tcp') {
    config.network = network;
    if (network === 'ws') config['ws-opts'] = { path: params.get('path') || '/', headers: { Host: params.get('host') || url.hostname } };
    if (network === 'grpc') config['grpc-opts'] = { 'grpc-service-name': params.get('serviceName') || '' };
  }
  if (params.get('headerType') === 'http') throw new Error('该 VLESS TCP HTTP 伪装链接需要原 Xray 内核，请改用订阅中的兼容节点');
  return config;
}
function parseNodes(text) {
  const value = String(text || '').trim();
  if (!value || Buffer.byteLength(value) > 2 * 1024 * 1024) throw new Error('请导入有效订阅、Clash YAML 或节点链接（最多 2 MB）');
  let parsed;
  try { parsed = YAML.parse(value, { maxAliasCount: 0 }); } catch { /* A URI or base64 subscription can be used instead. */ }
  let configs = Array.isArray(parsed?.proxies) ? parsed.proxies : Array.isArray(parsed) ? parsed : null;
  if (!configs) {
    const lines = value.includes('://') ? value : Buffer.from(value, 'base64').toString();
    configs = lines.split(/\r?\n/).filter(line => line.trim()).map(line => parseUri(line.trim()));
  }
  if (!configs.length || configs.length > 500) throw new Error('订阅节点数必须在 1 至 500 之间');
  const types = new Set(['ss', 'ssr', 'vmess', 'vless', 'trojan', 'hysteria', 'hysteria2', 'tuic', 'snell', 'anytls', 'socks5', 'http']);
  return configs.map(input => {
    if (!input || !types.has(input.type) || typeof input.server !== 'string' || !input.server.trim() || /[\s/]/.test(input.server) || !Number.isInteger(+input.port) || +input.port < 1 || +input.port > 65535) throw new Error('订阅含不支持或无效的节点');
    if (input['dialer-proxy']) throw new Error('不支持依赖其他代理组的节点');
    const config = JSON.parse(JSON.stringify(input));
    config.port = +config.port;
    config.name = String(config.name || `${config.type} ${config.server}`).slice(0, 120);
    const identity = { ...config }; delete identity.name;
    const id = crypto.createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0, 16);
    return { id, config };
  });
}
function buildConfig(data) {
  if (!data.nodes.length) throw new Error('至少保留一个节点');
  return {
    'socks-port': socksPort, 'allow-lan': false, 'bind-address': '127.0.0.1', mode: 'rule', ipv6: false,
    'log-level': 'warning', 'external-controller': `127.0.0.1:${controllerPort}`, secret: secret(),
    tun: { enable: false }, profile: { 'store-selected': true },
    proxies: data.nodes.map(node => ({ ...node.config, name: `${node.config.name} · ${node.id.slice(0, 6)}` })),
    'proxy-groups': [{ name: group, type: 'select', proxies: data.nodes.map(node => `${node.config.name} · ${node.id.slice(0, 6)}`) }],
    rules: [`MATCH,${group}`]
  };
}
const runtimeName = node => `${node.config.name} · ${node.id.slice(0, 6)}`;
async function listNodes() {
  const data = load();
  const runtime = await controller(`/proxies/${encodeURIComponent(group)}`);
  const active = data.nodes.find(node => runtimeName(node) === runtime.now);
  return { engine: 'mihomo', dashboard: '/proxy-dashboard/', activeId: active?.id || null,
    subscriptions: data.subscriptions.map(item => ({ id: item.id, label: item.label, updatedAt: item.updatedAt })),
    nodes: data.nodes.map(node => ({ id: node.id, name: node.config.name, host: node.config.server, port: node.config.port, type: node.config.type, subscription: !!node.sourceId })) };
}
async function locked(callback) {
  if (busy) throw new Error('代理配置正在更新，请稍后重试');
  busy = true;
  try { return await callback(); } finally { busy = false; }
}
async function apply(data) {
  const previous = fs.readFileSync(configPath);
  const oldRuntime = await controller(`/proxies/${encodeURIComponent(group)}`);
  const candidate = path.join(home, 'candidate.json');
  writePrivate(candidate, buildConfig(data));
  try {
    await execute(binary, ['-t', '-d', home, '-f', candidate]);
    writePrivate(configPath, fs.readFileSync(candidate, 'utf8'));
    await controller('/configs?force=true', 'PUT', { path: configPath });
    const selected = data.nodes.find(node => runtimeName(node) === oldRuntime.now) || data.nodes.find(node => node.id === data.activeId) || data.nodes[0];
    await controller(`/proxies/${encodeURIComponent(group)}`, 'PUT', { name: runtimeName(selected) });
    await execute('curl', ['--proxy', `socks5h://127.0.0.1:${socksPort}`, '--fail', '--silent', '--show-error', '--max-time', '18', '-o', '/dev/null', 'https://steamcommunity.com/workshop/browse/?appid=550']);
    data.activeId = selected.id;
    writePrivate(statePath, data);
  } catch (error) {
    writePrivate(configPath, previous.toString());
    await controller('/configs?force=true', 'PUT', { path: configPath }).catch(() => {});
    await controller(`/proxies/${encodeURIComponent(group)}`, 'PUT', { name: oldRuntime.now }).catch(() => {});
    throw new Error(`${error.message}，已恢复原配置`);
  } finally { fs.rmSync(candidate, { force: true }); }
  return listNodes();
}
async function importNodes(text) {
  return locked(async () => {
    const value = String(text || '').trim();
    const url = /^https:\/\//i.test(value) ? subscriptionUrl(value) : null;
    const nodes = parseNodes(url ? await fetchSubscription(url.href) : value);
    const data = load();
    let sourceId = null;
    if (url) {
      sourceId = crypto.createHash('sha256').update(url.href).digest('hex').slice(0, 16);
      const subscription = { id: sourceId, url: url.href, label: url.hostname, updatedAt: new Date().toISOString() };
      data.subscriptions = data.subscriptions.filter(item => item.id !== sourceId).concat(subscription);
      data.nodes = data.nodes.filter(node => node.sourceId !== sourceId);
      data.deleted = (data.deleted || []).filter(item => item.sourceId !== sourceId);
    }
    for (const node of nodes) {
      const index = data.nodes.findIndex(item => item.id === node.id);
      if (index < 0) data.nodes.push({ ...node, sourceId });
      else data.nodes[index] = { ...node, sourceId: sourceId || data.nodes[index].sourceId };
    }
    return apply(data);
  });
}
async function updateSubscription(id) {
  return locked(async () => {
    const data = load();
    const subscriptions = id ? data.subscriptions.filter(item => item.id === id) : data.subscriptions;
    if (!subscriptions.length) throw new Error('没有可更新的订阅');
    for (const subscription of subscriptions) {
      const nodes = parseNodes(await fetchSubscription(subscription.url));
      data.nodes = data.nodes.filter(node => node.sourceId !== subscription.id);
      for (const node of nodes) {
        if (!(data.deleted || []).some(item => item.sourceId === subscription.id && item.id === node.id) && !data.nodes.some(item => item.id === node.id)) data.nodes.push({ ...node, sourceId: subscription.id });
      }
      subscription.updatedAt = new Date().toISOString();
    }
    return apply(data);
  });
}
async function deleteNode(id) {
  return locked(async () => {
    const data = load();
    const node = data.nodes.find(item => item.id === id);
    if (!node) throw new Error('节点不存在');
    const current = await listNodes();
    if (current.activeId === id) throw new Error('请先切换到其他节点，再删除当前节点');
    data.nodes = data.nodes.filter(item => item.id !== id);
    if (node.sourceId) data.deleted = (data.deleted || []).concat({ sourceId: node.sourceId, id });
    return apply(data);
  });
}
async function switchNode(id) {
  return locked(async () => {
    const data = load();
    const node = data.nodes.find(item => item.id === id);
    if (!node) throw new Error('节点不存在');
    const route = `/proxies/${encodeURIComponent(group)}`;
    const previous = (await controller(route)).now;
    try {
      await controller(route, 'PUT', { name: runtimeName(node) });
      await execute('curl', ['--proxy', `socks5h://127.0.0.1:${socksPort}`, '--fail', '--silent', '--show-error', '--max-time', '18', '-o', '/dev/null', 'https://steamcommunity.com/workshop/browse/?appid=550']);
      data.activeId = id; writePrivate(statePath, data);
    } catch {
      await controller(route, 'PUT', { name: previous }).catch(() => {});
      throw new Error('该节点无法连接 Steam，已恢复原节点');
    }
    return listNodes();
  });
}
function exportNodes() { return YAML.stringify({ proxies: load().nodes.map(node => node.config) }); }
function safeBridgeRoute(route, method) {
  const pathname = new URL(route, 'http://localhost').pathname;
  if (method === 'GET') return /^\/(version|configs|rules|proxies(?:\/[^/]+(?:\/delay)?)?|providers\/proxies(?:\/[^/]+)?|connections|traffic|memory|logs)$/.test(pathname);
  if (method === 'PUT') return pathname === `/proxies/${encodeURIComponent(group)}`;
  if (method === 'DELETE') return /^\/connections(?:\/[^/]+)?$/.test(pathname);
  return false;
}
function bridge(req, res, route) {
  if (!safeBridgeRoute(route, req.method)) { res.writeHead(403); res.end('This action is managed by the panel'); return; }
  if (req.method === 'PUT') {
    let body = '';
    req.on('data', bytes => { body += bytes; if (body.length > 8192) req.destroy(); });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        const node = load().nodes.find(item => runtimeName(item) === payload.name);
        if (!node) throw new Error('节点不存在');
        await switchNode(node.id); res.writeHead(204); res.end();
      } catch (error) { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ message: error.message })); }
    });
    return;
  }
  if (req.method === 'GET' && new URL(route, 'http://localhost').pathname === '/configs') {
    controller('/configs').then(config => {
      delete config.secret;
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(config));
    }).catch(() => { res.writeHead(502); res.end(); });
    return;
  }
  const request = http.request({ hostname: '127.0.0.1', port: controllerPort, path: route, method: req.method, headers: { authorization: `Bearer ${secret()}` } }, response => {
    res.writeHead(response.statusCode, { 'content-type': response.headers['content-type'] || 'application/json', 'cache-control': 'no-store' });
    response.pipe(res);
  });
  request.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  res.on('close', () => request.destroy());
  request.end();
}
function upgrade(req, socket, head, route) {
  if (!safeBridgeRoute(route, 'GET') || !/^\/(connections|traffic|memory|logs)(\?|$)/.test(route)) { socket.destroy(); return; }
  const request = http.request({ hostname: '127.0.0.1', port: controllerPort, path: route, headers: { ...req.headers, host: `127.0.0.1:${controllerPort}`, authorization: `Bearer ${secret()}` } });
  request.on('upgrade', (response, upstream, upstreamHead) => {
    socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(response.headers).map(([key, value]) => `${key}: ${value}\r\n`).join('')}\r\n`);
    if (head.length) upstream.write(head);
    if (upstreamHead.length) socket.write(upstreamHead);
    socket.pipe(upstream).pipe(socket);
    socket.on('error', () => upstream.destroy()); upstream.on('error', () => socket.destroy()); socket.on('close', () => upstream.destroy());
  });
  request.on('response', () => socket.destroy());
  request.on('error', () => socket.destroy());
  socket.on('close', () => request.destroy());
  request.end();
}
module.exports = { listNodes, importNodes, exportNodes, deleteNode, switchNode, updateSubscription, bridge, upgrade, parseNodes, buildConfig, fetchSubscription, writePrivate, group };
