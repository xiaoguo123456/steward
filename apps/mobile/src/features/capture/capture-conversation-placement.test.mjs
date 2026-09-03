import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('Capture 提交后直接打开 AI 管家，不经过处理或确认页面', async () => {
  const [capture, assistant, layout] = await Promise.all([
    read('../../app/capture/new.tsx'),
    read('../../app/ai.tsx'),
    read('../../app/_layout.tsx'),
  ]);

  assert.match(capture, /pathname: '\/ai'/);
  assert.doesNotMatch(capture, /pathname: '\/capture\/processing'/);
  assert.match(assistant, /<AssistantCaptureFlow/);
  assert.doesNotMatch(layout, /assistant\/pending|capture\/processing|capture\/confirm/);
  await Promise.all([
    assert.rejects(access(new URL('../../app/assistant/pending.tsx', import.meta.url)), { code: 'ENOENT' }),
    assert.rejects(access(new URL('../../app/capture/processing.tsx', import.meta.url)), { code: 'ENOENT' }),
    assert.rejects(access(new URL('../../app/capture/confirm.tsx', import.meta.url)), { code: 'ENOENT' }),
  ]);
});

test('AI 管家入口常驻，数量为零时不渲染红点但仍可打开', async () => {
  const fab = await read('../../components/ui/ai-fab.tsx');

  assert.match(fab, /\(\) => router\.push\('\/ai'\)/);
  assert.doesNotMatch(fab, /visibleCount === 0\) return null/);
  assert.match(fab, /visibleCount > 0 \? \(/);
  assert.match(fab, /: '打开 AI 管家'/);
});

test('Capture 对话会话支持关闭浮层后恢复，并保持确认后才写入', async () => {
  const [provider, flow] = await Promise.all([
    read('./capture-assistant-session.tsx'),
    read('./assistant-capture-flow.tsx'),
  ]);

  assert.match(provider, /session: CaptureAssistantSession \| null/);
  assert.match(provider, /服务端 Capture 仍是权威状态/);
  assert.match(flow, /confirmCapture\(session\.captureId/);
  assert.match(flow, /确认前它们不会进入正式列表/);
  assert.match(flow, /durationMs: 10_000/);
  assert.match(flow, /undoActivityBatch\(activityBatchId\)/);
});

test('撤销 Snackbar 使用紧凑宽度，同时保留 44dp 操作目标和安全区偏移', async () => {
  const toast = await read('../../components/ui/toast.tsx');

  assert.match(toast, /styles\.toastLayer, \{ bottom: insets\.bottom \+ 84 \}/);
  assert.match(toast, /toast:\s*\{[^}]*maxWidth:\s*420,[^}]*minWidth:\s*220,[^}]*minHeight:\s*44,/s);
  assert.match(toast, /action:\s*\{[^}]*minHeight:\s*44,[^}]*minWidth:\s*56,/s);
  assert.doesNotMatch(toast, /toast:\s*\{[^}]*left:\s*24,[^}]*right:\s*24,/s);
});
