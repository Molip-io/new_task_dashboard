import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProjectRows, delayEvidenceFromComments } from '../lib/notion-collector.mjs';
import { validateWorkManagement } from '../lib/work-validation.mjs';

const config = {
  validation: { sprintOptionalProjects: [] },
  slackDaysDefault: 3,
  historicalContextDays: 45,
};

test('Project source sprint survives as a separate operational value', () => {
  const [project] = parseProjectRows([{
    _id: 'forge',
    '이름': '포지 앤 포춘',
    '현재 스프린트': ['스프린트4'],
  }], config);

  assert.deepEqual(project.currentSprints, ['스프린트4']);
  assert.deepEqual(project.sourceCurrentSprints, ['스프린트4']);
});

test('Delay evidence extracts reason, date transition and user mentions from comments', () => {
  const evidence = delayEvidenceFromComments([{
    rich_text: [
      { type: 'text', plain_text: '일정 지연 사유: 기획 방향 추가 검토. 9/18 → 9/23 ' },
      { type: 'mention', plain_text: '@PD', mention: { type: 'user', user: { id: 'pd-1' } } },
    ],
  }]);

  assert.equal(evidence.reasonPresent, true);
  assert.equal(evidence.dateHistoryPresent, true);
  assert.deepEqual(evidence.taggedUserIds, ['pd-1']);
});

test('Validation uses project source sprint instead of dashboard-global scope', () => {
  const result = validateWorkManagement({
    tasks: [{
      id: 'task-1',
      title: '작업',
      status: '시작 전',
      project: '포지 앤 포춘',
      projectMissing: false,
      parentIds: [],
      assignees: ['A'],
      priority: '1순위',
      start: '2026-09-25',
      due: '2026-09-30',
      sprint: 'Sprint4',
      branch: 'sprint4',
      description: '설명',
      descriptionChecked: true,
      commentCheckAvailable: false,
    }],
    projects: [{
      name: '포지 앤 포춘',
      sprintRequired: true,
      currentSprints: [],
      sourceCurrentSprints: ['스프린트4'],
    }],
    now: '2026-09-25T09:00:00+09:00',
  });

  assert.ok(result.issues.some(issue => issue.type === 'CURRENT_SPRINT_SETUP_REQUIRED'));
  assert.ok(!result.issues.some(issue => issue.type === 'RULE_NOT_EVALUATED' && issue.metadata?.rule === 'sprint-relation'));
});

test('Overdue delay comments satisfy guide checks without duplicate structured fields', () => {
  const result = validateWorkManagement({
    tasks: [{
      id: 'task-2',
      title: '지연 작업',
      status: '진행 중',
      project: '포지 앤 포춘',
      projectMissing: false,
      parentIds: [],
      assignees: ['A'],
      priority: '1순위',
      start: '2026-09-10',
      due: '2026-09-20',
      sprint: 'Sprint4',
      branch: 'sprint4',
      description: '설명',
      descriptionChecked: true,
      commentCheckAvailable: true,
      delayCommentEvidence: {
        checked: true,
        reasonPresent: true,
        dateHistoryPresent: true,
        taggedUserIds: ['pd-1'],
      },
    }],
    projects: [{
      name: '포지 앤 포춘',
      sprintRequired: true,
      currentSprints: [],
      sourceCurrentSprints: ['스프린트4'],
    }],
    now: '2026-09-25T09:00:00+09:00',
  });

  const types = result.issues.map(issue => issue.type);
  assert.ok(types.includes('OVERDUE'));
  assert.ok(!types.includes('MISSING_DELAY_REASON'));
  assert.ok(!types.includes('MISSING_DELAY_DATE_HISTORY'));
  assert.ok(!types.includes('MISSING_DELAY_OWNER_TAG'));
});

test('Unavailable delay comments produce unknown evaluation instead of false missing records', () => {
  const result = validateWorkManagement({
    tasks: [{
      id: 'task-3',
      title: '댓글 미수집 작업',
      status: '진행 중',
      project: '포지 앤 포춘',
      projectMissing: false,
      parentIds: [],
      assignees: ['A'],
      priority: '1순위',
      start: '2026-09-10',
      due: '2026-09-20',
      sprint: 'Sprint4',
      branch: 'sprint4',
      description: '설명',
      descriptionChecked: true,
      commentCheckAvailable: false,
    }],
    projects: [{
      name: '포지 앤 포춘',
      sprintRequired: true,
      currentSprints: [],
      sourceCurrentSprints: ['스프린트4'],
    }],
    now: '2026-09-25T09:00:00+09:00',
  });

  const delayUnknown = result.issues.find(issue => issue.type === 'RULE_NOT_EVALUATED' && issue.metadata?.rule === 'delay-record');
  assert.ok(delayUnknown);
  assert.deepEqual(delayUnknown.metadata.uncheckedFields, ['delayReason', 'dateHistory', 'ownerTag']);
  assert.ok(!result.issues.some(issue => issue.type.startsWith('MISSING_DELAY_')));
});
