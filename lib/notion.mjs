const API = 'https://api.notion.com/v1';
const VERSION = '2022-06-28';

async function call(pathname, { method = 'GET', body } = {}) {
  const res = await fetch(`${API}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
      'Notion-Version': VERSION,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 429) {
    const wait = Number(res.headers.get('retry-after') || 1) * 1000;
    await new Promise(r => setTimeout(r, wait));
    return call(pathname, { method, body });
  }
  const json = await res.json();
  if (!res.ok) throw new Error(`Notion ${res.status} ${pathname}: ${json.message || res.statusText}`);
  return json;
}

// 페이지네이션 전체 조회
export async function queryDatabase(dbId, filter, sorts) {
  const rows = [];
  let cursor;
  do {
    const body = { page_size: 100 };
    if (filter) body.filter = filter;
    if (sorts) body.sorts = sorts;
    if (cursor) body.start_cursor = cursor;
    const res = await call(`/databases/${dbId}/query`, { method: 'POST', body });
    rows.push(...res.results);
    cursor = res.has_more ? res.next_cursor : null;
  } while (cursor);
  return rows;
}

export async function searchDatabases(query) {
  const out = [];
  let cursor;
  do {
    const body = { query, filter: { property: 'object', value: 'database' }, page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const res = await call('/search', { method: 'POST', body });
    out.push(...res.results);
    cursor = res.has_more ? res.next_cursor : null;
  } while (cursor);
  return out;
}

// Notion 속성 객체 → 평평한 JS 값
export function flatten(page) {
  const out = { _id: page.id, _url: page.url, _created: page.created_time, _edited: page.last_edited_time };
  for (const [name, prop] of Object.entries(page.properties || {})) {
    out[name] = flatProp(prop);
  }
  return out;
}

function richText(arr) {
  return (arr || []).map(t => t.plain_text).join('');
}

function flatProp(p) {
  switch (p.type) {
    case 'title': return richText(p.title);
    case 'rich_text': return richText(p.rich_text);
    case 'select': return p.select?.name ?? null;
    case 'status': return p.status?.name ?? null;
    case 'multi_select': return (p.multi_select || []).map(o => o.name);
    case 'people': return (p.people || []).map(u => u.name || u.id);
    case 'relation': return (p.relation || []).map(page => page.id);
    case 'date': return p.date ? { start: p.date.start, end: p.date.end } : null;
    case 'checkbox': return p.checkbox;
    case 'number': return p.number;
    case 'url': return p.url;
    case 'created_time': return p.created_time;
    case 'formula': return p.formula?.[p.formula?.type] ?? null;
    default: return null;
  }
}

export function dbTitle(db) {
  return richText(db.title).trim();
}
