const crypto = require('node:crypto');
const { requestIP } = require('./ip regions');

const GUEST_READ = new Set(['/api/config', '/api/status', '/api/maps', '/api/plugins']);
const GUEST_WRITE = new Set(['/api/openlist/map-download-info']);
const PUBLIC_FILES = new Set(['/login', '/login.html', '/login.js', '/login.css']);
const PANEL_FILES = new Set(['/', '/index.html', '/app.js', '/players.js', '/gameplay.js', '/styles.css', '/downloads/baidu-download-helper.zip', '/downloads/baidu-download-helper-guide']);
const COOKIE = 'l4d2-session';
const fail = (message, status = 403) => Object.assign(new Error(message), { status });
const equal = (left, right) => { const a = crypto.createHash('sha256').update(String(left)).digest(), b = crypto.createHash('sha256').update(String(right)).digest(); return crypto.timingSafeEqual(a, b); };
function sameOrigin(req) {
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  if (!req.headers.origin) return true;
  return req.headers.origin === `${req.socket.encrypted ? 'https' : 'http'}://${req.headers.host}`;
}
function createAccess({ username = 'admin', password = '', token = '', authenticateGuest, isBanned = async () => false, audit = async () => {}, trustedProxies = [], now = Date.now, randomBytes = crypto.randomBytes, maxSessions = 2000 } = {}) {
  const sessions = new Map(), attempts = new Map();
  const sessionCookie = req => String(req.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
  function prune() { for (const [key, value] of sessions) if (value.expires <= now()) sessions.delete(key); for (const [key, value] of attempts) if (value.until <= now()) attempts.delete(key); }
  function identify(req, legacy = true) {
    const id = sessionCookie(req);
    if (id !== undefined) { const session = sessions.get(id); if (session && session.expires > now()) return { ...session, id, via: 'session' }; if (session) sessions.delete(id); return null; }
    if (!legacy) return null;
    const header = String(req.headers.authorization || '');
    if (password && header.startsWith('Basic ')) { const value = Buffer.from(header.slice(6), 'base64').toString('utf8'), split = value.indexOf(':'); if (split > 0 && equal(value.slice(0, split), username) && equal(value.slice(split + 1), password)) return { role: 'admin', via: 'header', name: username }; }
    const supplied = req.headers['x-panel-token'] || (header.startsWith('Bearer ') ? header.slice(7) : '');
    if (token && supplied && equal(supplied, token)) return { role: 'admin', via: 'header', name: username };
    return null;
  }
  function cookie(req, id, age) { return `${COOKIE}=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${req.socket.encrypted ? '; Secure' : ''}`; }
  function issue(req, res, role, identity = {}) {
    prune(); const previous = sessionCookie(req); if (previous) sessions.delete(previous);
    if (role === 'admin' && sessions.size >= maxSessions) { const ordinary = [...sessions].find(([, value]) => value.role === 'guest'); if (ordinary) sessions.delete(ordinary[0]); }
    if (sessions.size >= maxSessions) throw fail('当前访问人数较多，请稍后再试', 503);
    const id = randomBytes(32).toString('hex'), csrf = randomBytes(24).toString('hex'), age = role === 'admin' ? 8 * 3600 : 24 * 3600;
    const session = { role, csrf, ...identity, name: role === 'admin' ? username : identity.name || '普通用户', expires: now() + age * 1000 };
    sessions.set(id, session); res.setHeader('set-cookie', cookie(req, id, age)); return publicSession(session);
  }
  function publicSession(session) { return session ? { authenticated: true, role: session.role, name: session.name, steam64:session.steam64 || '', identityVerified:session.role === 'admin' ? null : false, csrf: session.csrf, expiresAt: session.expires } : { authenticated: false, role: null, administratorLoginAvailable: Boolean(password) }; }
  function checkMutation(req, session, pathname) {
    if (!sameOrigin(req)) throw fail('跨站请求已拒绝');
    if (session?.via === 'session' && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (pathname.startsWith('/mihomo/') && (req.headers.origin || req.headers['sec-fetch-site'] === 'same-origin')) return;
      if (!req.headers['x-csrf-token'] || !equal(req.headers['x-csrf-token'], session.csrf)) throw fail('页面验证已过期，请刷新后重试');
    }
  }
  async function authorize(req, pathname) {
    const session = identify(req); if (!session) throw fail('请先登录', 401);
    if (session.role === 'guest' && (!session.steam64 || await isBanned(session.steam64))) { sessions.delete(session.id); throw fail('该账号已被拉黑，登录已失效', 401); }
    checkMutation(req, session, pathname);
    if (session.role === 'admin') return session;
    const allowed = ['GET', 'HEAD'].includes(req.method) && (PANEL_FILES.has(pathname) || req.method === 'GET' && GUEST_READ.has(pathname)) || req.method === 'POST' && GUEST_WRITE.has(pathname);
    if (!allowed) throw fail('普通账号仅可查看公开信息和直连下载地图');
    if (req.method === 'POST') { const entry=sessions.get(session.id),minute=Math.floor(now()/60000); if(entry.downloadMinute!==minute){entry.downloadMinute=minute;entry.downloadCount=0;}if(++entry.downloadCount>20)throw fail('直连请求过于频繁，请稍后再试',429); }
    return session;
  }
  async function auth(req, res, pathname, body = {}) {
    if (req.method === 'GET' && pathname === '/api/auth/session') { const session=identify(req,false); if(session?.role==='guest'&&await isBanned(session.steam64)){sessions.delete(session.id);return publicSession(null);}return publicSession(session); }
    if (req.method !== 'POST') throw fail('不支持的请求方法', 405);
    if (!sameOrigin(req) || !/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw fail('登录请求来源或格式无效');
    if (['/api/auth/login','/api/auth/guest','/api/auth/register'].includes(pathname)) {
      prune(); const ip=requestIP(req,trustedProxies),key = (pathname === '/api/auth/login' ? 'admin:' : 'guest:') + (ip || 'unknown'), entry = attempts.get(key);
      if (entry?.count >= 8) { res.setHeader('retry-after', Math.max(1, Math.ceil((entry.until - now()) / 1000))); throw fail('尝试次数较多，请 15 分钟后再试', 429); }
      if (pathname !== '/api/auth/login') {
        if (!authenticateGuest) throw fail('普通账号登录暂不可用',503);
        if (!entry && attempts.size >= 5000) throw fail('当前登录请求较多，请稍后再试',429);
        attempts.set(key,{count:(entry?.count||0)+1,until:entry?.until||now()+15*60000});
        try { const identity=await authenticateGuest(body,ip,pathname==='/api/auth/register');attempts.delete(key);return issue(req,res,'guest',identity); }
        catch(error){await audit({role:'guest',actor:'普通登录',action:pathname.endsWith('/register')?'register-denied':'login-denied',ok:false,ip}).catch(()=>{});throw error;}
      }
      if (!password) throw fail('授权登录尚未配置，请设置 PANEL_PASSWORD', 503);
      if (typeof body.username !== 'string' || typeof body.password !== 'string' || !equal(body.username, username) || !equal(body.password, password)) {
        if (!entry && attempts.size >= 5000) throw fail('当前登录请求较多，请稍后再试', 429);
        attempts.set(key, { count: (entry?.count || 0) + 1, until: entry?.until || now() + 15 * 60 * 1000 }); await audit({role:'admin',actor:'授权登录',action:'login-denied',ok:false,ip}).catch(()=>{}); throw fail('用户名或密码不正确', 401);
      }
      attempts.delete(key); await audit({role:'admin',actor:username,action:'login',ok:true,ip});return issue(req, res, 'admin');
    }
    if (pathname === '/api/auth/logout') { const current = identify(req, false); if (current) checkMutation(req, current, pathname); const id = sessionCookie(req); if (id) sessions.delete(id); res.setHeader('set-cookie', cookie(req, 'signed-out', 86400)); return { ok: true }; }
    throw fail('接口不存在', 404);
  }
  return { identify, authorize, auth, publicSession, administratorLoginAvailable: Boolean(password) };
}
module.exports = { createAccess, sameOrigin, GUEST_READ, GUEST_WRITE, PUBLIC_FILES, PANEL_FILES };
