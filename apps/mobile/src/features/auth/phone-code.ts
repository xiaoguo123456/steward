type PhoneCodeDeliveryData = {
  dev_code?: string | null;
};

export type PhoneCodeDelivery = {
  code: string;
  hint: string | null;
};

type ApiErrorDetails = {
  code: string;
  message: string;
};

function resolveApiErrorDetails(error: unknown): ApiErrorDetails | null {
  if (!error || typeof error !== 'object') {
    return null;
  }

  const candidate = error as { code?: unknown; message?: unknown };
  if (typeof candidate.code !== 'string' || typeof candidate.message !== 'string') {
    return null;
  }

  return {
    code: candidate.code,
    message: candidate.message,
  };
}

/** 测试环境直接填入后端返回的固定验证码；生产环境仍提示用户查看短信。 */
export function resolvePhoneCodeDelivery(data: PhoneCodeDeliveryData): PhoneCodeDelivery {
  const testCode = data.dev_code?.trim() ?? '';
  if (/^[0-9]{6}$/.test(testCode)) {
    return { code: testCode, hint: null };
  }
  return { code: '', hint: '验证码已发送，请查收短信' };
}

/** 将验证码发送失败转换成可恢复、可区分的用户提示。 */
export function phoneCodeErrorMessage(error: unknown): string {
  const details = resolveApiErrorDetails(error);
  if (!details) {
    return '无法连接服务器，请检查网络后重试。';
  }

  switch (details.code) {
    case 'PHONE_INVALID':
      return '手机号格式不正确，请检查后重试。';
    case 'RATE_LIMITED':
      return details.message || '请求过于频繁，请稍后再试。';
    case 'SMS_PROVIDER_UNAVAILABLE':
      return '短信服务暂时不可用，请稍后重试。';
    case 'INTERNAL_ERROR':
      return '服务暂时不可用，请稍后重试。';
    default:
      return details.message || '验证码发送失败，请稍后重试。';
  }
}

/** 将登录失败定位到验证码、账号状态或网络链路。 */
export function loginErrorMessage(error: unknown): string {
  const details = resolveApiErrorDetails(error);
  if (!details) {
    return '无法连接服务器，请检查网络后重试。';
  }

  switch (details.code) {
    case 'VERIFICATION_CODE_INVALID':
      return '验证码不正确，请重新输入。';
    case 'VERIFICATION_CODE_EXPIRED':
      return '验证码已过期，请重新获取。';
    case 'RATE_LIMITED':
      return details.message || '尝试次数过多，请稍后再试。';
    case 'ACCOUNT_NOT_ACTIVE':
      return details.message || '账号当前不可登录，请查看账号状态。';
    case 'INTERNAL_ERROR':
      return '服务暂时不可用，请稍后重试。';
    default:
      return details.message || '登录失败，请稍后重试。';
  }
}
