import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { ListMessagesResponse } from '../../../../../packages/api-client/src/generated/assistant/assistant.zod.ts';

const fixture = JSON.parse(readFileSync(new URL('../../../../../packages/contracts/fixtures/assistant-interaction.response.json', import.meta.url), 'utf8'));

test('澄清选项通过生成的网络契约且不包含内部对象引用', () => {
  const response = ListMessagesResponse.parse(fixture);
  assert.equal(response.data[0].interaction.outcome, 'clarification');
  assert.equal(response.data[0].interaction.choices.length, 2);
  assert.deepEqual(Object.keys(response.data[0].interaction.choices[0]).sort(), ['id', 'label']);
});
