import assert from 'node:assert/strict';
import test from 'node:test';

import {
  requiredPublicPages,
  validateHtmlSource,
  validatePublicH5,
} from './check-public-h5.mjs';

test('公开 H5 固定路径完整且测试环境结构校验通过', async () => {
  assert.deepEqual(requiredPublicPages, [
    'legal/index.html',
    'legal/privacy/index.html',
    'legal/terms/index.html',
    'legal/personal-information/index.html',
    'legal/third-parties/index.html',
    'legal/account-deletion/index.html',
    'support/index.html',
  ]);
  const result = await validatePublicH5();
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.blockers, []);
});

test('占位与 noindex 会阻断生产发布', async () => {
  const result = await validatePublicH5({ production: true });
  assert.equal(result.errors.length, 0);
  assert.ok(result.blockers.length > 0);
  assert.ok(result.blockers.some((item) => item.includes('待确认')));
});

test('公开页面拒绝脚本、用户 API 与伪删除表单', () => {
  const source = '<!doctype html><html lang="zh-CN"><head><meta name="viewport"><title>删除</title></head><body><h1>删除</h1><form action="/v1/me/delete"><script>go()</script></form>'.padEnd(920, 'x');
  const result = validateHtmlSource('legal/account-deletion/index.html', source);
  assert.equal(result.errors.length, 3);
});
