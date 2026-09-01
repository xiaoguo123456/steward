/** Web 没有与原生设备凭据等价的安全边界，因此不保存“已开启”的假状态。 */
export async function readAppLockEnabled(_accountId: string): Promise<boolean> {
  return false;
}

export async function writeAppLockEnabled(_accountId: string, _enabled: boolean): Promise<void> {
  throw new Error('应用锁仅支持 iOS 和 Android 原生应用');
}
