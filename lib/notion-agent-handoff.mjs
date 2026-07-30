import { createDatabasePage, queryDatabase, updatePageProperties } from './notion.mjs';

const MAX_RICH_TEXT_CHUNK = 1900;
const MAX_RICH_TEXT_ITEMS = 100;
const MAX_PAYLOAD_LENGTH = MAX_RICH_TEXT_CHUNK * MAX_RICH_TEXT_ITEMS;

function textObjects(value, maxItems = MAX_RICH_TEXT_ITEMS) {
  const text = String(value || '');
  const parts = [];
  for (let index = 0; index < text.length && parts.length < maxItems; index += MAX_RICH_TEXT_CHUNK) {
    parts.push({ type: 'text', text: { content: text.slice(index, index + MAX_RICH_TEXT_CHUNK) } });
  }
  return parts;
}

function title(value) {
  return { title: textObjects(value, 1) };
}

function richText(value) {
  return { rich_text: textObjects(value) };
}

function date(value) {
  return { date: value ? { start: value } : null };
}

function inputRunId(packet) {
  return `rule-input:${packet.runId}`;
}

function packetDate(packet) {
  return packet.runId.slice(0, 10);
}

function propertiesFor(packet) {
  return {
    이름: title(`규칙 입력 / ${packetDate(packet)}`),
    프로젝트명: richText('규칙 입력'),
    기준일: date(packetDate(packet)),
    run_id: richText(inputRunId(packet)),
    '현재 진행 요약': richText('대시보드 규칙 엔진이 게시한 에이전트용 정량 사실 스냅샷'),
    payload: richText(JSON.stringify(packet)),
  };
}

export async function publishAgentInputToNotion({ databaseId, packet, query = queryDatabase, create = createDatabasePage, update = updatePageProperties }) {
  const payloadLength = remotePacketSize(packet);
  if (payloadLength > MAX_PAYLOAD_LENGTH) throw new Error(`원격 규칙 입력이 Notion payload 한도(${MAX_PAYLOAD_LENGTH}자)를 초과했습니다: ${payloadLength}자`);
  const runId = inputRunId(packet);
  const rows = await query(databaseId, { property: 'run_id', rich_text: { equals: runId } });
  const properties = propertiesFor(packet);
  if (rows[0]) {
    await update(rows[0].id, properties);
    return { status: 'updated', pageId: rows[0].id, runId, date: packetDate(packet), bytes: payloadLength };
  }
  const page = await create(databaseId, properties);
  return { status: 'created', pageId: page.id, runId, date: packetDate(packet), bytes: payloadLength };
}

export function remotePacketSize(packet) {
  return JSON.stringify(packet).length;
}
