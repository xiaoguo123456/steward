/**
 * 展示层的时间与数值格式化。
 *
 * 这里只做「怎么显示」，不做任何业务推导：
 * 是否逾期、是否进入 Today、状态如何流转都由服务端决定。
 */

/** 把时间戳格式化成「刚刚 / N 分钟前 / 今天 HH:MM / M月D日」。 */
export function formatRelativeTime(iso: string): string {
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) {
    return '';
  }
  const now = new Date();
  const diffMs = now.getTime() - target.getTime();
  const diffMinutes = Math.floor(diffMs / 60_000);

  if (diffMinutes < 1) return '刚刚';
  if (diffMinutes < 60) return `${diffMinutes} 分钟前`;

  if (isSameDay(target, now)) {
    return `今天 ${formatClock(target)}`;
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(target, yesterday)) {
    return `昨天 ${formatClock(target)}`;
  }
  if (target.getFullYear() === now.getFullYear()) {
    return `${target.getMonth() + 1}月${target.getDate()}日`;
  }
  return `${target.getFullYear()}年${target.getMonth() + 1}月${target.getDate()}日`;
}

/** 输出 HH:MM。 */
export function formatClock(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** 输出 YYYY-MM-DD，用于填充契约里的 date 字段。 */
export function formatDateParam(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** 输出「M月D日」。 */
export function formatMonthDay(iso: string): string {
  const date = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
