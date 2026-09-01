import type { LocalAuthenticationError } from 'expo-local-authentication';

/** SecureStore 的键名只允许字母、数字、点、横线和下划线。 */
export function appLockStorageKey(accountId: string): string {
  const safeAccountId = accountId.replace(/[^A-Za-z0-9._-]/g, '_');
  return `steward.app-lock.enabled.v1.${safeAccountId}`;
}

/** 系统认证失败时使用稳定、可恢复的中文说明，不暴露平台内部错误。 */
export function authenticationFailureMessage(error: LocalAuthenticationError): string {
  switch (error) {
    case 'not_enrolled':
    case 'passcode_not_set':
      return '请先在系统设置中录入生物识别并设置设备密码。';
    case 'lockout':
      return '系统暂时锁定了生物识别，请使用设备密码或稍后重试。';
    case 'not_available':
      return '当前设备暂时无法使用系统身份验证。';
    case 'user_cancel':
    case 'app_cancel':
    case 'system_cancel':
    case 'user_fallback':
      return '没有完成验证，内容继续保持锁定。';
    case 'timeout':
      return '验证已超时，请重试。';
    default:
      return '身份验证没有通过，请重试。';
  }
}

export function shouldShieldApp({
  active,
  ready,
  enabled,
  locked,
}: {
  active: boolean;
  ready: boolean;
  enabled: boolean;
  locked: boolean;
}): boolean {
  return active && (!ready || (enabled && locked));
}
