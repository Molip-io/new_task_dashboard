import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  appendBlockChildren,
  createDatabasePage,
  deleteBlock,
  queryDatabase,
  retrieveBlockChildren,
  updatePageProperties,
} from './notion.mjs';

const MAX_RICH_TEXT_CHUNK = 1900;
const MAX_RICH_TEXT_ITEMS = 100;
const MAX_PAYLOAD_LENGTH = MAX_RICH_TEXT_CHUNK * MAX_RICH_TEXT_ITEMS;
const REMOTE_READABLE_LIMIT = 50_000;
const MAX_PART_LENGTH = 30_000;
const MAX_SECTION_LENGTH = 10_000;
const BODY_MARKER = 'MOLIP_AGENT_INPUT_V1';
const PART_MARKER = 'MOLIP_AGENT_INPUT_PART_V1';

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

function propertiesFor({ packet, runId, pageTitle, projectName, marker, bytes, generationId, status, partId }) {
  return {
    이름: title(pageTitle),
    프로젝트명: richText(projectName),
    기준일: date(packetDate(packet)),
    run_id: richText(runId),
    '현재 진행 요약': richText(status === 'publishing'
      ? '에이전트 입력 묶음 게시 중 — ready 전에는 분석하지 않음'
      : '대시보드 규칙 엔진이 게시한 에이전트용 정량 사실 스냅샷'),
    payload: richText(JSON.stringify({
      storage: 'page_code_block',
      format: 'json',
      marker,
      runId: packet.runId,
      ...(generationId ? { generationId } : {}),
      ...(status ? { status } : {}),
      ...(partId ? { partId } : {}),
      bytes,
    })),
  };
}

function jsonBlock(value, marker) {
  return {
    object: 'block',
    type: 'code',
    code: {
      rich_text: textObjects(JSON.stringify(value)),
      language: 'json',
      caption: textObjects(marker, 1),
    },
  };
}

function blockCaption(block) {
  return (block?.code?.caption || []).map(item => item.plain_text || item.text?.content || '').join('');
}

function managedBlocks(blocks, marker) {
  return blocks.filter(block => block?.type === 'code' && blockCaption(block) === marker);
}

function blockJson(block) {
  return JSON.parse((block?.code?.rich_text || []).map(item => item.plain_text || item.text?.content || '').join(''));
}

async function replaceManagedBlock({ pageId, block, marker, listChildren, append, remove }) {
  const existing = await listChildren(pageId);
  const oldBlocks = managedBlocks(existing, marker);
  await append(pageId, [block]);
  for (const old of oldBlocks) await remove(old.id);
  const written = managedBlocks(await listChildren(pageId), marker);
  if (written.length !== 1 || JSON.stringify(blockJson(written[0])) !== JSON.stringify(blockJson(block))) {
    throw new Error(`Notion 입력 본문 저장 후 검증 실패 (${marker})`);
  }
}

async function upsertManagedPage({
  databaseId, packet, runId, pageTitle, projectName, marker, payload, status,
  generationId, partId, query, create, update, listChildren, append, remove,
}) {
  const body = jsonBlock(payload, marker);
  const serializedLength = JSON.stringify(payload).length;
  if (serializedLength > MAX_PAYLOAD_LENGTH) {
    throw new Error(`원격 규칙 입력이 Notion payload 한도(${MAX_PAYLOAD_LENGTH}자)를 초과했습니다: ${serializedLength}자`);
  }
  const properties = propertiesFor({
    packet, runId, pageTitle, projectName, marker, bytes: serializedLength, generationId, status, partId,
  });
  const rows = await query(databaseId, { property: 'run_id', rich_text: { equals: runId } });
  if (rows.length > 1) throw new Error(`Notion run_id 중복 페이지가 있습니다: ${runId} (${rows.length}건)`);
  if (!rows[0]) {
    const page = await create(databaseId, properties, [body]);
    const readback = managedBlocks(await listChildren(page.id), marker);
    if (readback.length !== 1 || JSON.stringify(blockJson(readback[0])) !== JSON.stringify(payload)) {
      throw new Error(`Notion 새 입력 페이지 저장 후 검증 실패: ${runId}`);
    }
    return { pageId: page.id, pageUrl: page.url || null, status: 'created', bytes: serializedLength };
  }

  const pageId = rows[0].id;
  await replaceManagedBlock({ pageId, block: body, marker, listChildren, append, remove });
  await update(pageId, properties);
  return { pageId, pageUrl: rows[0].url || null, status: 'updated', bytes: serializedLength };
}

export function validateAgentInputDeltas(packet) {
  const nested = Object.hasOwn(packet.rules || {}, 'deltas');
  const topLevel = Object.hasOwn(packet, 'deltas');
  if ((!nested && !topLevel)
    || (nested && !Array.isArray(packet.rules.deltas))
    || (topLevel && !Array.isArray(packet.deltas))) {
    throw new Error('규칙 입력 rules.deltas 또는 deltas에 변경 배열이 필요합니다.');
  }
  if (nested && topLevel && !isDeepStrictEqual(packet.deltas, packet.rules.deltas)) {
    throw new Error('규칙 입력 deltas와 rules.deltas가 일치하지 않습니다.');
  }
  return nested ? packet.rules.deltas : packet.deltas;
}

function projectIdentity(project, index) {
  const id = String(project.id || project.projectId || '').trim();
  if (!id) throw new Error(`조각 입력 프로젝트 ${index + 1}에 안정적인 id가 없습니다.`);
  return id;
}

function activeSpecIds(project) {
  const columns = project.specCatalogFormat?.columns || [];
  const idIndex = columns.indexOf('specId');
  if (idIndex < 0 && (project.specCatalog || []).length) {
    throw new Error(`프로젝트 ${project.name}의 specCatalogFormat에 specId가 없습니다.`);
  }
  const ids = (project.specCatalog || []).map(row => row[idIndex]).filter(value => typeof value === 'string' && value.length);
  if (ids.length !== (project.specCatalog || []).length || new Set(ids).size !== ids.length) {
    throw new Error(`프로젝트 ${project.name}의 specCatalog에 specId 누락 또는 중복이 있습니다.`);
  }
  return ids;
}

function sectionChunks(field, values) {
  const chunks = [];
  let items = [];
  let offset = 0;
  let currentOffset = 0;
  for (const item of values) {
    const candidate = [...items, item];
    const size = JSON.stringify({ field, offset: currentOffset, totalItems: values.length, items: candidate }).length;
    if (size > MAX_SECTION_LENGTH && items.length) {
      chunks.push({ field, offset: currentOffset, totalItems: values.length, items });
      offset += items.length;
      currentOffset = offset;
      items = [item];
    } else {
      items = candidate;
    }
    if (JSON.stringify({ field, offset: currentOffset, totalItems: values.length, items }).length > MAX_SECTION_LENGTH) {
      throw new Error(`규칙 입력 조각의 단일 항목이 너무 큽니다: ${field}`);
    }
  }
  if (items.length) chunks.push({ field, offset: currentOffset, totalItems: values.length, items });
  return chunks;
}

function buildProjectParts(project, projectIndex, runId, generationId) {
  const projectId = projectIdentity(project, projectIndex);
  const name = project.name || projectId;
  const arrayEntries = Object.entries(project).filter(([, value]) => Array.isArray(value) && value.length > 0);
  const sectionCounts = Object.fromEntries(arrayEntries.map(([field, values]) => [field, values.length]));
  const arrayFields = new Set(arrayEntries.map(([field]) => field));
  const projectMeta = Object.fromEntries(Object.entries(project).filter(([field]) => !arrayFields.has(field)));
  const activeSpecIdsForProject = activeSpecIds(project);
  const sections = arrayEntries.flatMap(([field, values]) => sectionChunks(field, values));
  const localParts = [];
  let current = { projectId, projectName: name, sections: [] };
  let hasMetadata = true;
  const withMetadata = () => ({ ...current, ...(hasMetadata ? { projectMeta } : {}) });
  const wrap = (candidate, localIndex) => ({
    format: 'project-part-v1', runId, generationId,
    partId: `p${projectIndex}-${localIndex}`,
    partIndex: localIndex + 1, partCount: 999,
    projects: [candidate],
  });
  if (JSON.stringify(wrap(withMetadata(), 0)).length > MAX_PART_LENGTH) {
    throw new Error(`프로젝트 메타데이터가 조각 한도를 초과했습니다: ${name}`);
  }
  for (const section of sections) {
    const candidate = { ...current, sections: [...current.sections, section] };
    if (JSON.stringify(wrap({ ...candidate, ...(hasMetadata ? { projectMeta } : {}) }, localParts.length)).length <= MAX_PART_LENGTH) {
      current = candidate;
      continue;
    }
    if (!current.sections.length && hasMetadata) {
      localParts.push({ ...current, projectMeta });
      current = { projectId, projectName: name, sections: [section] };
      hasMetadata = false;
      if (JSON.stringify(wrap(current, localParts.length)).length > MAX_PART_LENGTH) {
        throw new Error(`프로젝트 근거 행이 조각 한도를 초과했습니다: ${name}/${section.field}`);
      }
      continue;
    }
    localParts.push({ ...current, ...(hasMetadata ? { projectMeta } : {}) });
    current = { projectId, projectName: name, sections: [section] };
    hasMetadata = false;
    if (JSON.stringify(wrap(current, localParts.length)).length > MAX_PART_LENGTH) {
      throw new Error(`프로젝트 근거 행이 조각 한도를 초과했습니다: ${name}/${section.field}`);
    }
  }
  if (current.sections.length || !localParts.length) localParts.push({ ...current, ...(hasMetadata ? { projectMeta } : {}) });
  return {
    descriptor: {
      projectId, name, activeSpecIds: activeSpecIdsForProject,
      partIds: localParts.map((_, localIndex) => `p${projectIndex}-${localIndex}`),
      sectionCounts,
    },
    parts: localParts,
  };
}

function makeManifest(packet, generationId, status, partDescriptors, projectDescriptors) {
  const { projects: _projects, ...rootFields } = packet;
  return {
    ...rootFields,
    projects: projectDescriptors,
    packet: {
      format: 'manifest-v1', status, generationId,
      partCount: partDescriptors.length,
      parts: partDescriptors,
    },
  };
}

async function publishShardedAgentInput({ databaseId, packet, query, create, update, listChildren, append, remove }) {
  const generationId = createHash('sha256').update(JSON.stringify(packet)).digest('hex').slice(0, 20);
  const planned = (packet.projects || []).map((project, index) => buildProjectParts(project, index, packet.runId, generationId));
  const projectDescriptors = planned.map(item => item.descriptor);
  const partSpecs = planned.flatMap((item, projectIndex) => item.parts.map((payload, localIndex) => ({
    payload, projectId: item.descriptor.projectId, partId: `p${projectIndex}-${localIndex}`,
  }))).map(({ payload, projectId, partId }, index) => {
    const partRunId = `rule-input-part:${packet.runId}:${generationId}:${partId}`;
    return {
      payload: {
        format: 'project-part-v1', runId: packet.runId, generatedAt: packet.generatedAt, generationId, partId,
        partIndex: index + 1, partCount: planned.reduce((sum, project) => sum + project.parts.length, 0),
        projects: [{
          projectId: payload.projectId,
          name: payload.projectName,
          ...(payload.projectMeta ? { projectMeta: payload.projectMeta } : {}),
          sections: payload.sections,
        }],
      },
      partId,
      partIndex: index + 1,
      runId: partRunId,
      projectId,
    };
  });
  const partCount = partSpecs.length;
  const baseDescriptors = partSpecs.map(({ partId, partIndex, runId, projectId, payload }) => ({
    partId, partIndex, runId, projectId, chars: JSON.stringify(payload).length,
  }));
  const oversizedPart = baseDescriptors.find(part => part.chars > MAX_PART_LENGTH);
  if (oversizedPart) throw new Error(`규칙 입력 조각이 원격 조회 안전 한도를 초과했습니다: ${oversizedPart.partId} ${oversizedPart.chars}자`);
  const publishingManifest = makeManifest(packet, generationId, 'publishing', baseDescriptors, projectDescriptors);
  const readyManifestUpperBound = makeManifest(packet, generationId, 'ready', baseDescriptors.map(part => ({
    ...part,
    pageId: 'x'.repeat(36),
    pageUrl: `https://www.notion.so/${'x'.repeat(32)}`,
  })), projectDescriptors);
  const manifestUpperBoundChars = JSON.stringify(readyManifestUpperBound).length;
  if (manifestUpperBoundChars > REMOTE_READABLE_LIMIT) {
    throw new Error(`규칙 입력 manifest가 원격 조회 안전 한도(${REMOTE_READABLE_LIMIT}자)를 초과했습니다: ${manifestUpperBoundChars}자`);
  }
  const manifestRunId = inputRunId(packet);
  const rootWrite = options => upsertManagedPage({
    databaseId, packet, runId: manifestRunId,
    pageTitle: `규칙 입력 / ${packetDate(packet)}`,
    projectName: '규칙 입력', marker: BODY_MARKER,
    query, create, update, listChildren, append, remove, ...options,
  });
  const rootPublishing = await rootWrite({
    payload: publishingManifest, status: 'publishing', generationId,
  });

  const publishedParts = [];
  for (const spec of partSpecs) {
    const result = await upsertManagedPage({
      databaseId, packet, runId: spec.runId,
      pageTitle: `규칙 입력 조각 / ${packetDate(packet)} / ${String(spec.partIndex).padStart(2, '0')}`,
      projectName: `규칙 입력 조각 · ${planned.find(item => item.descriptor.projectId === spec.projectId)?.descriptor.name || spec.projectId}`,
      marker: PART_MARKER, payload: spec.payload,
      generationId, partId: spec.partId, status: 'ready',
      query, create, update, listChildren, append, remove,
    });
    if (!result.pageId || !result.pageUrl) throw new Error(`규칙 입력 조각의 페이지 ID·URL을 확인하지 못했습니다: ${spec.partId}`);
    publishedParts.push({ ...spec, ...result });
  }

  const readyDescriptors = publishedParts.map(({ partId, partIndex, runId, projectId, pageId, pageUrl, bytes }) => ({
    partId, partIndex, runId, projectId, pageId, pageUrl,
    chars: bytes,
  }));
  const readyManifest = makeManifest(packet, generationId, 'ready', readyDescriptors, projectDescriptors);
  const manifestChars = JSON.stringify(readyManifest).length;
  if (manifestChars > REMOTE_READABLE_LIMIT) {
    throw new Error(`규칙 입력 manifest가 원격 조회 안전 한도(${REMOTE_READABLE_LIMIT}자)를 초과했습니다: ${manifestChars}자`);
  }
  const rootFinal = await rootWrite({
    payload: readyManifest, status: 'ready', generationId,
  });
  return {
    status: rootPublishing.status === 'created' ? 'created' : 'updated',
    runId: manifestRunId, pageId: rootFinal.pageId, date: packetDate(packet),
    bytes: manifestChars, generationId, partCount,
    partPageIds: publishedParts.map(part => part.pageId),
  };
}

export async function publishAgentInputToNotion({
  databaseId,
  packet,
  query = queryDatabase,
  create = createDatabasePage,
  update = updatePageProperties,
  listChildren = retrieveBlockChildren,
  append = appendBlockChildren,
  remove = deleteBlock,
}) {
  validateAgentInputDeltas(packet);
  const payloadLength = remotePacketSize(packet);
  if (payloadLength > REMOTE_READABLE_LIMIT) {
    return publishShardedAgentInput({ databaseId, packet, query, create, update, listChildren, append, remove });
  }
  const runId = inputRunId(packet);
  const result = await upsertManagedPage({
    databaseId, packet, runId, pageTitle: `규칙 입력 / ${packetDate(packet)}`,
    projectName: '규칙 입력', marker: BODY_MARKER, payload: packet,
    query, create, update, listChildren, append, remove,
  });
  return { ...result, runId, date: packetDate(packet) };
}

export function remotePacketSize(packet) {
  return JSON.stringify(packet).length;
}

export const AGENT_INPUT_REMOTE_READABLE_LIMIT = REMOTE_READABLE_LIMIT;
export const AGENT_INPUT_PART_LIMIT = MAX_PART_LENGTH;
export const AGENT_INPUT_PART_MARKER = PART_MARKER;
