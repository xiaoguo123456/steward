import { getCurrentUser, updateCurrentUser } from '@steward/api-client';

/** 读取设备当前 IANA 时区；极少数运行环境拿不到时使用 UTC 作为稳定兜底。 */
export function deviceTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/**
 * 把设备时区同步到用户资料。
 *
 * 时区是日期语义的计算基准，不是需要用户手工维护的偏好。调用方负责在失败后
 * 保持旧值，并在下次启动或回到前台时重试。
 */
export async function syncDeviceTimezone(): Promise<boolean> {
  const timezone = deviceTimezone();
  const current = await getCurrentUser();
  if (current.data.timezone === timezone) return false;

  await updateCurrentUser({ timezone });
  return true;
}
