const fs = require('node:fs');
const path = require('node:path');
const fail = (message, status = 409) => Object.assign(new Error(message), { status });
async function inspectGame(serverRoot, proc = '/proc') {
  const root = await fs.promises.realpath(serverRoot), found = [];
  for (const name of await fs.promises.readdir(proc)) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const base = path.join(proc, name);
      if ((await fs.promises.readFile(path.join(base, 'comm'), 'utf8')).trim() !== 'srcds_linux') continue;
      if (await fs.promises.readlink(path.join(base, 'cwd')) !== root) continue;
      const stat = (await fs.promises.readFile(path.join(base, 'stat'), 'utf8')).split(') ')[1].split(' '), parent = path.join(proc, stat[1]);
      const args = (await fs.promises.readFile(path.join(parent, 'cmdline'), 'utf8')).split('\0').filter(Boolean);
      const parentRoot = await fs.promises.readlink(path.join(parent, 'cwd'));
      const supervised = parentRoot === root && args.some(arg => path.resolve(parentRoot, arg) === path.join(root, 'srcds_run')) && !args.includes('-norestart');
      found.push({ pid: Number(name), identity: name + ':' + stat[19], supervised });
    } catch { /* a process may exit while /proc is inspected */ }
  }
  return found;
}
function createRestartController({ inspect, terminate = pid => process.kill(pid, 'SIGTERM'), ready = async () => true, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now }) {
  let state = { status: 'idle', message: '尚未执行重启' }, busy = false;
  async function start(payload) {
    if (payload.confirmed !== true) throw fail('请先确认重启游戏', 400);
    if (busy) throw fail('游戏正在重启，请勿重复提交');
    busy = true;
    try {
      const processes = await inspect();
      if (processes.length !== 1 || !processes[0].supervised) throw fail('未找到受 srcds_run 自动重启托管的唯一游戏进程，未执行重启');
      const original = processes[0];
      const current = await inspect();
      if (current.length !== 1 || current[0].identity !== original.identity || !current[0].supervised) throw fail('游戏进程已变化，请刷新重试');
      state = { status: 'restarting', message: '重启请求已确认，正在等待游戏重新就绪…', startedAt: now() };
      await terminate(original.pid);
      (async () => {
        try {
          for (let attempt = 0; attempt < 90; attempt++) {
            await sleep(1000);
            const next = await inspect();
            if (next.length === 1 && next[0].identity !== original.identity && await ready()) { state = { ...state, status: 'completed', message: '游戏服务器已重新启动并响应', completedAt: now() }; return; }
          }
          state = { ...state, status: 'failed', message: '90 秒内未确认游戏重新就绪，请检查服务器日志' };
        } catch (error) { state = { ...state, status: 'failed', message: '重启状态核验失败：' + error.message }; }
        finally { busy = false; }
      })();
      return { ...state };
    } catch (error) { busy = false; state = { ...state, status: 'failed', message: error.message }; throw error; }
  }
  return { start, get: () => ({ ...state }) };
}
module.exports = { createRestartController, inspectGame };
