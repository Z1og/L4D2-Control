// L4D2-Control project identity: l4d2-control-bf312edc896c79baad5c | SPDX-License-Identifier: LicenseRef-L4D2-Control-NonCommercial-1.0
const crypto = require('node:crypto');
const fail = message => Object.assign(new Error(message), { status: 502 });
const key = url => crypto.createHash('sha256').update(url).digest('hex').slice(0, 24);
// Only enumerate publisher-owned packages. Client input never supplies a URL.
async function officialCatalog(id, fetchImpl = fetch) {
  const read = async url => {
    const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(30000), headers: { 'user-agent': 'L4D2-Control', accept: 'application/json, text/html, text/plain' } });
    if (!response.ok) throw fail(`官方版本源请求失败（HTTP ${response.status}）`);
    if (Number(response.headers.get('content-length')) > 4 * 1024 * 1024) throw fail('版本索引过大');
    const chunks = []; let bytes = 0;
    for await (const chunk of response.body) { bytes += chunk.length; if (bytes > 4 * 1024 * 1024) throw fail('版本索引过大'); chunks.push(Buffer.from(chunk)); }
    return Buffer.concat(chunks).toString('utf8');
  };
  const versions = [], warnings = [];
  if (['metamod', 'sourcemod'].includes(id)) {
    const root = id === 'metamod' ? 'https://mms.alliedmods.net/mmsdrop/' : 'https://sm.alliedmods.net/smdrop/';
    const prefix = id === 'metamod' ? 'mmsource' : 'sourcemod';
    const links = html => [...html.matchAll(/href=["']([^"']+)["']/gi)].map(match => match[1]);
    const branches = [...new Set(links(await read(root)).filter(value => /^1\.\d+\/$/.test(value)))];
    if (!branches.length || branches.length > 30) throw fail('官方分支索引格式不匹配');
    let latestFile = '';
    try { latestFile = (await read(root + '1.12/' + prefix + '-latest-linux')).trim(); } catch (error) { warnings.push('稳定版标记：' + error.message); }
    await Promise.all(branches.map(async branch => {
      try {
        const files = links(await read(root + branch)); let count = 0;
        for (const file of new Set(files)) {
          const match = file.match(new RegExp('^' + prefix + '-(1\\.\\d+\\.\\d+-(?:git|hg)\\d+)-linux(-clang)?\\.tar\\.gz$'));
          if (!match || !match[1].startsWith(branch.slice(0, -1) + '.')) continue;
          const url = root + branch + file, series = branch.slice(0, -1), minor = Number(series.split('.')[1]);
          const channel = minor > 12 ? '开发版' : minor === 12 ? '稳定分支' : '历史分支';
          const notes = [id === 'metamod' ? '适用于 Source 1 的 Linux x86 服务端；不安装 Source 2 构建。' : 'Linux x86 构建；切换会更新核心、扩展和 gamedata，保留已有 SMX 与配置。',
            minor > 12 ? '开发分支可能包含不兼容变更，不建议直接用于正式服。' : minor < 12 ? '历史分支可能不适配当前游戏更新；旧插件、扩展和 gamedata 需一起核验。' : '1.12 分支构建；同分支不同构建仍可能影响插件兼容性。',
            id === 'metamod' ? '降低 MetaMod 版本前请检查 SourceMod、L4DToolZ 和 Stripper 的要求。' : '请先安装匹配的 MetaMod；Left4DHooks 等依赖仍在插件管理维护。'];
          if (match[2]) notes.push('历史 Clang 编译构建；与普通构建的运行库要求可能不同。');
          versions.push({ id: key(url), version: match[1], url, file, branch: series + (match[2] ? ' · Clang' : ''), channel, recommended: file === latestFile, notes, releaseNotes: '官方构建索引未提供逐构建说明；请参考官方使用说明与变更记录。' }); count++;
        }
        if (!count) warnings.push(seriesName(branch) + '：没有可用 Linux x86 tar.gz 构建');
      } catch (error) { warnings.push(branch + '：' + error.message); }
    }));
  } else if (['l4dtoolz', 'stripper'].includes(id)) {
    const repo = id === 'l4dtoolz' ? 'accelerator74/l4dtoolz' : 'alliedmodders/stripper-source';
    let finished = false;
    for (let page = 1; page <= 20; page++) {
      let releases;
      try { releases = JSON.parse(await read(`https://api.github.com/repos/${repo}/releases?per_page=100&page=${page}`)); }
      catch (error) { if (!versions.length) throw error; warnings.push('后续发行页未读取完整：' + error.message); break; }
      if (!Array.isArray(releases)) throw fail('官方发行索引格式不匹配');
      for (const release of releases) {
        if (release.draft || !/^[\w.-]{1,80}$/.test(release.tag_name)) continue;
        for (const asset of release.assets || []) {
          const valid = id === 'l4dtoolz' ? /^l4dtoolz-l4d2-(?:linux|oldlinux)-[a-f0-9]+\.tar\.gz$|^l4dtoolz-l4d2-[a-f0-9]+\.zip$/.test(asset.name) : /^stripper-[\w.-]+-linux\.tar\.gz$/.test(asset.name) && !/-mms2\./.test(asset.name);
          if (!valid) continue;
          const url = `https://github.com/${repo}/releases/download/${release.tag_name}/${asset.name}`;
          if (asset.browser_download_url !== url || !Number.isFinite(asset.size) || asset.size <= 0 || asset.size > 96 * 1024 * 1024) throw fail('官方资源地址或大小无效');
          const variant = id === 'l4dtoolz' ? asset.name.includes('-oldlinux-') ? '旧 Linux 兼容构建' : asset.name.endsWith('.zip') ? '历史混合包（仅提取 Linux）' : 'Linux' : asset.name.match(/-mms(1\.\d+)-/) ? 'MetaMod ' + asset.name.match(/-mms(1\.\d+)-/)[1] : '历史 Linux 构建';
          const notes = id === 'l4dtoolz' ? [release.tag_name === '2.2.0' ? '2.2.0 改用 -maxplayers，旧的 +maxplayers 启动参数不再读取。' : '旧版人数扩展；启动参数与新版本可能不同，请核验多人房间和大厅行为。', variant.includes('旧 Linux') ? '仅在普通 Linux 包因系统兼容问题无法加载时考虑 oldlinux 构建。' : '仅安装 L4D2 的 Linux x86 二进制，不安装 L4D1 或 Windows 文件。', '避免与其他人数扩展重复；人数和 Bot 仍需在游戏模式配置。'] : [variant.startsWith('MetaMod') ? `此包要求 ${variant}；不要与其他 MetaMod ABI 混用。` : '历史包未显式标注 MetaMod ABI；升级或降级前需核对官方构建说明。', '保留现有 maps 与 global_filters 配置；实体规则可能改变地图流程。'];
          if (release.prerelease) notes.unshift('预发布版本，正式服使用前请先测试。');
          versions.push({ id: key(url), version: release.tag_name.replace(/^v/, ''), url, file: asset.name, branch: variant, channel: release.prerelease ? '预发布' : '正式发行', publishedAt: release.published_at || null, notes, releaseNotes: String(release.body || '官方未提供该发行的详细说明。').slice(0, 12000), sha256: /^sha256:[a-f0-9]{64}$/.test(asset.digest || '') ? asset.digest.slice(7) : null });
        }
      }
      if (releases.length < 100) { finished = true; break; }
    }
    if (!finished && !warnings.length) warnings.push('发行页达到安全读取上限，请到官方仓库查看更早的版本。');
  } else throw fail('未知平台组件');
  const collator = new Intl.Collator('en', { numeric: true });
  versions.sort((a, b) => collator.compare(b.version, a.version) || a.branch.localeCompare(b.branch));
  if (!versions.length) throw fail('官方源没有可用的 L4D2 Linux 安装包');
  const latest = versions.find(item => item.recommended) || versions.find(item => item.channel === '正式发行' && !item.branch.includes('旧 Linux')) || null;
  if (latest) latest.recommended = true;
  return { versions, latest, warnings, complete: warnings.length === 0, checkedAt: new Date().toISOString() };
}
function seriesName(branch) { return branch.replace(/\/$/, '') + ' 分支'; }
module.exports = { officialCatalog };
