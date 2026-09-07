import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { projectKey, currentSprints, uniqueSprints, usesSprints, normalizeSprint, availableSprints, scopeSignature, buildSprintOverview } from '../public/sprint-policy.js';

export const SETTINGS_PREFIX = 'sprint-settings:';
const KIND = 'MOLIP_SPRINT_SETTINGS_V1';
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
  if (!origin) return true; // CLI clients still require the admin bearer token.
  try { return new URL(origin).host === String(request.headers.host || ''); } catch { return false; }
}
export async function readSprintSettings({ databaseId, query } = {}) {
  query ||= (await import('./notion.mjs')).queryDatabase;
  const pages = await query(databaseId, { property: 'run_id', rich_text: { starts_with: SETTINGS_PREFIX } });
  const records = pages.map(page => {
    try {
      const record = JSON.parse(plain(page.properties?.payload));
      if (record.kind !== KIND || typeof record.projectId !== 'string' || !Array.isArray(record.sprints) ||
          typeof record.revision !== 'string' || !Number.isFinite(Date.parse(record.changedAt))) throw Error('invalid');
      if (record.sprints.some(value => typeof value !== 'string')) throw Error('invalid');
      return record;
    } catch { throw error('스프린트 설정 기록을 읽을 수 없습니다. 이전 값으로 임의 대체하지 않습니다.', 503); }
  }).sort((a, b) => b.changedAt.localeCompare(a.changedAt) || b.revision.localeCompare(a.revision));
  const projects = Object.create(null);
  for (const record of records) if (!Object.hasOwn(projects, record.projectId)) projects[record.projectId] = record;
  const revision = hash(JSON.stringify(Object.entries(projects).map(([id, record]) => [id, record.revision]).sort()));
  return { revision, projects, history: records.slice(0, 30) };
}

export function applySavedSprintSettings(projects, settings) {
  return projects.map(project => {
    const record = settings.projects[projectKey(project)];
    const sprints = record ? uniqueSprints(record.sprints) : currentSprints(project);
    return { ...project, currentSprints: sprints,
      sprintSettingSource: record ? 'dashboard' : 'notion-legacy',
      sprintSettingRevision: record?.revision || null,
      config: { ...project.config, currentSprints: sprints, sprintRequired: usesSprints(project),
        notionId: project.notionId || project.config?.notionId } };
  });
}

export function decorateSprintDashboard(dashboard, settings, { writable = false } = {}) {
  const projects = applySavedSprintSettings(dashboard.projects || [], settings);
  const selectedSignature = scopeSignature(projects);
  const collectedSignature = dashboard.sprintScope?.signature || scopeSignature(dashboard.projects || []);
  const pendingInput = selectedSignature !== collectedSignature;
  const inputAt = Date.parse(dashboard.agentHandoff?.generatedAt || dashboard.generatedAt || '');
  const analysisAt = Date.parse(dashboard.ai?.generatedAt || '');
  const pendingAnalysis = pendingInput || (Number.isFinite(inputAt) && Number.isFinite(analysisAt) && analysisAt < inputAt);
  const output = { ...dashboard, projects, sprintSettings: {
    writable, revision: settings.revision, projects: settings.projects, history: settings.history, pendingInput, pendingAnalysis,
  } };
  if (pendingAnalysis) {
    output.ai = { ...(dashboard.ai || {}), analysisStatus: !dashboard.ai || dashboard.ai.analysisStatus === 'not_run' ? 'not_run' : 'stale' };
    output.sourceHealth = { ...dashboard.sourceHealth, status: 'limited', sources: (dashboard.sourceHealth?.sources || []).map(source =>
      source.id === 'agent-analysis' ? { ...source, status: 'partial', analysisStatus: 'stale', successful: 0 } : source) };
  }
  output.workOverview = buildSprintOverview(output);
  return output;
}

export async function saveSprintSettings({ databaseId, dashboard, projectId, sprints, expectedRevision, query, create, now = new Date().toISOString(), uuid = randomUUID } = {}) {
  const project = (dashboard?.projects || []).find(item => projectKey(item) === projectId);
  if (project && !project.notionId && !project.config?.notionId) throw error('최초 설정 전에 데이터를 다시 수집해 프로젝트 ID를 확인하세요.', 409);
  if (!project || !usesSprints(project)) throw error('스프린트를 사용하는 유효한 프로젝트를 선택하세요.');
  if (!Array.isArray(sprints) || sprints.length > 30 || sprints.some(value => typeof value !== 'string' || !value.trim() || value.length > 100)) throw error('스프린트 선택값이 올바르지 않습니다.');
  if (expectedRevision !== null && typeof expectedRevision !== 'string') throw error('설정 버전이 필요합니다.');
  const allowed = new Set(availableSprints(dashboard, project).map(normalizeSprint));
  const selected = uniqueSprints(sprints);
  if (selected.some(value => !allowed.has(normalizeSprint(value)))) throw error('현재 프로젝트에서 확인되지 않은 스프린트입니다. 데이터를 다시 수집하세요.');
  const before = await readSprintSettings({ databaseId, query });
  const prior = before.projects[projectId];
  if ((prior?.revision || null) !== expectedRevision) throw error('다른 사용자가 설정을 변경했습니다. 최신 설정을 다시 불러오세요.', 409);
  if (prior && JSON.stringify(prior.sprints.map(normalizeSprint).sort()) === JSON.stringify(selected.map(normalizeSprint).sort())) return { settings: before, changed: false };
  const record = { kind: KIND, projectId, projectName: project.name, sprints: selected, revision: uuid(),
    parentRevision: prior?.revision || null, previousSprints: prior?.sprints || currentSprints(project), changedAt: now };
  create ||= (await import('./notion.mjs')).createDatabasePage;
  const serialized = JSON.stringify(record);
  const chunks = [];
  for (let i = 0; i < serialized.length; i += 1900) chunks.push(...text(serialized.slice(i, i + 1900)));
  await create(databaseId, {
    '이름': { title: text(`스프린트 설정 / ${project.name} / ${now}`) },
    '프로젝트명': { rich_text: text('대시보드 운영 설정') },
    '기준일': { date: { start: now } },
    run_id: { rich_text: text(`${SETTINGS_PREFIX}${projectId}:${record.revision}`) },
    payload: { rich_text: chunks },
  });
  const after = await readSprintSettings({ databaseId, query });
  if (after.projects[projectId]?.revision !== record.revision) throw error('설정 저장 중 다른 변경이 감지됐습니다. 최신 설정과 변경 이력을 확인하세요.', 409);
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
