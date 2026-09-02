import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  appRouteForPublicPageUrl,
  buildPublicPageUrl,
  isAllowedPublicPageUrl,
  isPublicPageKey,
  publicPagePaths,
  publicPageRoute,
} from './public-pages.ts';

test('公开 H5 跟随当前环境域名且路径固定', () => {
  assert.equal(
    buildPublicPageUrl('https://test-steward.qhzhiyin.com/', publicPagePaths.privacy),
    'https://test-steward.qhzhiyin.com/legal/privacy/',
  );
  assert.equal(
    buildPublicPageUrl('https://steward.qhzhiyin.com', publicPagePaths.support),
    'https://steward.qhzhiyin.com/support/',
  );
});

test('App 路由只接收稳定页面键，不接收任意 URL', () => {
  assert.equal(isPublicPageKey('privacy'), true);
  assert.equal(isPublicPageKey('support'), true);
  assert.equal(isPublicPageKey('https://attacker.example'), false);
  assert.deepEqual(publicPageRoute('terms'), {
    pathname: '/public-page',
    params: { page: 'terms' },
  });
});

test('内嵌容器只允许同源法律与帮助路径', () => {
  const baseUrl = 'https://steward.qhzhiyin.com';
  assert.equal(isAllowedPublicPageUrl(`${baseUrl}/legal/privacy/`, baseUrl), true);
  assert.equal(isAllowedPublicPageUrl(`${baseUrl}/support/`, baseUrl), true);
  assert.equal(isAllowedPublicPageUrl(`${baseUrl}/v1/users/me`, baseUrl), false);
  assert.equal(isAllowedPublicPageUrl('https://attacker.example/legal/privacy/', baseUrl), false);
  assert.equal(isAllowedPublicPageUrl('javascript:alert(1)', baseUrl), false);
});

test('H5 的账号删除按钮回到原生公开页', () => {
  const baseUrl = 'https://steward.qhzhiyin.com';
  assert.equal(
    appRouteForPublicPageUrl(`${baseUrl}/account-deletion`, baseUrl),
    '/account-deletion',
  );
  assert.equal(appRouteForPublicPageUrl(`${baseUrl}/v1/users/me`, baseUrl), null);
});

test('原生公开页容器默认关闭脚本、存储和原生桥接', async () => {
  const source = await readFile(
    new URL('./public-page-frame.native.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /javaScriptEnabled=\{false\}/);
  assert.match(source, /domStorageEnabled=\{false\}/);
  assert.match(source, /thirdPartyCookiesEnabled=\{false\}/);
  assert.match(source, /allowFileAccess=\{false\}/);
  assert.match(source, /mixedContentMode="never"/);
  assert.match(source, /setSupportMultipleWindows=\{false\}/);
  assert.match(source, /onShouldStartLoadWithRequest=\{shouldStart\}/);
  assert.doesNotMatch(source, /onMessage=|injectedJavaScript/);
});

test('公开路径不能被基础地址中的子路径吞掉', () => {
  assert.equal(
    buildPublicPageUrl('https://example.com/v1', publicPagePaths.terms),
    'https://example.com/legal/terms/',
  );
});
