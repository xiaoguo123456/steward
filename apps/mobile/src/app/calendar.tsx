import { errorMessage, useGetCalendar, type CalendarDay } from '@steward/api-client';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AiFab } from '@/components/ui/ai-fab';
import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { NavHeader } from '@/components/ui/nav-header';
import { SectionTitle } from '@/components/ui/section-title';
import { StatePanel } from '@/components/ui/state-panel';
import { formatClock, formatDateParam } from '@/utils/format';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';

const weekDays = ['日', '一', '二', '三', '四', '五', '六'];

export default function CalendarScreen() {
  const router = useRouter();
  const [monthAnchor, setMonthAnchor] = useState(() => startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState(() => formatDateParam(new Date()));

  // 一次拉取整月，覆盖前后补齐的空格日期。
  const range = useMemo(() => monthRange(monthAnchor), [monthAnchor]);
  const calendar = useGetCalendar({ from: range.from, to: range.to });

  const daysByDate = useMemo(() => {
    const map = new Map<string, CalendarDay>();
    for (const day of calendar.data?.data.days ?? []) {
      map.set(day.date, day);
    }
    return map;
  }, [calendar.data]);

  const cells = useMemo(() => buildCells(monthAnchor), [monthAnchor]);
  const selected = daysByDate.get(selectedDate);
  const todayKey = formatDateParam(new Date());

  return (
    <AppScreen includeBottomInset>
      <NavHeader title="日历" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.monthBar}>
          <Pressable
            accessibilityLabel="上个月"
            accessibilityRole="button"
            hitSlop={10}
            onPress={() => setMonthAnchor(addMonths(monthAnchor, -1))}
          >
            <AppIcon color={colors.textSecondary} name="chevron-back" size={20} />
          </Pressable>
          <Text style={styles.monthLabel}>
            {monthAnchor.getFullYear()} 年 {monthAnchor.getMonth() + 1} 月
          </Text>
          <Pressable
            accessibilityLabel="下个月"
            accessibilityRole="button"
            hitSlop={10}
            onPress={() => setMonthAnchor(addMonths(monthAnchor, 1))}
          >
            <AppIcon color={colors.textSecondary} name="chevron-forward" size={20} />
          </Pressable>
        </View>

        <View style={styles.weekRow}>
          {weekDays.map((label) => (
            <Text key={label} style={styles.weekLabel}>
              {label}
            </Text>
          ))}
        </View>

        {calendar.isPending ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : calendar.isError ? (
          <StatePanel
            actionLabel="重试"
            icon="cloud-offline-outline"
            message={errorMessage(calendar.error, '暂时无法加载日历。')}
            onAction={() => void calendar.refetch()}
            title="加载失败"
          />
        ) : (
          <View style={styles.grid}>
            {cells.map((cell) => {
              const day = daysByDate.get(cell.date);
              const hasContent = (day?.events.length ?? 0) + (day?.tasks.length ?? 0) > 0;
              const isSelected = cell.date === selectedDate;
              const isToday = cell.date === todayKey;
              return (
                <Pressable
                  accessibilityLabel={`${cell.date}${hasContent ? '，有安排' : ''}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  key={cell.date}
                  onPress={() => setSelectedDate(cell.date)}
                  style={styles.cell}
                >
                  <View
                    style={[
                      styles.cellInner,
                      isToday && styles.cellToday,
                      isSelected && styles.cellSelected,
                    ]}
                  >
                    <Text
                      style={[
                        styles.cellText,
                        cell.muted && styles.cellTextMuted,
                        isSelected && styles.cellTextSelected,
                      ]}
                    >
                      {cell.day}
                    </Text>
                  </View>
                  <View style={[styles.dot, hasContent && styles.dotActive]} />
                </Pressable>
              );
            })}
          </View>
        )}

        <SectionTitle
          count={
            selected ? `${selected.events.length + selected.tasks.length} 项` : undefined
          }
          style={styles.sectionTitle}
          title={`${Number(selectedDate.slice(5, 7))}月${Number(selectedDate.slice(8, 10))}日安排`}
        />

        {!selected || selected.events.length + selected.tasks.length === 0 ? (
          <Text style={styles.empty}>这一天还没有安排。</Text>
        ) : (
          <>
            {selected.events.map((event) => (
              <View key={event.id} style={styles.agendaRow}>
                <View style={[styles.agendaBar, { backgroundColor: colors.blue }]} />
                <View style={styles.agendaCopy}>
                  <Text style={styles.agendaTitle}>{event.title}</Text>
                  <Text style={styles.agendaMeta}>
                    {event.all_day
                      ? '全天'
                      : event.start_at
                        ? formatClock(new Date(event.start_at))
                        : ''}
                    {event.location ? ` · ${event.location}` : ''}
                  </Text>
                </View>
              </View>
            ))}
            {selected.tasks.map((task) => (
              <Pressable
                key={task.id}
                onPress={() => router.push({ pathname: '/tasks/[id]', params: { id: task.id } })}
                style={({ pressed }) => [styles.agendaRow, pressed && styles.pressed]}
              >
                <View style={[styles.agendaBar, { backgroundColor: colors.primary }]} />
                <View style={styles.agendaCopy}>
                  <Text style={styles.agendaTitle}>{task.title}</Text>
                  <Text style={styles.agendaMeta}>
                    {task.due_at ? `${formatClock(new Date(task.due_at))} 截止` : '当日截止'}
                  </Text>
                </View>
              </Pressable>
            ))}
          </>
        )}
      </ScrollView>
      <AiFab />
    </AppScreen>
  );
}

type Cell = { date: string; day: number; muted: boolean };

/** 生成 6×7 的月视图格子，前后用相邻月份补齐。 */
function buildCells(anchor: Date): Cell[] {
  const first = startOfMonth(anchor);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());

  const cells: Cell[] = [];
  for (let i = 0; i < 42; i += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    cells.push({
      date: formatDateParam(date),
      day: date.getDate(),
      muted: date.getMonth() !== anchor.getMonth(),
    });
  }
  return cells;
}

function monthRange(anchor: Date): { from: string; to: string } {
  const cells = buildCells(anchor);
  return { from: cells[0].date, to: cells[cells.length - 1].date };
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingBottom: 96,
  },
  monthBar: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  monthLabel: {
    color: colors.text,
    fontFamily,
    ...typography.section,
  },
  weekRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  weekLabel: {
    flex: 1,
    color: colors.textTertiary,
    fontFamily,
    fontSize: 12,
    textAlign: 'center',
  },
  loading: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  cell: {
    width: `${100 / 7}%`,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellInner: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  cellToday: {
    backgroundColor: colors.primarySoft,
  },
  cellSelected: {
    backgroundColor: colors.primary,
  },
  cellText: {
    color: colors.text,
    fontFamily,
    fontSize: 14,
  },
  cellTextMuted: {
    color: colors.textTertiary,
  },
  cellTextSelected: {
    color: colors.background,
    fontWeight: '600',
  },
  dot: {
    width: 4,
    height: 4,
    marginTop: 2,
    borderRadius: 2,
    backgroundColor: 'transparent',
  },
  dotActive: {
    backgroundColor: colors.primary,
  },
  sectionTitle: {
    marginTop: 8,
  },
  empty: {
    paddingVertical: 20,
    color: colors.textSecondary,
    fontFamily,
    ...typography.body,
    textAlign: 'center',
  },
  agendaRow: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  pressed: {
    opacity: 0.65,
  },
  agendaBar: {
    width: 3,
    height: 34,
    borderRadius: 2,
  },
  agendaCopy: {
    flex: 1,
  },
  agendaTitle: {
    color: colors.text,
    fontFamily,
    ...typography.bodyStrong,
  },
  agendaMeta: {
    marginTop: 2,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
});
