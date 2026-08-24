export type ImportantDatePart = 'year' | 'month' | 'day';

export type ImportantDateParts = {
  year: number;
  month: number;
  day: number;
};

export function parseImportantDateParts(value: string): ImportantDateParts {
  const [year, month, day] = value.split('-').map(Number);
  return { year, month, day };
}

export function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export function updateImportantDatePart(
  value: string,
  part: ImportantDatePart,
  nextValue: number,
): string {
  const current = parseImportantDateParts(value);
  const year = part === 'year' ? nextValue : current.year;
  const month = part === 'month' ? nextValue : current.month;
  const requestedDay = part === 'day' ? nextValue : current.day;
  const day = Math.min(requestedDay, getDaysInMonth(year, month));

  return formatImportantDateParts({ year, month, day });
}

export function formatImportantDateParts({
  year,
  month,
  day,
}: ImportantDateParts): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function createImportantDateYearOptions(currentYear = new Date().getFullYear()): number[] {
  const startYear = 1900;
  const endYear = currentYear + 100;
  return Array.from({ length: endYear - startYear + 1 }, (_, index) => startYear + index);
}

export function createNumberOptions(start: number, end: number): number[] {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
