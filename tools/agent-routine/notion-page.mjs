#!/usr/bin/env node
// Usage: node tools/agent-routine/notion-page.mjs <page URL or id> [--max-blocks 800]
// Read-only: prints a Notion page's body as plain text (meeting notes, spec pages).
import { loadEnv } from '../../lib/env.mjs';
import { retrieveBlockChildren } from '../../lib/notion.mjs';

loadEnv();
const args = process.argv.slice(2);
const target = args.find(arg => !arg.startsWith('--'));
const maxIndex = args.indexOf('--max-blocks');
const budget = { remaining: maxIndex >= 0 ? Number(args[maxIndex + 1]) : 800 };

function pageId(value) {
  const pattern = /(?<![0-9a-f])(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?![0-9a-f])/gi;
  const hex = String(value || '').split(/[?#]/)[0].match(pattern)?.at(-1)?.replace(/-/g, '');
  if (!hex) throw new Error(`Notion 페이지 ID를 찾을 수 없습니다: ${value}`);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function blockText(block) {
  const content = block?.[block.type];
  if (Array.isArray(content?.cells)) return content.cells.map(cell => (cell || []).map(text => text.plain_text || '').join('')).join(' | ');
  if (block.type === 'child_page') return `[하위 페이지] ${content?.title || ''}`;
  return (content?.rich_text || []).map(text => text.plain_text || '').join('');
}

async function walk(id, depth, lines) {
  if (depth > 4 || budget.remaining <= 0) return;
  for (const block of await retrieveBlockChildren(id)) {
    if (budget.remaining-- <= 0) { lines.push('…(블록 한도 도달, 이후 생략)'); return; }
    const text = blockText(block).trim();
    if (text) lines.push(`${'  '.repeat(depth)}${text}`);
    if (block.has_children && block.type !== 'child_page') await walk(block.id, depth + 1, lines);
  }
}

try {
  if (!process.env.NOTION_TOKEN) throw new Error('NOTION_TOKEN 환경변수가 없습니다.');
  const lines = [];
  await walk(pageId(target), 0, lines);
  console.log(lines.join('\n'));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
