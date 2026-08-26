import assert from 'node:assert/strict';
import test from 'node:test';

import { formatArchiveRetention } from './task-list-policy.ts';

test('归档保留期按服务端秒数生成短文案', () => {
  assert.equal(formatArchiveRetention(3 * 24 * 60 * 60), '3 天');
  assert.equal(formatArchiveRetention(12 * 60 * 60), '12 小时');
  assert.equal(formatArchiveRetention(30 * 60), '30 分钟');
});

test('旧服务端缺少策略字段时临时按 3 天展示', () => {
  assert.equal(formatArchiveRetention(), '3 天');
});
