const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { ZipFile } = require('yazl');

(async () => {
  const root = path.join(__dirname, '..');
  const output = path.join(root, 'downloads', 'L4D2 Baidu Download Helper.zip');
  const zip = new ZipFile();
  const options = { mtime: new Date('2026-01-01T00:00:00Z'), mode: 0o100644 };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  for (const name of ['manifest.json', 'popup.html', 'popup.css', 'popup.js', 'bridge.js', 'background.js']) {
    zip.addFile(path.join(__dirname, 'L4D2 Baidu Download Helper', name), name, options);
  }
  zip.addFile(path.join(__dirname, '使用说明.md'), '使用说明.md', options);
  const done = pipeline(zip.outputStream, fs.createWriteStream(output));
  zip.end();
  await done;
  console.log('Extension ZIP built: ' + fs.statSync(output).size + ' bytes');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
