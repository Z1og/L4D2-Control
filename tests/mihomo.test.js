const test = require('node:test');
const assert = require('node:assert/strict');
const { parseNodes, bridge } = require('../mihomo manager');

test('Subscription config imports only nodes, leaving full-system settings behind', () => {
  const nodes = parseNodes('tun:\n  enable: true\nexternal-controller: 0.0.0.0:9090\nproxies:\n  - name: Example\n    type: trojan\n    server: example.com\n    port: 443\n    password: fixture\n');
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].config.name, 'Example');
  assert.equal(nodes[0].config.tun, undefined);
  assert.equal(nodes[0].config['external-controller'], undefined);
});

test('VLESS Reality, VMess WebSocket and base64 subscriptions retain transport details', () => {
  const vless = 'vless://00000000-0000-4000-8000-000000000001@example.com:443?security=reality&pbk=public&sid=abcd&sni=example.com&type=tcp&flow=xtls-rprx-vision#Example';
  const node = parseNodes(Buffer.from(vless).toString('base64'))[0].config;
  assert.equal(node.tls, true); assert.equal(node['reality-opts']['short-id'], 'abcd'); assert.equal(node.flow, 'xtls-rprx-vision');
  const vmess = { ps: 'WebSocket', add: 'example.com', port: '443', id: '00000000-0000-4000-8000-000000000001', net: 'ws', path: '/socket', host: 'cdn.example.com', tls: 'tls' };
  const ws = parseNodes('vmess://' + Buffer.from(JSON.stringify(vmess)).toString('base64'))[0].config;
  assert.equal(ws['ws-opts'].path, '/socket'); assert.equal(ws['ws-opts'].headers.Host, 'cdn.example.com');
});

test('Parser rejects unsupported dependencies, invalid ports and incompatible Xray transport', () => {
  assert.throws(() => parseNodes('proxies: [{name: x, type: trojan, server: example.com, port: 70000, password: x}]'));
  assert.throws(() => parseNodes('proxies: [{name: x, type: trojan, server: example.com, port: 443, password: x, dialer-proxy: other}]'));
  assert.throws(() => parseNodes('vless://00000000-0000-4000-8000-000000000001@example.com:443?type=tcp&headerType=http'), /Xray/);
});

test('Dashboard cannot enable TUN, change listeners, load files or access arbitrary core paths', () => {
  for (const [method, route] of [['PATCH', '/configs'], ['PUT', '/configs'], ['PUT', '/providers/proxies/custom'], ['GET', '/ui/../config.json'], ['POST', '/restart'], ['PUT', '/proxies/GLOBAL']]) {
    let code = null, finished = false;
    bridge({ method }, { writeHead(status) { code = status; }, end() { finished = true; } }, route);
    assert.equal(code, 403); assert.equal(finished, true);
  }
});
