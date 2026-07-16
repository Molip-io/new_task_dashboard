import assert from 'node:assert/strict';
import test from 'node:test';
import { enrichValidationIssue, ISSUE_CATALOG, issueDefinition } from '../lib/issue-catalog.mjs';

test('Given the shared issue catalog, When definitions are inspected, Then every type has a complete management action contract', () => {
  for (const [type, definition] of Object.entries(ISSUE_CATALOG)) {
    assert.ok(['guide', 'schedule', 'consistency', 'integration'].includes(definition.category), `${type} category`);
    assert.ok(definition.label, `${type} label`);
    assert.ok(definition.responsibleRole, `${type} responsibleRole`);
    assert.ok(definition.actionTarget, `${type} actionTarget`);
    assert.ok(definition.recommendedAction, `${type} recommendedAction`);
  }
});

test('Given known issue domains, When definitions are selected, Then guide, schedule, consistency, and integration remain distinct', () => {
  assert.equal(issueDefinition('MISSING_DUE_DATE').category, 'guide');
  assert.equal(issueDefinition('OVERDUE').category, 'schedule');
  assert.equal(issueDefinition('GIT_NOTION_ACTIVITY_MISMATCH').category, 'consistency');
  assert.equal(issueDefinition('GIT_AUTH_REQUIRED').category, 'integration');
});

test('Given a spec-level issue with a work-item default, When it is enriched, Then its action target follows the actual subject', () => {
  const issue = enrichValidationIssue({ type: 'DATE_RANGE_MISMATCH', specId: 'spec', workItemId: null });

  assert.equal(issue.actionTarget, 'spec');
});
