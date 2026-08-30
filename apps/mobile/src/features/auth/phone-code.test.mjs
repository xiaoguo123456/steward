import assert from 'node:assert/strict';
import test from 'node:test';

import {
  loginErrorMessage,
  phoneCodeErrorMessage,
  resolvePhoneCodeDelivery,
} from './phone-code.ts';

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

test('验证码发送失败会区分网络、限流与短信服务错误', () => {
  assert.equal(phoneCodeErrorMessage(new TypeError('Network request failed')), '无法连接服务器，请检查网络后重试。');
  assert.equal(
    phoneCodeErrorMessage(
      {
        code: 'RATE_LIMITED',
        message: '请求过于频繁，请 42 秒后重试。',
      },
    ),
    '请求过于频繁，请 42 秒后重试。',
  );
  assert.equal(
    phoneCodeErrorMessage(
      {
        code: 'SMS_PROVIDER_UNAVAILABLE',
        message: '上游错误',
      },
    ),
    '短信服务暂时不可用，请稍后重试。',
  );
});

test('登录失败会区分验证码错误、过期与网络错误', () => {
  assert.equal(
    loginErrorMessage(
      {
        code: 'VERIFICATION_CODE_INVALID',
        message: '旧文案',
      },
    ),
    '验证码不正确，请重新输入。',
  );
  assert.equal(
    loginErrorMessage(
      {
        code: 'VERIFICATION_CODE_EXPIRED',
        message: '旧文案',
      },
    ),
    '验证码已过期，请重新获取。',
  );
  assert.equal(loginErrorMessage(new TypeError('Network request failed')), '无法连接服务器，请检查网络后重试。');
});
