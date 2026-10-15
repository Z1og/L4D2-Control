const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const configPath = process.env.WORKSHOP_XRAY_CONFIG || path.join(require('os').homedir(), '.config', 'dead-air-workshop', 'proxy.json');
const nodesPath = process.env.WORKSHOP_NODES_PATH || path.join(path.dirname(configPath), 'nodes.json');
const xrayPath = process.env.WORKSHOP_XRAY_BIN || path.join(__dirname, 'bin', 'xray');
const service = 'dead-air-workshop-proxy.service';
let switching = false;

function execute(file, args, timeout = 12000) {
  return new Promise((resolve, reject) => execFile(file, args, { timeout, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
    if (error) reject(new Error((stderr || stdout || error.message).trim().slice(0, 500)));
    else resolve(stdout.trim());
  }));
}

function writePrivate(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, value, { encoding: 'utf8', mode: 0o600 });
  fs.chmodSync(temporary, 0o600);
  fs.renameSync(temporary, file);
}

function parseNode(uri) {
  const value = String(uri || '').trim();
  if (value.length > 2048 || !value.startsWith('vless://')) throw new Error('仅支持 VLESS 节点链接');
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error('节点链接格式无效'); }
  const uuid = decodeURIComponent(parsed.username);
  const port = Number(parsed.port);
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(uuid) || !parsed.hostname || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('节点地址、端口或 UUID 无效');
  const network = parsed.searchParams.get('type') || 'tcp';
  const security = parsed.searchParams.get('security') || 'none';
  const headerType = parsed.searchParams.get('headerType') || 'none';
  if (network !== 'tcp' || security !== 'none' || !['none', 'http'].includes(headerType)) throw new Error('当前仅支持 TCP / 无加密 / HTTP 伪装的 VLESS 节点');
  const name = decodeURIComponent(parsed.hash.slice(1)) || `${parsed.hostname}:${port}`;
  const identity = `${uuid}@${parsed.hostname}:${port}|${network}|${security}|${headerType}|${parsed.searchParams.get('host') || ''}`;
  return { id: crypto.createHash('sha256').update(identity).digest('hex').slice(0, 16), name: name.slice(0, 60), host: parsed.hostname, port, uri: value };
}

function outbound(node) {
  const parsed = new URL(node.uri);
  const headerType = parsed.searchParams.get('headerType') || 'none';
  const streamSettings = { network: 'tcp', security: 'none' };
  if (headerType === 'http') streamSettings.tcpSettings = { header: { type: 'http', request: {
    version: '1.1', method: 'GET', path: ['/'], headers: { Host: [parsed.searchParams.get('host') || parsed.hostname] }
  } } };
  return { tag: 'workshop-upstream', protocol: 'vless', settings: { vnext: [{ address: parsed.hostname, port: Number(parsed.port), users: [{ id: decodeURIComponent(parsed.username), encryption: 'none' }] }] }, streamSettings };
}

function currentNode() {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const upstream = config.outbounds.find(item => item.protocol === 'vless');
  if (!upstream) return null;
  const server = upstream.settings?.vnext?.[0];
  const user = server?.users?.[0];
  if (!server || !user) return null;
  const url = new URL(`vless://${user.id}@${server.address}:${server.port}`);
  url.searchParams.set('encryption', 'none');
  url.searchParams.set('security', 'none');
  url.searchParams.set('type', 'tcp');
  const header = upstream.streamSettings?.tcpSettings?.header;
  if (header?.type === 'http') {
    url.searchParams.set('headerType', 'http');
    url.searchParams.set('host', header.request?.headers?.Host?.[0] || server.address);
  }
  url.hash = '当前节点';
  return parseNode(url.toString());
}

function loadNodes() {
  if (fs.existsSync(nodesPath)) {
    const data = JSON.parse(fs.readFileSync(nodesPath, 'utf8'));
    let changed = false;
    for (const node of data.nodes) {
      const id = parseNode(node.uri).id;
      if (id !== node.id) { if (data.activeId === node.id) data.activeId = id; node.id = id; changed = true; }
    }
    if (changed) writePrivate(nodesPath, JSON.stringify(data, null, 2));
    return data;
  }
  const initial = currentNode();
  const data = { activeId: initial?.id || null, nodes: initial ? [initial] : [] };
  writePrivate(nodesPath, JSON.stringify(data, null, 2));
  return data;
}

function listNodes() {
  const data = loadNodes();
  return { activeId: data.activeId, nodes: data.nodes.map(({ id, name, host, port }) => ({ id, name, host, port })) };
}

function importNodes(text) {
  if (switching) throw new Error('节点切换中，请稍后重试');
  const values = String(text || '').split(/\r?\n/).map(value => value.trim()).filter(Boolean);
  if (!values.length || values.length > 30) throw new Error('请导入 1 至 30 条 VLESS 链接');
  const parsed = values.map(parseNode);
  const data = loadNodes();
  for (const node of parsed) {
    const index = data.nodes.findIndex(item => item.id === node.id);
    if (index < 0) data.nodes.push(node);
    else data.nodes[index] = node;
  }
  writePrivate(nodesPath, JSON.stringify(data, null, 2));
  return listNodes();
}

function exportNodes() {
  return loadNodes().nodes.map(node => node.uri).join('\n');
}

function deleteNode(id) {
  if (switching) throw new Error('节点切换中，请稍后重试');
  const data = loadNodes();
  if (data.activeId === id) throw new Error('请先切换到其他节点，再删除当前节点');
  const next = data.nodes.filter(node => node.id !== id);
  if (next.length === data.nodes.length) throw new Error('节点不存在');
  data.nodes = next;
  writePrivate(nodesPath, JSON.stringify(data, null, 2));
  return listNodes();
}

async function switchNode(id) {
  if (switching) throw new Error('已有节点切换正在进行');
  const data = loadNodes();
  const node = data.nodes.find(item => item.id === id);
  if (!node) throw new Error('节点不存在');
  if (data.activeId === id) return listNodes();
  switching = true;
  const original = fs.readFileSync(configPath, 'utf8');
  try {
    const config = JSON.parse(original);
    const index = config.outbounds.findIndex(item => item.protocol === 'vless');
    if (index < 0) throw new Error('代理配置没有 VLESS 出站');
    config.outbounds[index] = { ...outbound(node), tag: config.outbounds[index].tag || 'workshop-upstream' };
    const candidate = `${configPath}.${process.pid}.candidate`;
    fs.writeFileSync(candidate, JSON.stringify(config, null, 2), { mode: 0o600 });
    try { await execute(xrayPath, ['run', '-test', '-config', candidate]); }
    finally { fs.rmSync(candidate, { force: true }); }
    writePrivate(configPath, JSON.stringify(config, null, 2));
    try {
      await execute('sudo', ['-n', 'systemctl', 'restart', service]);
      if ((await execute('systemctl', ['is-active', service])) !== 'active') throw new Error('代理服务未启动');
      await execute('curl', ['--proxy', 'socks5h://127.0.0.1:10808', '--fail', '--silent', '--show-error', '--max-time', '18', '-o', '/dev/null', 'https://steamcommunity.com/workshop/browse/?appid=550'], 22000);
    } catch (error) {
      writePrivate(configPath, original);
      await execute('sudo', ['-n', 'systemctl', 'restart', service]).catch(() => {});
      throw new Error(`节点验证失败，已恢复原节点：${error.message}`);
    }
    data.activeId = id;
    writePrivate(nodesPath, JSON.stringify(data, null, 2));
    return listNodes();
  } finally { switching = false; }
}

module.exports = { listNodes, importNodes, exportNodes, deleteNode, switchNode };
