// 0.1 冻结基线构建：legacy/1.1.20 → dist/1.2.0（功能零改动，仅版本/元数据/变更日志）
// 铁律：产物与 legacy 的逻辑差异必须为 0——构建后打印 diff 行清单供审计。
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const LEGACY = join(ROOT, 'legacy', '烂梗机-1.1.20.user.js');
const VERSION = '1.2.0';
const OUT_DIR = join(ROOT, 'dist');

function loadMeta() {
  let m;
  try { m = JSON.parse(readFileSync(join(HERE, 'meta.json'), 'utf8')); }
  catch { m = {}; }
  if (m.owner && m.repo) {
    m.homepage = m.homepage.replaceAll('{owner}', m.owner).replaceAll('{repo}', m.repo);
    m.updateURL = m.updateURL.replaceAll('{owner}', m.owner).replaceAll('{repo}', m.repo);
    m.downloadURL = m.downloadURL.replaceAll('{owner}', m.owner).replaceAll('{repo}', m.repo);
  } else {
    m.homepage = m.updateURL = m.downloadURL = '';
  }
  return m;
}

const meta = loadMeta();

function editUserScript(src) {
  const lines = src.split('\n');
  const out = [];
  let inMeta = false;
  let metaClosed = false;
  let diff = [];
  let versionChanges = 0;
  for (const line of lines) {
    if (line.startsWith('// ==UserScript==')) { inMeta = true; out.push(line); continue; }
    if (inMeta && line.startsWith('// ==/UserScript==')) {
      inMeta = false;
      metaClosed = true;
      // 追加缺失的自动更新元数据
      if (meta.homepage) out.push(`// @homepageURL   ${meta.homepage}`);
      if (meta.updateURL) out.push(`// @updateURL     ${meta.updateURL}`);
      if (meta.downloadURL) out.push(`// @downloadURL   ${meta.downloadURL}`);
      out.push(`// @author        ${meta.author || 'LaGenJi contributors'}`);
      out.push(`// @license       ${meta.license || 'MIT'}`);
      out.push(line);
      continue;
    }
    if (inMeta && /^\/\/ @version\s+/.test(line)) {
      const v = line.replace(/1\.1\.\d+/, VERSION);
      diff.push(`@version: ${line.trim()} -> ${v.trim()}`);
      out.push(v);
      continue;
    }
    // 版本历史块：在头部插入 1.2.0 工程化基线说明
    if (!inMeta && line.startsWith('// 版本历史：')) {
      out.push(line);
      out.push(`// ${VERSION} 工程化基线（L0）：功能与 1.1.20 行为冻结等价，仅版本/元数据变更；`);
      out.push(`//             Monorepo + TS 工程骨架落位 v2/，详见 v2/SPEC.md（L0-L4 规格）`);
      continue;
    }
    // body 内版本常量（脚本自检/防重标记用，改版本号必然触达）
    if (!inMeta && /INSTALLED_VERSION\s*=\s*'1\.1\.\d+'/.test(line)) {
      const v = line.replace(/1\.1\.\d+/, VERSION);
      diff.push(`INSTALLED_VERSION: ${line.trim()} -> ${v.trim()}`);
      versionChanges++;
      out.push(v);
      continue;
    }
    out.push(line);
  }
  // 版本历史块首行前插入 1.2.0 说明（定位在文件开头的版本注释区）
  return { text: out.join('\n'), diff, metaClosed, versionChanges };
}

function checkBalance(src, edited) {
  // 保守守卫：剥离注释后 body 逻辑字符应一致（版本常量差异除外）
  const strip = (s) => s.split('\n').filter(l => !/^\s*\/\//.test(l) && !l.trim().startsWith('//')).join('\n');
  const a = strip(src).replace(/'1\.1\.20'/g, '').replace(/1\.1\.20/g, '');
  const b = strip(edited).replace(/'1\.2\.0'/g, '').replace(/1\.2\.0/g, '');
  return a === b;
}

if (!existsSync(LEGACY)) { console.error('缺少 legacy 基线: ' + LEGACY); process.exit(1); }
const src = readFileSync(LEGACY, 'utf8');
const { text, diff, metaClosed } = editUserScript(src);
if (!checkBalance(src, text)) { console.error('FAIL: 逻辑体存在意外差异（版本常量之外）'); process.exit(1); }
if (!metaClosed) { console.error('FAIL: 未找到 userscript 元数据闭合'); process.exit(1); }

mkdirSync(OUT_DIR, { recursive: true });
const outFile = join(OUT_DIR, `烂梗机-${VERSION}.frozen.user.js`);
writeFileSync(outFile, text, 'utf8');

console.log('OK  产物: ' + outFile);
console.log('     字节: ' + Buffer.byteLength(text));
console.log('     等价审计: 逻辑体差异 = 0（已剥离注释并归一版本号后逐字比对）');
console.log('     元数据变更行:');
for (const d of diff) console.log('       - ' + d);
if (!meta.owner || !meta.repo) {
  console.warn('WARN meta.json 未填 owner/repo：@updateURL/@downloadURL 未注入。填好 release 后即可自动更新。');
}
