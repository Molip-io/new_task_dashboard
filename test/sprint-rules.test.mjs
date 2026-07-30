import assert from 'node:assert/strict';
import test from 'node:test';

import { classifySprint, normalizeSprint } from '../lib/sprint-rules.mjs';

test('Given Korean and English sprint labels, When normalized, Then equivalent sprint numbers match exactly', () => {
  assert.equal(normalizeSprint('Sprint 060'), 'sprint60');
  assert.equal(normalizeSprint('스프린트60'), 'sprint60');
  assert.notEqual(normalizeSprint('Sprint6'), normalizeSprint('Sprint60'));
});

test('Given one or more current sprints, When a task sprint is classified, Then current, future, past, and unknown remain distinct', () => {
  assert.equal(classifySprint('Sprint60', ['스프린트60', '스프린트61']), 'current');
  assert.equal(classifySprint('Sprint62', ['스프린트60', '스프린트61']), 'future');
  assert.equal(classifySprint('Sprint59', ['스프린트60', '스프린트61']), 'past');
  assert.equal(classifySprint('Sprint60', []), 'unknown');
  assert.equal(classifySprint('milestone-a', ['milestone-b']), 'unknown');
});
