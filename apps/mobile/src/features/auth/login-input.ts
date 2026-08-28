export const PHONE_PATTERN = /^1[3-9]\d{9}$/;

/** 手机号输入只保留数字，避免空格或粘贴格式影响服务端校验。 */
export function normalizePhoneInput(value: string): string {
  return value.replace(/\D/g, '').slice(0, 11);
}

/** 只在用户离开输入框或尝试继续后提示，避免输入过程中持续报错。 */
export function phoneValidationMessage(phone: string, touched: boolean): string | null {
  if (!touched || phone.length === 0 || PHONE_PATTERN.test(phone)) return null;
  return '请输入 11 位中国大陆手机号';
}
