import assert from 'node:assert/strict';
import test from 'node:test';

import { resolvePhoneCodeDelivery } from './phone-code.ts';

test('测试环境返回验证码时直接填入', () => {
  assert.deepEqual(resolvePhoneCodeDelivery({ dev_code: '123456' }), {
    code: '123456',
    hint: null,
  });
});

test('生产环境未返回验证码时提示查看短信', () => {
  assert.deepEqual(resolvePhoneCodeDelivery({}), {
    code: '',
    hint: '验证码已发送，请查收短信',
  });
});

test('不自动填入不合法的测试验证码', () => {
  assert.deepEqual(resolvePhoneCodeDelivery({ dev_code: '1234' }), {
    code: '',
    hint: '验证码已发送，请查收短信',
  });
});
