import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './env.mjs';

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const DEFAULT_OPENAI_MODEL = 'gpt-5.6-sol';

function summarizeSprints(workItems) {
  const groups = new Map();
  for (const item of workItems) {
    const sprint = item.sprint || '스프린트 미지정';
    if (!groups.has(sprint)) groups.set(sprint, []);
    groups.get(sprint).push(item);
  }
  return [...groups.entries()].map(([sprint, items]) => {
    const done = items.filter(item => ['완료', '중단'].includes(item.status)).length;
    return {
      sprint,
      total: items.length,
      done,
      completionRate: items.length ? Math.round(done / items.length * 100) : 0,
      overdue: items.filter(item => item.overdueDays > 0).length,
    };
  });
}

function slimDashboard(dashboard) {
  return {
    date: dashboard.generatedAt,
    projects: dashboard.projects.map(project => {
      const projectItems = (dashboard.workItems || []).filter(item => item.project === project.name);
      return {
        name: project.name, goal: project.goal,
        workStateCounts: {
          total: project.stats?.total || 0,
          inProgress: project.stats?.inProgress || 0,
          planned: project.stats?.planned || 0,
          review: project.stats?.review || 0,
          overdue: project.stats?.overdue || 0,
        },
        sprints: summarizeSprints(projectItems),
        managementStatus: project.managementStatus,
        workItems: projectItems.slice(0, 40).map(item => ({
          title: item.title, spec: item.spec, status: item.status, assignees: item.assignees,
          sprint: item.sprint,
          start: item.start, due: item.due, completedAt: item.completedAt,
          notionUpdatedAt: item.notionUpdatedAt, latestGitAt: item.latestGitAt,
          issues: (item.issues || []).map(issue => issue.message),
        })),
        notionSummary: project.notionSummary,
        meetings: project.meetings.map(meeting => `${meeting.date?.slice(0, 10)} ${meeting.title}`),
        slackMessages: (dashboard.slack[project.name] || []).flatMap(channel =>
          channel.messages.slice(-40).map(message => `[#${channel.channel} ${message.time.slice(5, 16)} ${message.user}] ${message.text.slice(0, 250)}`)),
        gitCommits: (dashboard.git?.commits || []).filter(commit => commit.project === project.name).slice(0, 20)
          .map(commit => `${commit.committedAt} ${commit.author} ${commit.shortHash} ${commit.message}`),
      };
    }),
    deltas: dashboard.deltas || [],
    unclassifiedIssues: (dashboard.validationIssues || []).filter(issue => !issue.project),
  };
}

export function buildSummaryPrompt(dashboard) {
  const instructions = fs.readFileSync(path.join(ROOT, 'prompts', 'dashboard-summary.md'), 'utf8');
  return `${instructions}\n\n## 입력 데이터\n${JSON.stringify(slimDashboard(dashboard), null, 1)}`;
}

function outputText(response) {
  if (response?.output_text) return response.output_text;
  return (response?.output || []).flatMap(item => item.content || [])
    .filter(content => content.type === 'output_text')
    .map(content => content.text)
    .join('');
}

export async function requestOpenAISummary(prompt, options = {}) {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY 없음 — .env 또는 Vercel 환경변수에 설정하세요.');
  const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas', 'dashboard-summary.schema.json'), 'utf8'));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 300_000);
  let response;
  try {
    response = await (options.fetchImpl || fetch)(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
      body: JSON.stringify({
        model: options.model || process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
        input: prompt,
        store: false,
        text: { format: { type: 'json_schema', name: 'dashboard_summary', strict: true, schema } },
      }),
    });
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('OpenAI API 요약 타임아웃(300s)');
    throw error;
  } finally {
    clearTimeout(timer);
  }
  const payload = await response.json();
  if (!response.ok) throw new Error(`OpenAI API 실패(${response.status}): ${payload.error?.message || '응답 오류'}`);
  const text = outputText(payload);
  if (!text) throw new Error('OpenAI API 응답에 요약 텍스트가 없습니다.');
  return text;
}

export async function aiEnrich(dashboard, runner = requestOpenAISummary) {
  const output = await runner(buildSummaryPrompt(dashboard));
  const json = output.match(/\{[\s\S]*\}/)?.[0];
  if (!json) throw new Error('AI 응답에서 JSON 파싱 실패');
  return JSON.parse(json);
}
