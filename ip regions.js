const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
function normalizeIP(value) {
  let ip = String(value || '').trim();
  if (ip.startsWith('::ffff:') && net.isIP(ip.slice(7)) === 4) ip = ip.slice(7);
  return net.isIP(ip) ? ip : '';
}
function requestIP(req, trustedProxies = []) {
  const peer = normalizeIP(req.socket.remoteAddress);
  if (trustedProxies.map(normalizeIP).includes(peer)) {
    const parts = String(req.headers['x-forwarded-for'] || '').split(',').map(normalizeIP).filter(Boolean);
    while (parts.length && trustedProxies.map(normalizeIP).includes(parts.at(-1))) parts.pop();
    if (parts.length) return parts.at(-1);
  }
  return peer;
}
function privateIP(ip) {
  return !ip || /^(?:127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(ip) || /^172\.(?:1[6-9]|2\d|3[01])\./.test(ip) || ip === '::1' || ip === '::' || /^(?:fc|fd|fe[89ab])/i.test(ip);
}
function createRegions({ directory = '', lookup, now = Date.now } = {}) {
  const cache = new Map(), searchers = new Map(); let queue = Promise.resolve();
  async function search(ip) {
    if (lookup) return lookup(ip);
    const version = net.isIP(ip), file = directory && path.join(directory, version === 4 ? 'ip2region v4.xdb' : 'ip2region v6.xdb');
    if (!file || !fs.existsSync(file)) return '';
    const api = await import('ip2region.js');
    if (!searchers.has(version)) { api.verifyFromFile(file); searchers.set(version, api.newWithVectorIndex(version === 4 ? api.IPv4 : api.IPv6, file, api.loadVectorIndexFromFile(file))); }
    return searchers.get(version).search(ip);
  }
  async function locate(value) {
    const ip = normalizeIP(value); if (privateIP(ip)) return { country:'', province:'', label:ip ? '内网 / 本机' : '未知', approximate:true };
    const old = cache.get(ip); if (old && now() - old.at < 86400000) return old.value;
    const job = queue.then(async () => { try { const raw = await search(ip), [country, province] = String(raw).split('|').map(s => s === '0' ? '' : s); return { country:country || '', province:province || '', label:[country,province].filter(Boolean).join(' · ') || '未知省份', approximate:true }; } catch { return { country:'',province:'',label:'未知省份',approximate:true }; } });
    queue = job.catch(() => {}); const result = await job;
    if (cache.size >= 5000) cache.delete(cache.keys().next().value); cache.set(ip,{at:now(),value:result}); return result;
  }
  return { locate, close: () => { for (const s of searchers.values()) s.close(); searchers.clear(); } };
}
module.exports = { normalizeIP, requestIP, privateIP, createRegions };
