#!/usr/bin/env node
/**
 * 把 Markdown 文档渲染成 PDF
 *
 * 只使用 Node 内置模块 + 本机已安装的 Chrome，不引入任何额外依赖：
 *   1. 读取 Markdown，转换为带打印样式的 HTML，写入 docs/<name>-print.html
 *   2. 调用 Chrome 的 headless 打印功能输出 PDF
 *   3. 解析 PDF 页数（compact 模式要求控制在 A4 一页以内）
 *
 * 用法：
 *   node scripts/build_pdf.mjs                                   # METRICS.md -> METRICS.pdf（一页版式）
 *   node scripts/build_pdf.mjs --in AI_USAGE.md --out AI_USAGE.pdf --mode doc
 *   CHROME_PATH="/path/to/chrome" node scripts/build_pdf.mjs
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// --------------------------------------------------------------------------
// 参数
// --------------------------------------------------------------------------

function readArgs(argv) {
  const args = { in: 'METRICS.md', out: 'METRICS.pdf', mode: 'compact' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--in') args.in = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--mode') args.mode = argv[++i];
  }
  return args;
}

const args = readArgs(process.argv.slice(2));
const MD_PATH = join(ROOT, args.in);
const PDF_PATH = join(ROOT, args.out);
const HTML_PATH = join(ROOT, 'docs', `${basename(args.out, '.pdf').toLowerCase()}-print.html`);

// --------------------------------------------------------------------------
// 1. 极简 Markdown -> HTML（覆盖本项目文档用到的语法子集）
//    支持：# ## ### 标题、表格、有序列表、段落、**加粗**、`代码`、--- 分隔线
// --------------------------------------------------------------------------

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const inline = (s) =>
  escapeHtml(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

function mdToHtml(md) {
  const lines = md.split('\n');
  const out = [];
  let i = 0;
  const isTableRow = (l) => l.trim().startsWith('|');
  const isHeading = (l) => /^#{1,3}\s/.test(l);
  const isOrdered = (l) => /^\d+\.\s/.test(l.trim());

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i += 1;
      continue;
    }

    if (/^---+\s*$/.test(line.trim())) {
      out.push('<hr />');
      i += 1;
      continue;
    }

    if (line.startsWith('### ')) {
      out.push(`<h3>${inline(line.slice(4))}</h3>`);
      i += 1;
      continue;
    }
    if (line.startsWith('## ')) {
      out.push(`<h2>${inline(line.slice(3))}</h2>`);
      i += 1;
      continue;
    }
    if (line.startsWith('# ')) {
      out.push(`<h1>${inline(line.slice(2))}</h1>`);
      i += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^>\s?/, '').trim());
        i += 1;
      }
      // 引用块内以空行分段，逐段输出为 <p>，避免整段挤成一坨
      const paras = [];
      let cur = [];
      for (const q of quote) {
        if (q) cur.push(q);
        else if (cur.length) {
          paras.push(cur);
          cur = [];
        }
      }
      if (cur.length) paras.push(cur);
      out.push(
        `<blockquote>${paras.map((p) => `<p>${inline(p.join(' '))}</p>`).join('')}</blockquote>`,
      );
      continue;
    }

    if (isTableRow(line)) {
      const rows = [];
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(lines[i]);
        i += 1;
      }
      const cells = (row) =>
        row
          .trim()
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map((c) => c.trim());
      const head = cells(rows[0]);
      const body = rows.slice(2).map(cells);
      out.push('<table>');
      out.push(`<thead><tr>${head.map((h) => `<th>${inline(h)}</th>`).join('')}</tr></thead>`);
      out.push('<tbody>');
      for (const r of body) {
        out.push(`<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`);
      }
      out.push('</tbody></table>');
      continue;
    }

    if (isOrdered(line)) {
      const items = [];
      while (i < lines.length && isOrdered(lines[i])) {
        items.push(lines[i].trim().replace(/^\d+\.\s/, ''));
        i += 1;
      }
      out.push(`<ol>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</ol>`);
      continue;
    }

    const para = [];
    while (i < lines.length && lines[i].trim() && !isTableRow(lines[i]) && !isHeading(lines[i]) && !isOrdered(lines[i]) && !/^>\s?/.test(lines[i]) && !/^---+\s*$/.test(lines[i].trim())) {
      para.push(lines[i].trim());
      i += 1;
    }
    out.push(`<p>${inline(para.join(' '))}</p>`);
  }

  return out.join('\n');
}

// --------------------------------------------------------------------------
// 2. 打印样式
// --------------------------------------------------------------------------

const BASE_CSS = `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    color: #1f2329;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  h2 {
    padding: 2pt 5pt; background: #eef2fd; border-left: 2.4pt solid #2f5be3; color: #1b3aab;
  }
  p { margin: 2.4pt 0; }
  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    background: #f2f4f7; padding: 0 1.5pt; border-radius: 2pt;
  }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th {
    background: #f4f6fa; color: #48505a; font-weight: 600;
    text-align: left; border: 0.5pt solid #d9dee5;
  }
  td { border: 0.5pt solid #e3e7ec; vertical-align: top; }
  tbody tr:nth-child(even) td { background: #fbfcfd; }
  ol { margin: 2.5pt 0 0; padding-left: 13pt; }
  li { margin-bottom: 1.6pt; }
  blockquote {
    margin: 3pt 0; padding: 3pt 7pt; background: #fbfcfd;
    border-left: 2pt solid #d3d8de; color: #3d444d;
  }
  blockquote p { margin: 0 0 3pt; }
  blockquote p:last-child { margin-bottom: 0; }
  hr { border: none; border-top: 0.6pt solid #e3e7ec; margin: 6pt 0; }
`;

// 紧凑版：A4 单页，字号小、内边距紧
const COMPACT_CSS = `
  @page { size: A4 portrait; margin: 9mm 8mm 8mm 8mm; }
  body { font-size: 7.6pt; line-height: 1.34; }
  h1 { font-size: 13.6pt; margin: 0 0 3pt; letter-spacing: .2px; }
  h2 { font-size: 9.2pt; margin: 6.5pt 0 3pt; }
  h3 { font-size: 8.3pt; margin: 5pt 0 3pt; }
  code { font-size: 7.0pt; }
  table { margin: 2.5pt 0 0; }
  th { padding: 3pt 3.6pt; }
  td { padding: 3pt 3.6pt; }
  table th:nth-child(1), table td:nth-child(1) { font-weight: 600; }
  table#metrics th:nth-child(1), table#metrics td:nth-child(1) { width: 10.5%; }
  table#metrics th:nth-child(2), table#metrics td:nth-child(2) { width: 19%; }
  table#metrics th:nth-child(3), table#metrics td:nth-child(3) { width: 24%; }
  table#metrics th:nth-child(4), table#metrics td:nth-child(4) { width: 16%; }
  table#rules th:nth-child(1), table#rules td:nth-child(1) { width: 14.5%; }
  table#rules th:nth-child(2), table#rules td:nth-child(2) { width: 8.5%; }
  table#bounds th:nth-child(1), table#bounds td:nth-child(1) { width: 24%; }
`;

// 常规文档版：正常字号，允许多页
const DOC_CSS = `
  @page { size: A4 portrait; margin: 16mm 15mm; }
  body { font-size: 9.6pt; line-height: 1.55; }
  h1 { font-size: 17pt; margin: 0 0 8pt; }
  h2 { font-size: 11.4pt; margin: 12pt 0 5pt; }
  h3 { font-size: 10.2pt; margin: 9pt 0 4pt; }
  code { font-size: 8.8pt; }
  table { margin: 4pt 0 0; }
  th { padding: 4pt 5pt; }
  td { padding: 4pt 5pt; }
  table th:nth-child(1), table td:nth-child(1) { width: 18%; }
  h2, table, blockquote { break-inside: avoid; }
`;

const PRINT_CSS = BASE_CSS + (args.mode === 'doc' ? DOC_CSS : COMPACT_CSS);

// --------------------------------------------------------------------------
// 3. 生成 HTML 并调用 Chrome 打印
// --------------------------------------------------------------------------

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

const findChrome = () => CHROME_CANDIDATES.find((p) => p && existsSync(p)) ?? null;

const md = readFileSync(MD_PATH, 'utf8');
const body = mdToHtml(md);

const TABLE_IDS = ['metrics', 'rules', 'bounds'];
let tableIndex = 0;
const bodyWithIds = body.replace(/<table>/g, () => {
  const id = TABLE_IDS[tableIndex] ?? `t${tableIndex}`;
  tableIndex += 1;
  return `<table id="${id}">`;
});

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(args.out.replace(/\.pdf$/, ''))}</title>
<style>${PRINT_CSS}</style>
</head>
<body>
${bodyWithIds}
</body>
</html>`;

mkdirSync(dirname(HTML_PATH), { recursive: true });
writeFileSync(HTML_PATH, html, 'utf8');
console.log(`html : ${HTML_PATH}`);

const chrome = findChrome();
if (!chrome) {
  console.error('未找到 Chrome / Chromium，无法生成 PDF。可设置环境变量 CHROME_PATH 指向浏览器可执行文件。');
  process.exit(1);
}

execFileSync(
  chrome,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-pdf-header-footer',
    '--run-all-compositor-stages-before-draw',
    '--virtual-time-budget=4000',
    `--print-to-pdf=${PDF_PATH}`,
    pathToFileURL(HTML_PATH).href,
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] },
);

if (!existsSync(PDF_PATH)) {
  console.error('PDF 生成失败：未产生输出文件。');
  process.exit(1);
}

// --------------------------------------------------------------------------
// 4. 校验页数
// --------------------------------------------------------------------------

const pdf = readFileSync(PDF_PATH);
const raw = pdf.toString('latin1');
const pageCount = (raw.match(/\/Type\s*\/Page(?![s])/g) ?? []).length;

console.log(`pdf  : ${PDF_PATH}  (${(pdf.length / 1024).toFixed(1)} KB)`);
console.log(`页数 : ${pageCount || '未能从 PDF 结构解析（请人工确认）'}`);

if (args.mode === 'compact' && pageCount > 1) {
  console.error('⚠️ 超过一页，请调小 scripts/build_pdf.mjs 中 COMPACT_CSS 的字号或精简内容。');
  process.exit(2);
}
if (args.mode === 'compact') console.log('✅ 已控制在 A4 一页以内。');
