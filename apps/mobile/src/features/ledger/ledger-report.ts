export type LedgerReportEntry = {
  amount: number;
  category: string;
  timestamp: Date;
  type: 'expense' | 'income';
};

/** 兼容旧 AI 记录中的中文收支值，避免漏算已保存的账单。 */
export function ledgerDirection(value: string | null | undefined): 'expense' | 'income' {
  return value?.trim().toLowerCase() === 'income' || value?.trim() === '收入' ? 'income' : 'expense';
}

export type LedgerCategoryReport = {
  amount: number;
  label: string;
  ratio: number;
};

export type MonthlyLedgerReport = {
  balance: number;
  categoryReport: LedgerCategoryReport[];
  expense: number;
  expenseCount: number;
  income: number;
  label: string;
  period: string;
  weeklySpend: number[];
};

/** 只根据真实 Record 生成当月统计；不填预算、环比或 AI 洞察占位。 */
export function buildMonthlyLedgerReport(
  entries: LedgerReportEntry[],
  now = new Date(),
): MonthlyLedgerReport {
  const year = now.getFullYear();
  const month = now.getMonth();
  const currentDay = now.getDate();
  const monthlyEntries = entries.filter((entry) => {
    const date = entry.timestamp;
    return date.getFullYear() === year && date.getMonth() === month && date <= now;
  });
  const expenses = monthlyEntries.filter((entry) => entry.type === 'expense');
  const income = sum(monthlyEntries.filter((entry) => entry.type === 'income'));
  const expense = sum(expenses);
  const weeklySpend = Array.from(
    { length: Math.max(1, Math.ceil(currentDay / 7)) },
    () => 0,
  );
  const categories = new Map<string, number>();

  for (const entry of expenses) {
    const week = Math.min(weeklySpend.length - 1, Math.floor((entry.timestamp.getDate() - 1) / 7));
    weeklySpend[week] += entry.amount;
    categories.set(entry.category, (categories.get(entry.category) ?? 0) + entry.amount);
  }

  const categoryReport = [...categories.entries()]
    .map(([label, amount]) => ({
      label,
      amount,
      ratio: expense > 0 ? amount / expense : 0,
    }))
    .sort((left, right) => right.amount - left.amount || left.label.localeCompare(right.label, 'zh-CN'));

  return {
    balance: income - expense,
    categoryReport,
    expense,
    expenseCount: expenses.length,
    income,
    label: `${month + 1}月月报`,
    period: `${month + 1}月1日—${month + 1}月${currentDay}日`,
    weeklySpend,
  };
}

function sum(entries: LedgerReportEntry[]): number {
  return entries.reduce((total, entry) => total + entry.amount, 0);
}
