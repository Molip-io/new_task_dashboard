import { spawn } from 'node:child_process';

function slimDashboard(dashboard) {
  return {
    date: dashboard.generatedAt,
    projects: dashboard.projects.map(project => ({
      name: project.name,
      stats: project.stats,
      overdue: project.overdueTasks,
      activeTasks: project.activeTasks.slice(0, 15).map(task =>
        `${task.title} [${task.status}] ${task.assignees.join(',')} ~${task.due || '?'}`),
      notionSummary: project.notionSummary,
      meetings: project.meetings.map(meeting => `${meeting.date?.slice(0, 10)} ${meeting.title}`),
      slackMessages: (dashboard.slack[project.name] || []).flatMap(channel =>
        channel.messages.slice(-40).map(message =>
          `[#${channel.channel} ${message.time.slice(5, 16)} ${message.user}] ${message.text.slice(0, 250)}`)),
    })),
  };
}

export function buildLegacySummaryPrompt(dashboard) {
  return `너는 게임 스튜디오 대표의 업무 브리핑 편집자다. 아래 JSON은 Notion 작업 DB, 회의록, Slack 대화에서 수집한 사실이다.
입력의 프로젝트 상태를 변경하지 말고 수치·담당·기한도 그대로 유지한다. 대표가 5분 안에 현재 진행과 확인할 항목을 이해하도록 문장만 압축하라.

반드시 아래 스키마의 JSON만 출력하라. Markdown과 추가 설명은 금지한다.
{
  "overall": { "summary": "전체 상황 3문장 이내", "topRisks": ["입력 근거가 있는 리스크 최대 3개"], "decisionsForCEO": [{"project":"","question":"입력에 존재하는 결정 사안","context":"근거 1-2문장"}] },
  "projects": [{ "name": "프로젝트명(입력과 동일)", "summary": "진행 상황 2-3문장", "blockers": ["입력에 존재하는 막힌 것"], "highlights": ["Slack/회의 근거"], "nextActions": ["입력에 존재하는 다음 행동"] }]
}

금지: 프로젝트 상태 판정, 출처 충돌 해결, 새로운 의존관계·수치·기한·담당 생성, 개인 성과 평가.

데이터:
${JSON.stringify(slimDashboard(dashboard), null, 1)}`;
}

async function runClaude(prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['-p'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('claude -p 타임아웃(300s)'));
    }, 300_000);
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    child.on('error', reject);
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`claude -p 실패(${code}): ${stderr.slice(0, 300)}`));
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

export async function aiEnrich(dashboard, runner = runClaude) {
  const output = await runner(buildLegacySummaryPrompt(dashboard));
  const json = output.match(/\{[\s\S]*\}/)?.[0];
  if (!json) throw new Error('AI 응답에서 JSON 파싱 실패');
  return JSON.parse(json);
}
