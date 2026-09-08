import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  applyGlobalSprintScope,
  legacyGlobalSprintScope,
  parseSprintInput,
  resolveSprintScope,
  scopeSignature,
  buildSprintOverview,
} from '../public/sprint-policy.js';

export const SETTINGS_PREFIX = 'sprint-settings:';
const KIND = 'MOLIP_GLOBAL_SPRINT_SETTINGS_V2';
const LEGACY_KIND = 'MOLIP_SPRINT_SETTINGS_V1';
const text = value => [{ type: 'text', text: { content: String(value) } }];
const plain = value => (value?.rich_text || value?.title || []).map(item => item.plain_text || item.text?.content || '').join('');
const error = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const hash = value => createHash('sha256').update(value).digest('hex');

export function settingsWriteAuthorized(request, token = process.env.SPRINT_SETTINGS_TOKEN) {
  const supplied = String(request.headers?.authorization || '');
  if (!token || token.length < 24 || !supplied.startsWith('Bearer ')) return false;
  return timingSafeEqual(Buffer.from(hash(supplied.slice(7))), Buffer.from(hash(token)));
}
export function settingsOriginAllowed(request) {
  const origin = request.headers?.origin;
  if (!origin) return true;
  try { return new URL(origin).host === String(request.headers.host || ''); } catch { return false; }
}

export async function readSprintSettings({ databaseId, query } = {}) {
  query ||= (await import('./notion.mjs')).queryDatabase;
  const pages = await query(databaseId, { property: 'run_id', rich_text: { starts_with: SETTINGS_PREFIX } });
  const records = [];
  const legacyRecords = [];
  for (const page of pages) {
    try {
      const record = JSON.parse(plain(page.properties?.payload));
      if (record.kind === KIND) {
        if (!['selected', 'all', 'unset'].includes(record.mode) || typeof record.input !== 'string' || !Array.isArray(record.sprints)
          || typeof record.revision !== 'string' || !Number.isFinite(Date.parse(record.changedAt))) throw Error('invalid');
        records.push(record);
      } else if (record.kind === LEGACY_KIND) {
        legacyRecords.push(record);
      }
    } catch {
      throw error('스프린트 설정 기록을 읽을 수 없습니다. 이전 값으로 임의 대체하지 않습니다.', 503);
    }
  }
  records.sort((a, b) => b.changedAt.localeCompare(a.changedAt) || b.revision.localeCompare(a.revision));
  const setting = records[0] || null;
  const revision = setting?.revision || hash('no-global-sprint-setting');
  return { revision, setting, history: records.slice(0, 30), legacyRecordCount: legacyRecords.length };
}

export function applySavedSprintSettings(projects, settings, { workItems = [] } = {}) {
  const dashboard = { projects, workItems };
  const scope = settings?.setting
    ? resolveSprintScope(dashboard, settings.setting)
    : legacyGlobalSprintScope(projects);
  if (scope.mode === 'all') {
    const resolved = resolveSprintScope(dashboard, settings.setting);
    return { projects: applyGlobalSprintScope(projects, resolved), scope: resolved };
  }
  return { projects: applyGlobalSprintScope(projects, scope), scope };
}

export function decorateSprintDashboard(dashboard, settings, { writable = false } = {}) {
  const applied = applySavedSprintSettings(dashboard.projects || [], settings, { workItems: dashboard.workItems || [] });
  const selectedSignature = scopeSignature(applied.scope);
  const collectedSignature = dashboard.sprintScope?.signature || scopeSignature(legacyGlobalSprintScope(dashboard.projects || []));
  const pendingInput = selectedSignature !== collectedSignature;
  const inputAt = Date.parse(dashboard.agentHandoff?.generatedAt || dashboard.generatedAt || '');
  const analysisAt = Date.parse(dashboard.ai?.generatedAt || '');
  const pendingAnalysis = pendingInput || (Number.isFinite(inputAt) && Number.isFinite(analysisAt) && analysisAt < inputAt);
  const output = {
    ...dashboard,
    projects: applied.projects,
    sprintSettings: {
      writable,
      revision: settings.revision,
      setting: settings.setting,
      history: settings.history,
      legacyRecordCount: settings.legacyRecordCount || 0,
      scope: applied.scope,
      pendingInput,
      pendingAnalysis,
    },
  };
  if (pendingAnalysis) {
    output.ai = { ...(dashboard.ai || {}), analysisStatus: !dashboard.ai || dashboard.ai.analysisStatus === 'not_run' ? 'not_run' : 'stale' };
    output.sourceHealth = { ...dashboard.sourceHealth, status: 'limited', sources: (dashboard.sourceHealth?.sources || []).map(source =>
      source.id === 'agent-analysis' ? { ...source, status: 'partial', analysisStatus: 'stale', successful: 0 } : source) };
  }
  output.workOverview = buildSprintOverview(output, applied.scope);
  return output;
}

export async function saveSprintSettings({ databaseId, dashboard, input, expectedRevision, query, create, now = new Date().toISOString(), uuid = randomUUID } = {}) {
  if (expectedRevision !== null && typeof expectedRevision !== 'string') throw error('설정 버전이 필요합니다.');
  const parsed = parseSprintInput(input);
  const before = await readSprintSettings({ databaseId, query });
  if (before.revision !== expectedRevision) throw error('다른 사용자가 설정을 변경했습니다. 최신 설정을 다시 불러오세요.', 409);

  const priorScope = before.setting
    ? resolveSprintScope(dashboard || {}, before.setting)
    : legacyGlobalSprintScope(dashboard?.projects || []);
  const nextComparable = { mode: parsed.mode, input: parsed.input, sprints: parsed.sprints };
  const priorComparable = { mode: priorScope.mode, input: priorScope.input, sprints: priorScope.mode === 'all' ? [] : priorScope.sprints };
  if (JSON.stringify(priorComparable) === JSON.stringify(nextComparable) && before.setting) return { settings: before, changed: false };

  const record = {
    kind: KIND,
    mode: parsed.mode,
    input: parsed.input,
    sprints: parsed.sprints,
    revision: uuid(),
    parentRevision: before.setting?.revision || null,
    previousInput: priorScope.input || '',
    changedAt: now,
  };
  create ||= (await import('./notion.mjs')).createDatabasePage;
  const serialized = JSON.stringify(record);
  const chunks = [];
  for (let i = 0; i < serialized.length; i += 1900) chunks.push(...text(serialized.slice(i, i + 1900)));
  await create(databaseId, {
    '이름': { title: text(`스프린트 설정 / 전체 프로젝트 / ${now}`) },
    '프로젝트명': { rich_text: text('대시보드 운영 설정') },
    '기준일': { date: { start: now } },
    run_id: { rich_text: text(`${SETTINGS_PREFIX}global:${record.revision}`) },
    payload: { rich_text: chunks },
  });
  const after = await readSprintSettings({ databaseId, query });
  if (after.setting?.revision !== record.revision) throw error('설정 저장 중 다른 변경이 감지됐습니다. 최신 설정과 변경 이력을 확인하세요.', 409);
  return { settings: after, changed: true };
}

export async function readSettingsBody(request, maxBytes = 16000) {
  if (request.body && typeof request.body === 'object') {
    if (Buffer.byteLength(JSON.stringify(request.body)) > maxBytes) throw error('요청이 너무 큽니다.', 413);
    return request.body;
  }
  let body = typeof request.body === 'string' ? request.body : '';
  if (!body) for await (const chunk of request) {
    body += chunk.toString();
    if (Buffer.byteLength(body) > maxBytes) throw error('요청이 너무 큽니다.', 413);
  }
  if (Buffer.byteLength(body) > maxBytes) throw error('요청이 너무 큽니다.', 413);
  try { const data = JSON.parse(body); if (!data || Array.isArray(data) || typeof data !== 'object') throw Error(); return data; }
  catch { throw error('JSON 요청 형식이 올바르지 않습니다.'); }
}
