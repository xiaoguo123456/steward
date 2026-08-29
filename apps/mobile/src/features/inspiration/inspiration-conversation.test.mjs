import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildInspirationNoteCaptureText,
  buildInspirationTaskProposalRequest,
  buildInspirationTurnText,
  visibleInspirationUserText,
} from './inspiration-conversation.ts';

test('灵感首条消息携带上下文但界面只展示用户回答', () => {
  const message = buildInspirationTurnText('问题：最近什么让你在意？', '我一直在想那个新点子。');

  assert.match(message, /灵感上下文/);
  assert.equal(visibleInspirationUserText(message), '我一直在想那个新点子。');
  assert.equal(visibleInspirationUserText('普通消息'), '普通消息');
});

test('整理笔记只把用户表达声明为事实来源', () => {
  const captureText = buildInspirationNoteCaptureText('最近什么让你在意？', [
    { role: 'user', content: buildInspirationTurnText('问题上下文', '我想试试做木工。') },
    { role: 'assistant', content: '可以先从一个小架子开始。' },
  ]);

  assert.match(captureText, /只把用户明确表达的内容当作事实/);
  assert.match(captureText, /我：我想试试做木工/);
  assert.match(captureText, /助理：可以先从一个小架子开始/);
  assert.doesNotMatch(captureText, /我：.*灵感上下文/);
});

test('待办沉淀明确要求生成待确认建议', () => {
  assert.match(buildInspirationTaskProposalRequest(), /task_create Proposal/);
  assert.match(buildInspirationTaskProposalRequest(), /不要直接执行/);
});
