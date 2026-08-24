type PhoneCodeDeliveryData = {
  dev_code?: string | null;
};

export type PhoneCodeDelivery = {
  code: string;
  hint: string | null;
};

/** 测试环境直接填入后端返回的固定验证码；生产环境仍提示用户查看短信。 */
export function resolvePhoneCodeDelivery(data: PhoneCodeDeliveryData): PhoneCodeDelivery {
  const testCode = data.dev_code?.trim() ?? '';
  if (/^[0-9]{6}$/.test(testCode)) {
    return { code: testCode, hint: null };
  }
  return { code: '', hint: '验证码已发送，请查收短信' };
}
