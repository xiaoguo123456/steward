import assert from 'node:assert/strict';
import test from 'node:test';
import { choiceLabelParts, selectedChoiceId } from './clarification-choice-model.ts';

const choices = [{ id: 'a', label: '1. 周报 · 2026-09-12 · 未开始' }, { id: 'b', label: '2. 周报 · 2026-09-10 · 进行中' }];
test('历史回显只接受紧接着的用户选项原文或编号', () => {
  assert.equal(selectedChoiceId(choices, { role: 'user', content: choices[0].label }), 'a');
  assert.equal(selectedChoiceId(choices, { role: 'user', content: ' 2 ' }), 'b');
  assert.equal(selectedChoiceId(choices, { role: 'user', content: '换个话题' }), undefined);
  assert.equal(selectedChoiceId(choices, { role: 'assistant', content: '1' }), undefined);
});
test('仅拆分展示层级，保留标题内部的分隔符及一般选项原文', () => {
  assert.deepEqual(choiceLabelParts('1. 项目 · 周报 · 2026-09-12 · 未开始'), { title: '项目 · 周报', detail: '2026-09-12 · 未开始' });
  assert.deepEqual(choiceLabelParts('2. 取消这条偏好'), { title: '取消这条偏好', detail: '' });
});
