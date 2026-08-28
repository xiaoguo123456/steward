export type CalendarMonthCell = {
  date: string;
  day: number;
  muted: boolean;
};

export type CalendarWeekCell = {
  date: string;
  day: number;
};

/** 月格只承担快速概览：只显示第一条可读内容，其他条目从详情或周历查看。 */
export function calendarCellPreview<T>(entries: readonly T[]): T | undefined {
  return entries[0];
}

/** 月格标题最多显示四个 Unicode 字符，不补省略号。 */
export function formatCalendarCellTitle(title: string): string {
  return Array.from(title).slice(0, 4).join('');
}

/** 月历固定为 6×7，前后月份用于补齐并承载跨月安排。 */
export function buildCalendarMonthCells(anchor: Date): CalendarMonthCell[] {
  const first = startOfCalendarMonth(anchor);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return {
      date: formatDateParam(date),
      day: date.getDate(),
      muted: date.getMonth() !== anchor.getMonth(),
    };
  });
}

export function calendarMonthRange(anchor: Date): { from: string; to: string } {
  const cells = buildCalendarMonthCells(anchor);
  return { from: cells[0].date, to: cells[cells.length - 1].date };
}

/** 周历与月历保持周日为一周起点。 */
export function buildCalendarWeekCells(selectedDate: string): CalendarWeekCell[] {
  const selected = parseCalendarDateKey(selectedDate);
  const start = new Date(selected);
  start.setDate(selected.getDate() - selected.getDay());

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return { date: formatDateParam(date), day: date.getDate() };
  });
}

export function calendarWeekRange(selectedDate: string): { from: string; to: string } {
  const cells = buildCalendarWeekCells(selectedDate);
  return { from: cells[0].date, to: cells[cells.length - 1].date };
}

export function shiftCalendarDateKey(date: string, days: number): string {
  const shifted = parseCalendarDateKey(date);
  shifted.setDate(shifted.getDate() + days);
  return formatDateParam(shifted);
}

export function startOfCalendarMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function monthAnchorFromDateKey(date: string): Date {
  const [year, month] = date.split('-').map(Number);
  return new Date(year, month - 1, 1);
}

export function dateKeyForSelectedMonth(anchor: Date, today: Date): string {
  if (
    anchor.getFullYear() === today.getFullYear()
    && anchor.getMonth() === today.getMonth()
  ) {
    return formatDateParam(today);
  }
  return formatDateParam(startOfCalendarMonth(anchor));
}

/** 月份入口固定显示完整年月，避免只显示月份时丢失年份上下文。 */
export function formatCalendarMonthTitle(date: Date): string {
  return `${date.getFullYear()}年${String(date.getMonth() + 1).padStart(2, '0')}月`;
}

/** 当天安排面板同时显示日期与星期，减少用户返回月格确认的成本。 */
export function formatCalendarDayTitle(date: string): string {
  const parsed = parseCalendarDateKey(date);
  const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日 · ${weekDays[parsed.getDay()]}`;
}

export function formatCalendarWeekTitle(selectedDate: string): string {
  const { from, to } = calendarWeekRange(selectedDate);
  const fromYear = Number(from.slice(0, 4));
  const toYear = Number(to.slice(0, 4));
  const fromMonth = Number(from.slice(5, 7));
  const toMonth = Number(to.slice(5, 7));
  const fromDay = Number(from.slice(8, 10));
  const toDay = Number(to.slice(8, 10));

  if (fromYear !== toYear) {
    return `${fromYear}年${fromMonth}月${fromDay}日—${toYear}年${toMonth}月${toDay}日`;
  }
  if (fromMonth !== toMonth) return `${fromMonth}月${fromDay}日—${toMonth}月${toDay}日`;
  return `${fromMonth}月${fromDay}日—${toDay}日`;
}

function parseCalendarDateKey(date: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}

function formatDateParam(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
