import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT } from './env.mjs';

function slimDashboard(dashboard) {
  return {
    date: dashboard.generatedAt,
    projects: dashboard.projects.map(project => ({
      name: project.name, goal: project.goal, stats: project.stats,
      managementStatus: project.managementStatus,
      workItems: (dashboard.workItems || []).filter(item => item.project === project.name).slice(0, 40).map(item => ({
        title: item.title, spec: item.spec, status: item.status, assignees: item.assignees,
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
    })),
    deltas: dashboard.deltas || [],
    unclassifiedIssues: (dashboard.validationIssues || []).filter(issue => !issue.project),
  };
}

export function buildSummaryPrompt(dashboard) {
  const instructions = fs.readFileSync(path.join(ROOT, 'prompts', 'dashboard-summary.md'), 'utf8');
  return `${instructions}\n\n## 입력 데이터\n${JSON.stringify(slimDashboard(dashboard), null, 1)}`;
}

async function runModel(prompt) {
  return new Promise((resolve, reject) => {
    const command = process.env.AI_COMMAND || 'claude';
    const args = String(process.env.AI_ARGS || '-p').split(/\s+/).filter(Boolean);
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${command} AI 요약 타임아웃(300s)`)); }, 300_000);
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    child.on('error', reject);
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} AI 요약 실패(${code}): ${stderr.slice(0, 300)}`));
    });
    child.stdin.write(prompt); child.stdin.end();
  });
}

export async function aiEnrich(dashboard, runner = runModel) {
  const output = await runner(buildSummaryPrompt(dashboard));
  const json = output.match(/\{[\s\S]*\}/)?.[0];
  if (!json) throw new Error('AI 응답에서 JSON 파싱 실패');
  return JSON.parse(json);
}
