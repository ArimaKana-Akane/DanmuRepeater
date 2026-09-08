// md5 实现向量校验：与 Node crypto 逐字比对
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, 'hybrid', 'md5.js'), 'utf8')
  .replace('export function md5', 'function md5');
const md5 = new Function(src + '; return md5;')();

const cases = [
  '', 'abc', 'message digest', 'abcdefghijklmnopqrstuvwxyz',
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
  '12345678901234567890123456789012345678901234567890123456789012345678901234567890',
  '你好，烂梗机 wbi mixinKey 中文测试',
  'x'.repeat(1000),
];
let bad = 0;
for (const c of cases) {
  const expect = createHash('md5').update(c).digest('hex');
  const got = md5(c);
  if (expect !== got) {
    bad++;
    console.log(`MISMATCH input=${JSON.stringify(c.slice(0, 40))} expect=${expect} got=${got}`);
  }
}
if (bad) { console.log(`FAIL ${bad}/${cases.length}`); process.exit(1); }
console.log(`OK md5 实现通过 ${cases.length} 组向量（含中文与 1000 字节长串）`);
