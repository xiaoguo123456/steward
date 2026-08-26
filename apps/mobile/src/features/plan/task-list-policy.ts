// 只用于兼容尚未下发策略字段的旧服务端；新服务端始终返回实际配置。
export const FALLBACK_ARCHIVE_RETENTION_SECONDS = 72 * 60 * 60;

/** 把服务端下发的归档保留时长转成按钮里的短文案。 */
export function formatArchiveRetention(seconds?: number): string {
  const safeSeconds = Math.max(1, Math.round(seconds ?? FALLBACK_ARCHIVE_RETENTION_SECONDS));
  if (safeSeconds >= 24 * 60 * 60 && safeSeconds % (24 * 60 * 60) === 0) {
    return `${safeSeconds / (24 * 60 * 60)} 天`;
  }
  if (safeSeconds >= 60 * 60) {
    return `${Math.ceil(safeSeconds / (60 * 60))} 小时`;
  }
  return `${Math.ceil(safeSeconds / 60)} 分钟`;
}
