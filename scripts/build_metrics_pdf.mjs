#!/usr/bin/env node
/**
 * 把 METRICS.md 渲染成 A4 一页的 METRICS.pdf
 *
 * 只使用 Node 内置模块 + 本机已安装的 Chrome（无额外依赖）：
 *   1. 读取 METRICS.md，转换为带打印样式的 HTML，写入 docs/metrics-print.html
 *   2. 调用 Chrome 的 headless 打印功能输出 METRICS.pdf
 *   3. 解析 PDF 页数，确认控制在 A4 一页以内
 *
 * 用法：
 *   node scripts/build_metrics_pdf.mjs
 *   CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" node scripts/build_metrics_pdf.mjs
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MD_PATH = join(ROOT, 'METRICS.md');
const HTML_PATH = join(ROOT, 'docs', 'metrics-print.html');
const PDF_PATH = join(ROOT, 'METRICS.pdf');

// --------------------------------------------------------------------------
// 1. 极简 Markdown -> HTML（只覆盖本项目 METRICS.md 用到的语法子集）
// --------------------------------------------------------------------------

const escapeHtml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const inline = (s) =>
  escapeHtml(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

function mdToHtml(md) {
  const lines = md.split('\n');
  const out = [];
  let i = 0;

  const isTableRow = (l) => l.trim().startsWith('|');

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
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

    // 表格：连续以 | 开头的行
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
      const body = rows.slice(2).map(cells); // 第 2 行是分隔线
      out.push('<table>');
      out.push(
        `<thead><tr>${head.map((h) => `<th>${inline(h)}</th>`).join('')}</tr></thead>`,
      );
      out.push('<tbody>');
      for (const r of body) {
        out.push(`<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`);
      }
      out.push('</tbody></table>');
      continue;
    }

    // 有序列表
    if (/^\d+\.\s/.test(line.trim())) {
      const items = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s/, ''));
        i += 1;
      }
      out.push(`<ol>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</ol>`);
      continue;
    }

    // 段落（连续非空行合并；行内以全角空格分隔的「标签 + 说明」保留原样）
    const para = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !isTableRow(lines[i]) &&
      !lines[i].startsWith('#') &&
      !/^\d+\.\s/.test(lines[i].trim())
    ) {
      para.push(lines[i].trim());
      i += 1;
    }
    out.push(`<p>${inline(para.join(' ')).split('　').join('　')}</p>`);
  }

  return out.join('\n');
}

// --------------------------------------------------------------------------
// 2. 打印样式：A4 单页
// --------------------------------------------------------------------------

const PRINT_CSS = `
  @page { size: A4 portrait; margin: 9mm 8mm 8mm 8mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    color: #1f2329;
    font-size: 7.6pt;
    line-height: 1.34;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  h1 { font-size: 13.6pt; margin: 0 0 3pt; letter-spacing: .2px; }
  h2 {
    font-size: 9.2pt; margin: 6.5pt 0 3pt; padding: 2pt 5pt;
    background: #eef2fd; border-left: 2.4pt solid #2f5be3; color: #1b3aab;
  }
  h3 { font-size: 8.3pt; margin: 5pt 0 3pt; }
  p { margin: 2.4pt 0; }
  strong { color: #1f2329; }
  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 7.0pt; background: #f2f4f7; padding: 0 1.5pt; border-radius: 2pt;
  }
  table {
    width: 100%; border-collapse: collapse; margin: 2.5pt 0 0;
    table-layout: fixed;
  }
  th {
    background: #f4f6fa; color: #48505a; font-weight: 600;
    text-align: left; padding: 3pt 3.6pt; border: 0.5pt solid #d9dee5;
  }
  td {
    padding: 3pt 3.6pt; border: 0.5pt solid #e3e7ec; vertical-align: top;
  }
  tbody tr:nth-child(even) td { background: #fbfcfd; }
  ol { margin: 2.5pt 0 0; padding-left: 12pt; }
  li { margin-bottom: 1.6pt; }
  table th:nth-child(1), table td:nth-child(1) { font-weight: 600; }
  table#metrics th:nth-child(1), table#metrics td:nth-child(1) { width: 10.5%; }
  table#metrics th:nth-child(2), table#metrics td:nth-child(2) { width: 19%; }
  table#metrics th:nth-child(3), table#metrics td:nth-child(3) { width: 24%; }
  table#metrics th:nth-child(4), table#metrics td:nth-child(4) { width: 16%; }
  table#rules th:nth-child(1), table#rules td:nth-child(1) { width: 14.5%; }
  table#rules th:nth-child(2), table#rules td:nth-child(2) { width: 8.5%; }
  table#bounds th:nth-child(1), table#bounds td:nth-child(1) { width: 24%; }
`;

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

function findChrome() {
  for (const p of CHROME_CANDIDATES) {
    if (p && existsSync(p)) return p;
  }
  return null;
}

const md = readFileSync(MD_PATH, 'utf8');
const body = mdToHtml(md);

// 给各张表加 id，便于分别控制列宽
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
<title>AIGC 互动大屏运营看板 · 指标口径说明</title>
<style>${PRINT_CSS}</style>
</head>
<body>
${bodyWithIds}
</body>
</html>`;

mkdirSync(dirname(HTML_PATH), { recursive: true });
writeFileSync(HTML_PATH, html, 'utf8');
console.log(`written: ${HTML_PATH}`);

const chrome = findChrome();
if (!chrome) {
  console.error(
    '未找到 Chrome / Chromium，无法生成 PDF。可设置环境变量 CHROME_PATH 指向浏览器可执行文件。',
  );
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

console.log(`written: ${PDF_PATH}  (${(pdf.length / 1024).toFixed(1)} KB)`);
console.log(`页数：${pageCount || '未能从 PDF 结构解析（请人工确认）'}`);
if (pageCount > 1) {
  console.error('⚠️ 超过一页，请调小 docs/metrics-print.html 中的字号或精简内容。');
  process.exit(2);
}
console.log('✅ 已控制在 A4 一页以内。');
