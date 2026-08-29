import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  assistantThreadSessionReducer,
  createAssistantThreadSession,
} from './assistant-thread-session.ts';

test('路由指定的历史对话优先于默认恢复', () => {
  const selected = createAssistantThreadSession('ath_history');
  const restored = assistantThreadSessionReducer(selected, {
    type: 'restore_current',
    threadId: 'ath_today',
  });

  assert.deepEqual(restored, { threadId: 'ath_history', mode: 'selected' });
});

test('点击新对话后忽略迟到的当天恢复结果', () => {
  const initial = createAssistantThreadSession();
  const fresh = assistantThreadSessionReducer(initial, { type: 'start_fresh' });
  const restored = assistantThreadSessionReducer(fresh, {
    type: 'restore_current',
    threadId: 'ath_today',
  });

  assert.deepEqual(restored, { threadId: '', mode: 'fresh' });
});

test('灵感对话从独立的新会话开始', () => {
  assert.deepEqual(createAssistantThreadSession(undefined, true), {
    threadId: '',
    mode: 'fresh',
  });
});

test('首条消息取得服务端 Thread 后成为当天默认对话', () => {
  const fresh = assistantThreadSessionReducer(createAssistantThreadSession(), {
    type: 'start_fresh',
  });
  const attached = assistantThreadSessionReducer(fresh, {
    type: 'attach_thread',
    threadId: 'ath_new',
  });

  assert.deepEqual(attached, { threadId: 'ath_new', mode: 'default' });
});
