import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPublicPageUrl, publicPagePaths } from './public-pages.ts';

test('公开 H5 跟随当前环境域名且路径固定', () => {
  assert.equal(
    buildPublicPageUrl('https://test-steward.qhzhiyin.com/', publicPagePaths.privacy),
    'https://test-steward.qhzhiyin.com/legal/privacy/',
  );
  assert.equal(
    buildPublicPageUrl('https://steward.qhzhiyin.com', publicPagePaths.accountDeletion),
    'https://steward.qhzhiyin.com/account-deletion',
  );
  assert.equal(
    buildPublicPageUrl('https://steward.qhzhiyin.com', publicPagePaths.support),
    'https://steward.qhzhiyin.com/support/',
  );
});

test('公开路径不能被基础地址中的子路径吞掉', () => {
  assert.equal(
    buildPublicPageUrl('https://example.com/v1', publicPagePaths.terms),
    'https://example.com/legal/terms/',
  );
});
