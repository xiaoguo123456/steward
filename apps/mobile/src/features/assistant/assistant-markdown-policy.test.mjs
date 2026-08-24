import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  assistantImageAlternative,
  normalizeAssistantLink,
} from './assistant-markdown-policy.ts';

test('只允许带主机名的 HTTPS 链接', () => {
  assert.equal(normalizeAssistantLink('https://example.com/help'), 'https://example.com/help');
  assert.equal(
    normalizeAssistantLink('  HTTPS://example.com/help?q=1  '),
    'https://example.com/help?q=1',
  );
});

test('拒绝不安全协议、相对路径和无效链接', () => {
  assert.equal(normalizeAssistantLink('http://example.com'), undefined);
  assert.equal(normalizeAssistantLink('javascript:alert(1)'), undefined);
  assert.equal(normalizeAssistantLink('data:text/html,hello'), undefined);
  assert.equal(normalizeAssistantLink('/tasks/123'), undefined);
  assert.equal(normalizeAssistantLink('不是链接'), undefined);
});

test('远程图片只展示可读的替代说明', () => {
  assert.equal(assistantImageAlternative(' 午餐照片 '), '图片：午餐照片');
  assert.equal(assistantImageAlternative(''), '图片已省略');
  assert.equal(assistantImageAlternative(undefined), '图片已省略');
});
