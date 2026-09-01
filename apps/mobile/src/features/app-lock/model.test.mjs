import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appLockStorageKey,
  authenticationFailureMessage,
  shouldShieldApp,
} from './model.ts';

test('应用锁偏好按账号隔离且键名满足 SecureStore 限制', () => {
  assert.equal(appLockStorageKey('user/中国 1'), 'steward.app-lock.enabled.v1.user____1');
  assert.notEqual(appLockStorageKey('account-a'), appLockStorageKey('account-b'));
});

test('偏好读取完成前和锁定后都遮挡已登录内容', () => {
  assert.equal(shouldShieldApp({ active: true, ready: false, enabled: false, locked: true }), true);
  assert.equal(shouldShieldApp({ active: true, ready: true, enabled: true, locked: true }), true);
  assert.equal(shouldShieldApp({ active: true, ready: true, enabled: true, locked: false }), false);
  assert.equal(shouldShieldApp({ active: false, ready: false, enabled: true, locked: true }), false);
});

test('存储异常可用已开启且锁定状态表达，保证失败时不暴露内容', () => {
  assert.equal(shouldShieldApp({ active: true, ready: true, enabled: true, locked: true }), true);
});

test('取消、锁定和未录入认证都有可恢复说明', () => {
  assert.match(authenticationFailureMessage('user_cancel'), /继续保持锁定/);
  assert.match(authenticationFailureMessage('lockout'), /设备密码|稍后重试/);
  assert.match(authenticationFailureMessage('not_enrolled'), /系统设置/);
});
