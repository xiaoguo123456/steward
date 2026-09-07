import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { GetTaskResponse } from '../../../../../packages/api-client/src/generated/tasks/tasks.zod.ts';

const fixture = JSON.parse(readFileSync(new URL('../../../../../packages/contracts/fixtures/assistant-task.response.json', import.meta.url), 'utf8'));
test('AI 建议确认后的 Task 可由正式网络契约读取', () => {
  assert.equal(GetTaskResponse.safeParse(fixture).success, true);
  const broken = structuredClone(fixture);
  broken.data.provenance_refs[0].action = '';
  assert.equal(GetTaskResponse.safeParse(broken).success, false);
});
