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

test('当前公开 H5 已通过生产发布门禁', async () => {
  const result = await validatePublicH5({ production: true });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.blockers, []);
});

test('noindex 与发布阻塞标记会阻断生产发布', () => {
  const source = '<!doctype html><html lang="zh-CN"><head><meta name="viewport"><meta name="robots" content="noindex,nofollow"><title>法律页面</title></head><body><h1>法律页面</h1><aside data-release-blocker="true">尚未发布</aside></body></html>'.padEnd(920, 'x');
  const result = validateHtmlSource('legal/index.html', source, { production: true });
  assert.deepEqual(result.errors, []);
  assert.ok(result.blockers.some((item) => item.includes('noindex')));
  assert.ok(result.blockers.some((item) => item.includes('data-release-blocker')));
});

test('公开页面拒绝脚本、用户 API 与伪删除表单', () => {
  const source = '<!doctype html><html lang="zh-CN"><head><meta name="viewport"><title>删除</title></head><body><h1>删除</h1><form action="/v1/me/delete"><script>go()</script></form>'.padEnd(920, 'x');
  const result = validateHtmlSource('legal/account-deletion/index.html', source);
  assert.equal(result.errors.length, 3);
});
