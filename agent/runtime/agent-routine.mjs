// Notion access for the scheduled analysis agent: rebuild the published rule
// input exactly as the collector wrote it, and save the agent's analysis in the
// shape the dashboard reads back.
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  appendBlockChildren,
  createDatabasePage,
  deleteBlock,
  flatten,
  queryDatabase,
  retrieveBlockChildren,
  updatePageProperties,
} from '../../shared/notion-storage/notion.mjs';
import { AGENT_INPUT_PART_MARKER, validateAgentInputDeltas } from '../../shared/notion-storage/notion-agent-handoff.mjs';
import { buildAgentAnalysis } from '../../shared/contracts/dashboard-agent-analysis-adapter.mjs';
import { decodeDashboardSnapshot } from '../../shared/notion-storage/dashboard-snapshot.mjs';
import { comparableSnapshot } from '../../shared/snapshot/operational-metadata.mjs';

const INPUT_MARKER = 'MOLIP_AGENT_INPUT_V1';
const LEGACY_INPUT_LIMIT = 50_000;
const MAX_RICH_TEXT_CHUNK = 1900;
const MAX_RICH_TEXT_ITEMS = 100;
export const ANALYSIS_MARKER = 'MOLIP_AGENT_ANALYSIS_V1';

export class AgentInputError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code; // not_available | not_ready | invalid
  }
}

const invalid = message => new AgentInputError('invalid', message);
const plain = items => (items || []).map(item => item.plain_text ?? item.text?.content ?? '').join('');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function kstDate(now = new Date()) {
  return new Date(new Date(now).getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}

export function morningRunId(now = new Date()) {
  return `${kstDate(now)}-morning`;
}

export function defaultNotionDeps() {
  return {
    query: queryDatabase,
    listChildren: retrieveBlockChildren,
    create: createDatabasePage,
    update: updatePageProperties,
    append: appendBlockChildren,
    remove: deleteBlock,
  };
}

function pageText(page, name) {
  const property = page.properties?.[name];
  return plain(property?.rich_text || property?.title);
}

function markedJson(blocks, marker, label) {
  const matches = blocks.filter(block => block?.type === 'code' && plain(block.code?.caption) === marker);
  if (matches.length !== 1) throw invalid(`${label}: ${marker} 코드 블록이 ${matches.length}개입니다.`);
  try {
    return JSON.parse(plain(matches[0].code.rich_text));
  } catch (error) {
    throw invalid(`${label}: 본문 JSON 파싱 실패 (${error.message})`);
  }
}

async function readMarkedPage({ databaseId, runId, marker, deps }) {
  const rows = await deps.query(databaseId, { property: 'run_id', rich_text: { equals: runId } });
  if (!rows.length) return null;
  if (rows.length > 1) throw invalid(`run_id 중복 페이지 ${rows.length}건: ${runId}`);
  const page = rows[0];
  const body = markedJson(await deps.listChildren(page.id), marker, runId);
  let pointer;
  try {
    pointer = JSON.parse(pageText(page, 'payload'));
  } catch {
    throw invalid(`${runId}: payload 속성 JSON을 읽을 수 없습니다.`);
  }
  return { page, body, pointer };
}

function checkPointer(pointer, expected, label) {
  for (const [key, value] of Object.entries(expected)) {
    if (value === undefined) continue;
    if (pointer?.[key] !== value) {
      throw invalid(`${label}: payload 속성 ${key}(${pointer?.[key]})가 본문(${value})과 다릅니다.`);
    }
  }
}

function specIds(project) {
  const index = (project.specCatalogFormat?.columns || []).indexOf('specId');
  const rows = project.specCatalog || [];
  if (rows.length && index < 0) throw invalid(`${project.name}: specCatalogFormat에 specId가 없습니다.`);
  return rows.map(row => row[index]);
}

function validateLogicalInput(input) {
  for (const field of ['runId', 'outputSchema', 'projects']) {
    if (input[field] === undefined) throw invalid(`입력 필수 필드 누락: ${field}`);
  }
  if (!input.rules?.metrics) throw invalid('입력 필수 필드 누락: rules.metrics');
  if (!('sourceHealth' in input)) throw invalid('입력 필수 필드 누락: sourceHealth');
  if (!Array.isArray(input.projects)) throw invalid('projects가 배열이 아닙니다.');
  for (const project of input.projects) {
    for (const field of ['ruleAuditFormat', 'ruleAuditItems', 'analysisTargets', 'specCatalogFormat', 'specCatalog']) {
      if (project[field] === undefined) throw invalid(`${project.name}: 필수 필드 누락 ${field}`);
    }
    const ids = specIds(project);
    if (ids.some(id => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) {
      throw invalid(`${project.name}: specCatalog specId 누락 또는 중복`);
    }
  }
  validateAgentInputDeltas(input);
}

function rebuildProject(descriptor, parts) {
  const label = descriptor.name || descriptor.projectId;
  const own = parts.filter(part => part.body.projects[0].projectId === descriptor.projectId);
  const ownIds = own.map(part => part.body.partId).sort();
  if (!isDeepStrictEqual(ownIds, [...(descriptor.partIds || [])].sort())) {
    throw invalid(`${label}: 조각 목록이 manifest partIds와 다릅니다.`);
  }
  const entries = own.map(part => part.body.projects[0]);
  const metas = entries.filter(entry => entry.projectMeta);
  if (metas.length !== 1) throw invalid(`${label}: projectMeta가 ${metas.length}번 있습니다.`);
  const project = { ...metas[0].projectMeta };
  const byField = new Map();
  for (const section of entries.flatMap(entry => entry.sections || [])) {
    if (!byField.has(section.field)) byField.set(section.field, []);
    byField.get(section.field).push(section);
  }
  const counts = descriptor.sectionCounts || {};
  for (const field of byField.keys()) {
    if (!(field in counts)) throw invalid(`${label}: 선언되지 않은 섹션 ${field}`);
  }
  for (const [field, total] of Object.entries(counts)) {
    if (field in project) throw invalid(`${label}: ${field}가 projectMeta와 섹션에 모두 있습니다.`);
    const sections = (byField.get(field) || []).sort((left, right) => left.offset - right.offset);
    const items = [];
    for (const section of sections) {
      if (section.offset !== items.length || section.totalItems !== total || !Array.isArray(section.items)) {
        throw invalid(`${label}: ${field} 섹션 offset·totalItems 불일치`);
      }
      items.push(...section.items);
    }
    if (items.length !== total) throw invalid(`${label}: ${field} ${items.length}/${total}행만 복원됨`);
    project[field] = items;
  }
  const ids = specIds(project);
  if (!isDeepStrictEqual([...ids].sort(), [...(descriptor.activeSpecIds || [])].sort())) {
    throw invalid(`${label}: activeSpecIds와 specCatalog가 1:1이 아닙니다.`);
  }
  return project;
}

// Returns { input, provenance }. Throws AgentInputError for missing, unfinished
// or inconsistent input; callers must stop without saving in every such case.
export async function readAgentInput({ databaseId, runId, deps = defaultNotionDeps() }) {
  const root = await readMarkedPage({ databaseId, runId: `rule-input:${runId}`, marker: INPUT_MARKER, deps });
  if (!root) throw new AgentInputError('not_available', `규칙 입력 페이지 없음: rule-input:${runId}`);
  const manifest = root.body;
  if (manifest.runId !== runId) throw invalid(`입력 runId(${manifest.runId})가 ${runId}와 다릅니다.`);
  checkPointer(root.pointer, {
    marker: INPUT_MARKER, runId,
    generationId: manifest.packet?.generationId, status: manifest.packet?.status,
  }, 'rule-input');

  if (!manifest.packet?.format) {
    if (JSON.stringify(manifest).length > LEGACY_INPUT_LIMIT) throw invalid('단일 입력이 50,000자를 넘어 잘림 위험이 있습니다.');
    validateLogicalInput(manifest);
    return { input: manifest, provenance: { format: 'single', rootPageId: root.page.id, rootHash: hash(manifest), parts: [] } };
  }

  const { packet, projects: descriptors, ...rootFields } = manifest;
  if (packet.format !== 'manifest-v1') throw invalid(`알 수 없는 입력 형식: ${packet.format}`);
  if (packet.status === 'publishing') throw new AgentInputError('not_ready', '규칙 입력 게시 중(publishing)입니다.');
  if (packet.status !== 'ready') throw invalid(`입력 상태가 ready가 아닙니다: ${packet.status}`);
  const declared = packet.parts || [];
  if (declared.length !== packet.partCount) throw invalid('parts 수가 partCount와 다릅니다.');
  if (new Set(declared.map(part => part.partId)).size !== declared.length) throw invalid('partId 중복');
  const indexes = declared.map(part => part.partIndex).sort((left, right) => left - right);
  if (!indexes.every((value, index) => value === index + 1)) throw invalid('partIndex가 1부터 연속되지 않습니다.');

  const parts = [];
  for (const part of declared) {
    const read = await readMarkedPage({ databaseId, runId: part.runId, marker: AGENT_INPUT_PART_MARKER, deps });
    if (!read) throw invalid(`조각 페이지 없음: ${part.partId}`);
    if (part.pageId && read.page.id.replace(/-/g, '') !== part.pageId.replace(/-/g, '')) {
      throw invalid(`조각 ${part.partId}의 pageId가 manifest와 다릅니다.`);
    }
    const body = read.body;
    const expected = {
      format: 'project-part-v1', runId, generatedAt: manifest.generatedAt, generationId: packet.generationId,
      partId: part.partId, partIndex: part.partIndex, partCount: packet.partCount,
    };
    for (const [key, value] of Object.entries(expected)) {
      if (body[key] !== value) throw invalid(`조각 ${part.partId}: ${key}(${body[key]}) 불일치`);
    }
    if (body.projects?.length !== 1 || body.projects[0].projectId !== part.projectId) {
      throw invalid(`조각 ${part.partId}: 프로젝트 식별 불일치`);
    }
    checkPointer(read.pointer, {
      marker: AGENT_INPUT_PART_MARKER, runId, generationId: packet.generationId, partId: part.partId,
    }, `조각 ${part.partId}`);
    parts.push({ ...read, body });
  }

  const input = { ...rootFields, projects: descriptors.map(descriptor => rebuildProject(descriptor, parts)) };
  validateLogicalInput(input);
  return {
    input,
    provenance: {
      format: 'manifest-v1',
      rootPageId: root.page.id,
      rootHash: hash(manifest),
      generationId: packet.generationId,
      parts: parts.map(part => ({ partId: part.body.partId, pageId: part.page.id, hash: hash(part.body) })),
    },
  };
}

// Re-reads the input right before saving so an analysis is never stored
// against a generation that was replaced while the agent was working.
export async function assertInputUnchanged({ databaseId, runId, provenance, deps = defaultNotionDeps() }) {
  const current = await readAgentInput({ databaseId, runId, deps });
  if (!isDeepStrictEqual(current.provenance, provenance)) {
    throw invalid('분석 중 규칙 입력이 바뀌었습니다. 처음 입력으로 만든 결과를 저장하지 않습니다.');
  }
}

// Minimal JSON Schema validator for the keywords agent-analysis.schema.json uses.
export function schemaErrors(schema, value, root = schema, at = '$') {
  if (schema.$ref) {
    const target = schema.$ref.replace(/^#\//, '').split('/').reduce((node, key) => node?.[key], root);
    if (!target) return [`${at}: 알 수 없는 $ref ${schema.$ref}`];
    return schemaErrors(target, value, root, at);
  }
  const errors = [];
  const kind = value === null ? 'null' : Array.isArray(value) ? 'array' : Number.isInteger(value) ? 'integer' : typeof value;
  if (schema.type) {
    const allowed = [].concat(schema.type);
    const ok = allowed.includes(kind) || (kind === 'integer' && allowed.includes('number'));
    if (!ok) return [`${at}: ${allowed.join('|')} 필요, ${kind}`];
  }
  if ('const' in schema && !isDeepStrictEqual(value, schema.const)) errors.push(`${at}: ${JSON.stringify(schema.const)}여야 합니다.`);
  if (schema.enum && !schema.enum.some(option => isDeepStrictEqual(option, value))) errors.push(`${at}: 허용값 ${JSON.stringify(schema.enum)} 밖`);
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${at}: 최소 ${schema.minLength}자`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${at}: 최대 ${schema.maxLength}자 초과(${value.length})`);
    if (schema.format === 'date-time' && !Number.isFinite(Date.parse(value))) errors.push(`${at}: 날짜시각 형식 아님`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${at}: 최소 ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${at}: 최대 ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${at}: 최소 ${schema.minItems}개`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${at}: 최대 ${schema.maxItems}개 초과(${value.length})`);
    if (schema.items) value.forEach((item, index) => errors.push(...schemaErrors(schema.items, item, root, `${at}[${index}]`)));
  }
  if (kind === 'object') {
    for (const key of schema.required || []) if (!(key in value)) errors.push(`${at}.${key}: 필수 필드 누락`);
    for (const [key, item] of Object.entries(value)) {
      if (schema.properties?.[key]) errors.push(...schemaErrors(schema.properties[key], item, root, `${at}.${key}`));
      else if (schema.additionalProperties === false) errors.push(`${at}.${key}: 스키마에 없는 필드`);
    }
  }
  return errors;
}

const normName = value => String(value || '').replace(/\s+/g, '').toLowerCase();

// Bullet items are required only when the day's published outputSchema defines
// them, so an input published before the schema change never deadlocks the save.
function schemaDefinesBullets(schema) {
  return {
    project: Boolean(schema?.properties?.projects?.items?.properties?.projectBriefing?.properties?.currentProgressItems),
    sprint: Boolean(schema?.properties?.projects?.items?.properties?.projectBriefing?.properties?.briefingSprint),
    overall: Boolean(schema?.properties?.overall?.properties?.summaryItems),
  };
}

export function analysisErrors({ analysis, input, runId }) {
  const errors = schemaErrors(input.outputSchema, analysis);
  const bullets = schemaDefinesBullets(input.outputSchema);
  if (analysis.runId !== runId) errors.push(`runId는 접두사 없이 ${runId}여야 합니다.`);
  if (!['success', 'partial'].includes(analysis.analysisStatus)) errors.push('failed 결과는 저장하지 않습니다.');
  if (!(Date.parse(analysis.generatedAt) >= Date.parse(input.generatedAt))) errors.push('generatedAt이 입력 generatedAt보다 이릅니다.');
  const expected = input.projects.map(project => normName(project.name)).sort();
  const actual = (analysis.projects || []).map(project => normName(project.name)).sort();
  if (!isDeepStrictEqual(expected, actual)) errors.push(`프로젝트 목록 불일치: 입력 ${expected.join(',')} / 결과 ${actual.join(',')}`);
  for (const project of input.projects) {
    const result = (analysis.projects || []).find(item => normName(item.name) === normName(project.name));
    if (!result) continue;
    if (!result.projectBriefing) errors.push(`${project.name}: projectBriefing 누락`);
    else if (bullets.project && !result.projectBriefing.currentProgressItems?.length) errors.push(`${project.name}: 개조식 currentProgressItems 누락`);
    if (bullets.sprint && result.projectBriefing) errors.push(...briefingSprintErrors(project.name, result.projectBriefing.briefingSprint, input.rules?.briefingScope));
    const wanted = specIds(project).sort();
    const written = (result.specSummaries || []).map(item => item.specId).sort();
    if (!isDeepStrictEqual(wanted, written)) errors.push(`${project.name}: specSummaries가 활성 스펙과 1:1이 아닙니다.`);
  }
  if (bullets.overall && !analysis.overall?.summaryItems?.length) errors.push('개조식 overall.summaryItems 누락');
  return errors;
}

const sameSet = (left, right) => JSON.stringify([...new Set(left)].sort()) === JSON.stringify([...new Set(right)].sort());

// Conditional rules the JSON schema cannot express: what a judged / undetermined
// sprint must contain, and that the saved-scope copy and the "differs" flag are honest.
function briefingSprintErrors(name, sprint, scope) {
  if (!sprint) return [`${name}: briefingSprint 누락`];
  const errors = [];
  if (sprint.status === 'judged') {
    if (!sprint.sprints?.length) errors.push(`${name}: briefingSprint judged인데 sprints가 비어 있습니다.`);
    if (!sprint.evidence?.length) errors.push(`${name}: briefingSprint judged인데 evidence가 없습니다.`);
  } else if (sprint.status === 'undetermined' && sprint.sprints?.length) {
    errors.push(`${name}: briefingSprint undetermined인데 sprints가 비어 있지 않습니다.`);
  }
  if (scope && sprint.savedScope && (sprint.savedScope.mode !== scope.mode || !sameSet(sprint.savedScope.sprints || [], scope.sprints || []))) {
    errors.push(`${name}: briefingSprint.savedScope가 입력 rules.briefingScope와 다릅니다.`);
  }
  if (sprint.savedScope) {
    const differs = sprint.savedScope.mode !== 'unset' && !sameSet(sprint.sprints || [], sprint.savedScope.sprints || []);
    if (Boolean(sprint.differsFromSaved) !== differs) errors.push(`${name}: briefingSprint.differsFromSaved가 ${differs}여야 합니다.`);
  }
  return errors;
}

const ACTIVE_SPEC_STATUSES = new Set(['진행 중', '진행 예정', '확인 요청']);
const compact = value => String(value || '').replace(/\([^)]*\)|\[[^\]]*\]/g, '').replace(/[\s·,./\-_:()[\]]+/g, '').toLowerCase();

// Non-blocking: active specs whose name never appears in the bullet items, so the
// agent can see what it collapsed into a vague phrase before saving.
export function analysisWarnings({ analysis, input }) {
  const warnings = [];
  for (const project of input.projects) {
    const result = (analysis.projects || []).find(item => normName(item.name) === normName(project.name));
    const brief = result?.projectBriefing || {};
    const itemised = [...(brief.currentProgressItems || []), ...(brief.buildReleaseItems || [])];
    const bullets = compact((itemised.length ? itemised : [brief.currentProgress, brief.buildRelease]).join(' '));
    const columns = project.specCatalogFormat?.columns || [];
    const [titleAt, sprintAt, statusAt] = ['title', 'sprint', 'status'].map(name => columns.indexOf(name));
    if (titleAt < 0 || statusAt < 0) continue;
    const missing = (project.specCatalog || [])
      .filter(row => ACTIVE_SPEC_STATUSES.has(row[statusAt]))
      .filter(row => compact(row[titleAt]).length >= 2 && !bullets.includes(compact(row[titleAt])))
      .map(row => `${String(row[titleAt]).trim()}${sprintAt >= 0 && row[sprintAt] ? ` (${row[sprintAt]}, ${row[statusAt]})` : ` (${row[statusAt]})`}`);
    if (missing.length) warnings.push(`${project.name}: 개조식 항목에 이름이 없는 진행 중·진행 예정·확인 요청 스펙 ${missing.length}건 — ${missing.join(' / ')}`);
  }
  return warnings;
}

function textObjects(value) {
  const text = String(value || '');
  const parts = [];
  for (let index = 0; index < text.length && parts.length < MAX_RICH_TEXT_ITEMS; index += MAX_RICH_TEXT_CHUNK) {
    parts.push({ type: 'text', text: { content: text.slice(index, index + MAX_RICH_TEXT_CHUNK) } });
  }
  return parts;
}

const clip = (value, max = MAX_RICH_TEXT_CHUNK) => String(value || '').slice(0, max);

function jsonBlock(value) {
  const text = JSON.stringify(value);
  if (text.length > MAX_RICH_TEXT_CHUNK * MAX_RICH_TEXT_ITEMS) throw new Error(`분석 JSON이 Notion 코드 블록 한도를 초과했습니다: ${text.length}자`);
  return { object: 'block', type: 'code', code: { language: 'json', rich_text: textObjects(text), caption: textObjects(ANALYSIS_MARKER) } };
}

function analysisProperties({ title, projectName, date, runId, status, summary, reason, extra = {} }) {
  return {
    이름: { title: textObjects(clip(title)) },
    프로젝트명: { rich_text: textObjects(projectName) },
    기준일: { date: { start: date } },
    run_id: { rich_text: textObjects(runId) },
    상태: { select: { name: status } },
    '생성 방식': { select: { name: 'agent' } },
    '스키마 버전': { select: { name: 'v1' } },
    '현재 진행 요약': { rich_text: textObjects(clip(summary)) },
    '전체 요약': { rich_text: textObjects(clip(summary)) },
    '상태 판단 사유': { rich_text: textObjects(clip(reason)) },
    ...extra,
  };
}

async function findAnalysisPage({ databaseId, runId, title, deps }) {
  const byRunId = await deps.query(databaseId, { property: 'run_id', rich_text: { equals: runId } });
  if (byRunId.length > 1) throw new Error(`분석 페이지 run_id 중복: ${runId}`);
  if (byRunId[0]) return byRunId[0];
  const byTitle = (await deps.query(databaseId, { property: '이름', title: { equals: title } }))
    .filter(page => !/^(rule-input|dashboard-snapshot|sprint-settings)/.test(pageText(page, 'run_id')));
  if (byTitle.length > 1) throw new Error(`같은 제목의 분석 페이지가 여러 개입니다: ${title}`);
  return byTitle[0] || null;
}

async function readAnalysisJson(pageId, deps) {
  const codes = (await deps.listChildren(pageId)).filter(block => block?.type === 'code');
  if (codes.length !== 1) throw new Error(`분석 페이지 코드 블록이 ${codes.length}개입니다.`);
  return JSON.parse(plain(codes[0].code.rich_text));
}

async function upsertAnalysisPage({ databaseId, runId, title, properties, value, deps }) {
  const block = jsonBlock(value);
  const existing = await findAnalysisPage({ databaseId, runId, title, deps });
  let pageId;
  if (!existing) {
    pageId = (await deps.create(databaseId, properties, [block])).id;
  } else {
    pageId = existing.id;
    const oldCodes = (await deps.listChildren(pageId)).filter(item => item?.type === 'code');
    await deps.append(pageId, [block]);
    for (const old of oldCodes) await deps.remove(old.id);
    await deps.update(pageId, properties);
  }
  const written = await readAnalysisJson(pageId, deps);
  if (!isDeepStrictEqual(written, value)) throw new Error(`저장 후 다시 읽은 JSON이 다릅니다: ${title}`);
  return { pageId, status: existing ? 'updated' : 'created' };
}

function projectRunKey(project) {
  return String(project.id || project.projectId || project.name).trim();
}

// Validates, re-checks the input generation, writes `전체 / 날짜` plus one page per
// project, then reads them back through the dashboard's own parser.
export async function saveAnalysis({
  databaseId, runId, analysis, input, provenance, deps = defaultNotionDeps(), now = new Date(),
}) {
  const errors = analysisErrors({ analysis, input, runId });
  if (errors.length) throw new Error(`분석 결과 검증 실패:\n- ${errors.join('\n- ')}`);
  await assertInputUnchanged({ databaseId, runId, provenance, deps });

  const date = runId.slice(0, 10);
  const overallRunId = `analysis:${runId}:overall`;
  const overallTitle = `전체 / ${date}`;
  const existing = await findAnalysisPage({ databaseId, runId: overallRunId, title: overallTitle, deps });
  if (existing) {
    const previous = await readAnalysisJson(existing.id, deps).catch(() => null);
    if (previous && Date.parse(previous.generatedAt) > Date.parse(analysis.generatedAt)) {
      throw new Error('더 최근에 생성된 같은 날짜 분석이 이미 있어 덮어쓰지 않습니다.');
    }
  }

  const reason = (analysis.overall?.confidenceLimits || []).join(' / ');
  const pages = [];
  pages.push({ name: '전체', ...(await upsertAnalysisPage({
    databaseId, runId: overallRunId, title: overallTitle, value: analysis, deps,
    properties: analysisProperties({
      title: overallTitle, projectName: '전체', date, runId: overallRunId,
      status: analysis.analysisStatus, summary: analysis.overall?.summary, reason,
      extra: { '프로젝트 수': { number: analysis.projects.length }, '요약 대상 수': { number: analysis.projects.length } },
    }),
  })) });
  for (const project of input.projects) {
    const result = analysis.projects.find(item => normName(item.name) === normName(project.name));
    const title = `${project.name} / ${date}`;
    const projectRunId = `analysis:${runId}:${projectRunKey(project)}`;
    pages.push({ name: project.name, ...(await upsertAnalysisPage({
      databaseId, runId: projectRunId, title, value: result, deps,
      properties: analysisProperties({
        title, projectName: project.name, date, runId: projectRunId,
        status: analysis.analysisStatus, summary: result.summary,
        reason: (result.confidenceLimits || []).join(' / '),
      }),
    })) });
  }

  const [overallPage] = await deps.query(databaseId, { property: 'run_id', rich_text: { equals: overallRunId } });
  const row = { ...flatten(overallPage), '분석 결과 JSON': JSON.stringify(await readAnalysisJson(overallPage.id, deps)) };
  const parsed = buildAgentAnalysis([row], input.projects.map(project => project.name), new Date(now).toISOString());
  if (parsed.runId !== runId || !['success', 'partial'].includes(parsed.analysisStatus)) {
    throw new Error(`대시보드 파서로 다시 읽은 결과가 오늘 분석으로 인식되지 않습니다 (runId=${parsed.runId}, status=${parsed.analysisStatus}).`);
  }
  return { runId, analysisStatus: analysis.analysisStatus, pages };
}

// The cloud checkout has no local snapshot history, so the routine's collection
// compares against the latest Notion snapshot from an earlier Seoul date. A
// same-day snapshot (an earlier refresh) is skipped rather than ending the search.
export async function readPreviousDashboardSnapshot({ databaseId, today = kstDate(), query = queryDatabase }) {
  const pages = await query(
    databaseId,
    { property: 'run_id', rich_text: { starts_with: 'dashboard-snapshot:' } },
    [{ property: '기준일', direction: 'descending' }],
  );
  const cutoff = `dashboard-snapshot:${today}`;
  const row = pages.map(flatten).find(item => String(item.run_id || '') < cutoff && item.payload);
  return row ? comparableSnapshot(decodeDashboardSnapshot(row.payload)) : null;
}

// Tells the routine, before a long collection, which external hosts it cannot reach
// or has no credentials for. The cloud environment blocks hosts that are not on its
// network allowlist, and the fix is an environment setting only a person can make.
export async function preflightSources({ env = process.env, fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  const probe = async (name, url, tokenName, headers = {}) => {
    const result = { source: name, token: tokenName ? Boolean(env[tokenName]) : null, reachable: false, detail: null };
    try {
      const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
      const body = await response.text().catch(() => '');
      result.reachable = !/host not in allowlist/i.test(body);
      if (!result.reachable) result.detail = '네트워크 허용 목록에 없는 호스트';
      else if (response.status === 401 && tokenName && !env[tokenName]) result.detail = '토큰 없음';
    } catch (error) {
      result.detail = error.name === 'TimeoutError' ? '응답 시간 초과' : error.message;
    }
    result.ok = result.reachable && (result.token !== false);
    return result;
  };
  return Promise.all([
    probe('notion', 'https://api.notion.com/v1/users/me', 'NOTION_TOKEN', { Authorization: `Bearer ${env.NOTION_TOKEN || ''}`, 'Notion-Version': '2022-06-28' }),
    probe('slack', 'https://slack.com/api/auth.test', 'SLACK_TOKEN', { Authorization: `Bearer ${env.SLACK_TOKEN || ''}` }),
    probe('github', 'https://api.github.com/rate_limit', 'GITHUB_TOKEN', env.GITHUB_TOKEN ? { Authorization: `Bearer ${env.GITHUB_TOKEN}` } : {}),
  ]);
}
