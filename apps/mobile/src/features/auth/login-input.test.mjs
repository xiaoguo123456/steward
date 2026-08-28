import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizePhoneInput, phoneValidationMessage } from './login-input.ts';

test('手机号输入会移除格式字符并限制为 11 位', () => {
  assert.equal(normalizePhoneInput('138 0013-8000abc9'), '13800138000');
});

test('输入过程中不提前报错，离开后给出可操作提示', () => {
  assert.equal(phoneValidationMessage('1380', false), null);
  assert.equal(phoneValidationMessage('1380', true), '请输入 11 位中国大陆手机号');
  assert.equal(phoneValidationMessage('13800138000', true), null);
});
