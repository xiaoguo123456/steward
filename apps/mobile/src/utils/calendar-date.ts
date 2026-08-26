export type CalendarDatePart = 'year' | 'month' | 'day';

export type CalendarDateParts = {
  year: number;
  month: number;
  day: number;
};

export function parseCalendarDateParts(value: string): CalendarDateParts {
  const [year, month, day] = value.split('-').map(Number);
  return { year, month, day };
}

export function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export function updateCalendarDatePart(
  value: string,
  part: CalendarDatePart,
  nextValue: number,
): string {
  const current = parseCalendarDateParts(value);
  const year = part === 'year' ? nextValue : current.year;
  const month = part === 'month' ? nextValue : current.month;
  const requestedDay = part === 'day' ? nextValue : current.day;
  const day = Math.min(requestedDay, getDaysInMonth(year, month));

  return formatCalendarDateParts({ year, month, day });
}

export function formatCalendarDateParts({
  year,
  month,
  day,
}: CalendarDateParts): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function createNumberOptions(start: number, end: number): number[] {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
