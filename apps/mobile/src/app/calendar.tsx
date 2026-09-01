import {
  errorMessage,
  useGetCalendar,
  type CalendarDay,
  type Event,
} from '@steward/api-client';
import { useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { ModalSheet } from '@/components/ui/modal-sheet';
import { NavHeader } from '@/components/ui/nav-header';
import {
  buildCalendarMonthCells,
  buildCalendarWeekCells,
  calendarCellPreview,
  calendarMonthRange,
  calendarWeekRange,
  dateKeyForSelectedMonth,
  formatCalendarCellTitle,
  formatCalendarDayTitle,
  formatCalendarMonthTitle,
  formatCalendarWeekTitle,
  monthAnchorFromDateKey,
  shiftCalendarDateKey,
  startOfCalendarMonth,
} from '@/features/calendar/calendar-month';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';
import { formatClock, formatDateParam } from '@/utils/format';

const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const months = Array.from({ length: 12 }, (_, index) => index);

type MonthEntry = {
  id: string;
  title: string;
  kind: 'task' | 'event' | 'important';
};

type CalendarView = 'month' | 'week';

export default function CalendarScreen() {
  const router = useRouter();
  const { height } = useWindowDimensions();
  const [monthAnchor, setMonthAnchor] = useState(() => startOfCalendarMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState(() => formatDateParam(new Date()));
  const [calendarView, setCalendarView] = useState<CalendarView>('month');
  const [monthPickerVisible, setMonthPickerVisible] = useState(false);
  const [agendaVisible, setAgendaVisible] = useState(false);
  const [pickerYear, setPickerYear] = useState(() => new Date().getFullYear());

  const range = useMemo(
    () => calendarView === 'month' ? calendarMonthRange(monthAnchor) : calendarWeekRange(selectedDate),
    [calendarView, monthAnchor, selectedDate],
  );
  const calendar = useGetCalendar({ from: range.from, to: range.to });
  const daysByDate = useMemo(() => {
    const map = new Map<string, CalendarDay>();
    for (const day of calendar.data?.data.days ?? []) map.set(day.date, day);
    return map;
  }, [calendar.data]);
  const cells = useMemo(() => buildCalendarMonthCells(monthAnchor), [monthAnchor]);
  const weekCells = useMemo(() => buildCalendarWeekCells(selectedDate), [selectedDate]);
  const selected = daysByDate.get(selectedDate);
  const todayKey = formatDateParam(new Date());
  const cellHeight = Math.min(94, Math.max(68, Math.floor((height - 228) / 6)));

  const openMonthPicker = () => {
    setPickerYear(monthAnchor.getFullYear());
    setMonthPickerVisible(true);
  };

  const chooseMonth = (year: number, month: number) => {
    const next = new Date(year, month, 1);
    setMonthAnchor(next);
    setSelectedDate(dateKeyForSelectedMonth(next, new Date()));
    setMonthPickerVisible(false);
  };

  const openAgenda = (date: string, muted: boolean) => {
    setSelectedDate(date);
    if (muted) setMonthAnchor(monthAnchorFromDateKey(date));
    setAgendaVisible(true);
  };

  const changeCalendarView = (next: CalendarView) => {
    if (next === 'month') setMonthAnchor(monthAnchorFromDateKey(selectedDate));
    setCalendarView(next);
  };

  const selectWeekDate = (date: string) => {
    setSelectedDate(date);
    setMonthAnchor(monthAnchorFromDateKey(date));
  };

  const shiftWeek = (weeks: number) => {
    selectWeekDate(shiftCalendarDateKey(selectedDate, weeks * 7));
  };

  return (
    <AppScreen includeBottomInset>
      <NavHeader
        right={(
          <Pressable
            accessibilityLabel={`选择月份，当前 ${monthAnchor.getFullYear()} 年 ${monthAnchor.getMonth() + 1} 月`}
            accessibilityRole="button"
            onPress={openMonthPicker}
            style={({ pressed }) => [styles.monthButton, pressed && styles.pressed]}
          >
            <Text style={styles.monthButtonText}>{formatCalendarMonthTitle(monthAnchor)}</Text>
            <AppIcon color={colors.textSecondary} name="chevron-down" size={15} />
          </Pressable>
        )}
        title="日历"
      />

      <CalendarViewSwitch value={calendarView} onChange={changeCalendarView} />

      <View style={styles.calendarBody}>
        {calendarView === 'month' ? (
          <>
            <View style={styles.weekRow}>
              {weekDays.map((label) => (
                <Text key={label} style={styles.weekLabel}>{label}</Text>
              ))}
            </View>

            <View style={styles.grid}>
              {cells.map((cell) => {
                const entries = monthEntries(daysByDate.get(cell.date));
                const primaryEntry = calendarCellPreview(entries);
                const isSelected = cell.date === selectedDate;
                const isToday = cell.date === todayKey;
                return (
                  <Pressable
                    accessibilityLabel={calendarCellLabel(cell.date, entries)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    key={cell.date}
                    onPress={() => openAgenda(cell.date, cell.muted)}
                    style={({ pressed }) => [
                      styles.cell,
                      { height: cellHeight },
                      cell.muted && styles.cellMuted,
                      isSelected && !isToday && styles.cellSelected,
                      pressed && styles.cellPressed,
                    ]}
                  >
                    <View style={styles.dateRow}>
                      <View style={[styles.dateCircle, isToday && styles.dateToday]}>
                        <Text
                          style={[
                            styles.dateText,
                            cell.muted && styles.dateTextMuted,
                            isToday && styles.dateTextToday,
                          ]}
                        >
                          {cell.day}
                        </Text>
                      </View>
                    </View>

                    {primaryEntry ? (
                      <View style={[styles.entryPreview, entryStyle(primaryEntry.kind).surface]}>
                        <Text
                          ellipsizeMode="clip"
                          numberOfLines={1}
                          style={[styles.entryPreviewText, entryStyle(primaryEntry.kind).text]}
                        >
                          {formatCalendarCellTitle(primaryEntry.title)}
                        </Text>
                      </View>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : (
          <WeekCalendar
            cells={weekCells}
            daysByDate={daysByDate}
            onSelectDate={selectWeekDate}
            onShiftWeek={shiftWeek}
            onOpenTask={(id) => router.push({ pathname: '/tasks/[id]', params: { id } })}
            selectedDate={selectedDate}
            todayKey={todayKey}
          />
        )}

        {calendar.isPending && !calendar.data ? (
          <View accessibilityLabel="正在加载日历" style={styles.loadingOverlay}>
            <ActivityIndicator color={colors.primary} size="small" />
          </View>
        ) : null}

        {calendar.isError ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => void calendar.refetch()}
            style={({ pressed }) => [styles.errorBar, pressed && styles.pressed]}
          >
            <Text numberOfLines={1} style={styles.errorText}>
              {errorMessage(calendar.error, '日历加载失败')}
            </Text>
            <Text style={styles.retryText}>重试</Text>
          </Pressable>
        ) : null}
      </View>

      <Modal animationType="fade" onRequestClose={() => setAgendaVisible(false)} transparent visible={agendaVisible}>
        <ModalSheet maxHeight="68%" minHeight={250} onClose={() => setAgendaVisible(false)}>
          <AgendaSheet
            day={selected}
            date={selectedDate}
            onClose={() => setAgendaVisible(false)}
            onOpenTask={(id) => {
              setAgendaVisible(false);
              router.push({ pathname: '/tasks/[id]', params: { id } });
            }}
          />
        </ModalSheet>
      </Modal>

      <Modal animationType="fade" onRequestClose={() => setMonthPickerVisible(false)} transparent visible={monthPickerVisible}>
        <ModalSheet maxHeight="64%" onClose={() => setMonthPickerVisible(false)}>
          <View style={styles.pickerHeader}>
            <Text accessibilityRole="header" style={styles.pickerTitle}>选择月份</Text>
            <Pressable
              accessibilityLabel="关闭月份选择"
              accessibilityRole="button"
              onPress={() => setMonthPickerVisible(false)}
              style={styles.pickerClose}
            >
              <AppIcon name="close" size={22} />
            </Pressable>
          </View>

          <View style={styles.yearBar}>
            <Pressable accessibilityLabel="上一年" accessibilityRole="button" onPress={() => setPickerYear((year) => year - 1)} style={styles.yearButton}>
              <AppIcon name="chevron-back" size={20} />
            </Pressable>
            <Text style={styles.yearText}>{pickerYear} 年</Text>
            <Pressable accessibilityLabel="下一年" accessibilityRole="button" onPress={() => setPickerYear((year) => year + 1)} style={styles.yearButton}>
              <AppIcon name="chevron-forward" size={20} />
            </Pressable>
          </View>

          <View style={styles.monthGrid}>
            {months.map((month) => {
              const selectedMonth = pickerYear === monthAnchor.getFullYear() && month === monthAnchor.getMonth();
              return (
                <Pressable
                  accessibilityLabel={`${pickerYear} 年 ${month + 1} 月`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: selectedMonth }}
                  key={month}
                  onPress={() => chooseMonth(pickerYear, month)}
                  style={({ pressed }) => [styles.monthOption, selectedMonth && styles.monthOptionSelected, pressed && styles.pressed]}
                >
                  <Text style={[styles.monthOptionText, selectedMonth && styles.monthOptionTextSelected]}>{month + 1}月</Text>
                </Pressable>
              );
            })}
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={() => chooseMonth(new Date().getFullYear(), new Date().getMonth())}
            style={({ pressed }) => [styles.todayButton, pressed && styles.pressed]}
          >
            <Text style={styles.todayButtonText}>回到本月</Text>
          </Pressable>
        </ModalSheet>
      </Modal>
    </AppScreen>
  );
}

function CalendarViewSwitch({ value, onChange }: { value: CalendarView; onChange: (value: CalendarView) => void }) {
  const options: { label: string; value: CalendarView }[] = [
    { label: '月历', value: 'month' },
    { label: '周历', value: 'week' },
  ];

  return (
    <View style={styles.viewControlWrap}>
      <View accessibilityRole="tablist" style={styles.viewControl}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              key={option.value}
              onPress={() => onChange(option.value)}
              style={({ pressed }) => [
                styles.viewOption,
                selected && styles.viewOptionSelected,
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.viewOptionText, selected && styles.viewOptionTextSelected]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function AgendaSheet({
  day,
  date,
  onClose,
  onOpenTask,
}: {
  day?: CalendarDay;
  date: string;
  onClose: () => void;
  onOpenTask: (id: string) => void;
}) {
  const count = (day?.events.length ?? 0) + (day?.tasks.length ?? 0);
  return (
    <View style={styles.agendaSheet}>
      <View style={styles.agendaHeader}>
        <View style={styles.agendaHeading}>
          <Text accessibilityRole="header" style={styles.agendaDate}>{formatCalendarDayTitle(date)}</Text>
          <View style={styles.countPill}>
            <Text style={styles.countText}>{count} 项</Text>
          </View>
        </View>
        <Pressable accessibilityLabel="关闭当天安排" accessibilityRole="button" onPress={onClose} style={styles.pickerClose}>
          <AppIcon name="close" size={22} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.agendaContent} showsVerticalScrollIndicator={false}>
        {count === 0 ? (
          <View style={styles.emptyAgenda}>
            <View style={styles.emptyIcon}>
              <AppIcon color={colors.primaryStrong} name="calendar-outline" size={22} />
            </View>
            <Text style={styles.emptyTitle}>这一天还没有安排</Text>
          </View>
        ) : (
          <AgendaRows day={day} onOpenTask={onOpenTask} />
        )}
      </ScrollView>
    </View>
  );
}

function WeekCalendar({
  cells,
  daysByDate,
  selectedDate,
  todayKey,
  onSelectDate,
  onShiftWeek,
  onOpenTask,
}: {
  cells: { date: string; day: number }[];
  daysByDate: Map<string, CalendarDay>;
  selectedDate: string;
  todayKey: string;
  onSelectDate: (date: string) => void;
  onShiftWeek: (weeks: number) => void;
  onOpenTask: (id: string) => void;
}) {
  const swipeStartX = useRef<number | null>(null);
  const selectedDay = daysByDate.get(selectedDate);
  const count = (selectedDay?.events.length ?? 0) + (selectedDay?.tasks.length ?? 0);

  const finishSwipe = (pageX: number) => {
    if (swipeStartX.current === null) return;
    const distance = pageX - swipeStartX.current;
    swipeStartX.current = null;
    if (Math.abs(distance) < 48) return;
    onShiftWeek(distance > 0 ? -1 : 1);
  };

  return (
    <View style={styles.weekCalendar}>
      <View style={styles.weekNavigation}>
        <Pressable
          accessibilityLabel="上一周"
          accessibilityRole="button"
          onPress={() => onShiftWeek(-1)}
          style={({ pressed }) => [styles.weekArrow, pressed && styles.pressed]}
        >
          <AppIcon color={colors.textSecondary} name="chevron-back" size={20} />
        </Pressable>
        <Text accessibilityRole="header" style={styles.weekRangeTitle}>
          {formatCalendarWeekTitle(selectedDate)}
        </Text>
        <Pressable
          accessibilityLabel="下一周"
          accessibilityRole="button"
          onPress={() => onShiftWeek(1)}
          style={({ pressed }) => [styles.weekArrow, pressed && styles.pressed]}
        >
          <AppIcon color={colors.textSecondary} name="chevron-forward" size={20} />
        </Pressable>
      </View>

      <View
        accessibilityLabel="周日期，左右滑动切换周"
        onTouchCancel={() => { swipeStartX.current = null; }}
        onTouchEnd={(event) => finishSwipe(event.nativeEvent.pageX)}
        onTouchStart={(event) => { swipeStartX.current = event.nativeEvent.pageX; }}
        style={styles.weekStrip}
      >
        {cells.map((cell, index) => {
          const day = daysByDate.get(cell.date);
          const dayCount = (day?.events.length ?? 0) + (day?.tasks.length ?? 0);
          const selected = cell.date === selectedDate;
          const today = cell.date === todayKey;
          return (
            <Pressable
              accessibilityLabel={`${cell.date}，${dayCount} 项安排`}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              key={cell.date}
              onPress={() => onSelectDate(cell.date)}
              style={({ pressed }) => [styles.weekDay, pressed && styles.weekDayPressed]}
            >
              <Text style={[styles.weekDayLabel, selected && styles.weekDayLabelSelected]}>
                {weekDays[index]}
              </Text>
              <View
                style={[
                  styles.weekDateCircle,
                  today && !selected && styles.weekDateToday,
                  selected && styles.weekDateSelected,
                ]}
              >
                <Text style={[styles.weekDateText, selected && styles.weekDateTextSelected]}>
                  {cell.day}
                </Text>
              </View>
              <Text style={[styles.weekDayCount, selected && styles.weekDayCountSelected]}>
                {dayCount > 0 ? `${dayCount}项` : ' '}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.weekAgendaHeader}>
        <Text accessibilityRole="header" style={styles.weekAgendaDate}>
          {formatCalendarDayTitle(selectedDate)}
        </Text>
        <Text style={styles.weekAgendaCount}>{count} 项</Text>
      </View>

      <ScrollView contentContainerStyle={styles.weekAgendaContent} showsVerticalScrollIndicator={false}>
        {count === 0 ? (
          <View style={styles.weekAgendaEmpty}>
            <View style={styles.emptyIcon}>
              <AppIcon color={colors.primaryStrong} name="calendar-outline" size={22} />
            </View>
            <Text style={styles.emptyTitle}>这一天还没有安排</Text>
            <Text style={styles.emptyHint}>可以选择本周其他日期查看</Text>
          </View>
        ) : (
          <AgendaRows day={selectedDay} onOpenTask={onOpenTask} />
        )}
      </ScrollView>
    </View>
  );
}

function AgendaRows({ day, onOpenTask }: { day?: CalendarDay; onOpenTask: (id: string) => void }) {
  return (
    <>
      {day?.events.map((event) => <EventAgendaRow event={event} key={event.id} />)}
      {day?.tasks.map((task) => (
        <Pressable key={task.id} onPress={() => onOpenTask(task.id)} style={({ pressed }) => [styles.agendaRow, pressed && styles.pressed]}>
          <View style={[styles.agendaIcon, styles.taskIcon]}>
            <AppIcon color={colors.primaryStrong} name="checkmark" size={17} />
          </View>
          <View style={styles.agendaCopy}>
            <Text style={styles.agendaTitle}>{task.title}</Text>
            <Text style={styles.agendaMeta}>{task.due_at ? `${formatClock(new Date(task.due_at))} 截止` : '待办'}</Text>
          </View>
          <AppIcon color={colors.textTertiary} name="chevron-forward" size={17} />
        </Pressable>
      ))}
    </>
  );
}

function EventAgendaRow({ event }: { event: Event }) {
  const important = event.event_kind === 'important_date';
  return (
    <View style={styles.agendaRow}>
      <View style={[styles.agendaIcon, important ? styles.importantIcon : styles.eventIcon]}>
        <AppIcon color={important ? '#B4234D' : '#4258B5'} name={important ? 'gift-outline' : 'calendar-outline'} size={17} />
      </View>
      <View style={styles.agendaCopy}>
        <Text style={styles.agendaTitle}>{event.title}</Text>
        <Text style={styles.agendaMeta}>
          {important
            ? event.important_date_handled_at ? '重要日 · 已处理' : '重要日'
            : event.all_day ? '全天' : event.start_at ? formatClock(new Date(event.start_at)) : '日程'}
          {event.location ? ` · ${event.location}` : ''}
        </Text>
      </View>
    </View>
  );
}

function monthEntries(day?: CalendarDay): MonthEntry[] {
  if (!day) return [];
  return [
    ...day.events.map((event) => ({
      id: event.id,
      title: event.title,
      kind: event.event_kind === 'important_date' ? 'important' as const : 'event' as const,
    })),
    ...day.tasks.map((task) => ({ id: task.id, title: task.title, kind: 'task' as const })),
  ];
}

function entryStyle(kind: MonthEntry['kind']) {
  if (kind === 'important') return { surface: styles.entryImportant, text: styles.entryImportantText };
  if (kind === 'event') return { surface: styles.entryEvent, text: styles.entryEventText };
  return { surface: styles.entryTask, text: styles.entryTaskText };
}

function calendarCellLabel(date: string, entries: MonthEntry[]) {
  if (entries.length === 0) return `${date}，没有安排`;
  return `${date}，${entries.length} 项安排：${entries.map((entry) => entry.title).join('，')}`;
}

const styles = StyleSheet.create({
  calendarBody: { flex: 1 },
  monthButton: {
    width: 116,
    minHeight: 44,
    paddingLeft: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 3,
  },
  monthButtonText: { color: colors.text, fontFamily, fontSize: 14, lineHeight: 20, fontWeight: '600' },
  viewControlWrap: {
    minHeight: 50,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  viewControl: {
    width: 176,
    minHeight: 40,
    padding: 3,
    flexDirection: 'row',
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  viewOption: {
    minHeight: 34,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  viewOptionSelected: { backgroundColor: colors.background },
  viewOptionText: { color: colors.textSecondary, fontFamily, ...typography.label },
  viewOptionTextSelected: { color: colors.primaryStrong, fontWeight: '600' },
  weekRow: {
    height: 36,
    paddingHorizontal: 5,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  weekLabel: {
    flex: 1,
    color: colors.textSecondary,
    fontFamily,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  grid: { paddingHorizontal: 5, flexDirection: 'row', flexWrap: 'wrap' },
  cell: {
    width: `${100 / 7}%`,
    paddingTop: 4,
    paddingHorizontal: 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  cellMuted: { opacity: 0.42 },
  cellSelected: { backgroundColor: colors.surfaceSubtle },
  cellPressed: { backgroundColor: colors.surfaceSubtle },
  dateRow: { height: 27, alignItems: 'center', justifyContent: 'flex-start' },
  dateCircle: { minWidth: 26, height: 26, paddingHorizontal: 3, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  dateToday: { backgroundColor: colors.primary },
  dateText: { color: colors.text, fontFamily, fontSize: 14, lineHeight: 19, fontWeight: '600' },
  dateTextMuted: { color: colors.textSecondary },
  dateTextToday: { color: colors.background },
  entryPreview: {
    minHeight: 30,
    marginTop: 3,
    paddingHorizontal: 3,
    paddingVertical: 2,
    borderRadius: 4,
    justifyContent: 'center',
  },
  entryPreviewText: { fontFamily, fontSize: 11, lineHeight: 13.5, fontWeight: '600' },
  entryTask: { backgroundColor: '#E6F5ED' },
  entryTaskText: { color: '#176E52' },
  entryEvent: { backgroundColor: '#EDF0FF' },
  entryEventText: { color: '#4258B5' },
  entryImportant: { backgroundColor: '#FFF0F4' },
  entryImportantText: { color: '#B4234D' },
  loadingOverlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.62)' },
  errorBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 12,
    minHeight: 42,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
  },
  errorText: { flex: 1, color: colors.textSecondary, fontFamily, ...typography.meta },
  retryText: { color: colors.primaryStrong, fontFamily, ...typography.label },
  pressed: { opacity: 0.66 },
  agendaSheet: { minHeight: 250 },
  agendaHeader: { minHeight: 64, paddingLeft: 20, paddingRight: 10, flexDirection: 'row', alignItems: 'center' },
  agendaHeading: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 9 },
  agendaDate: { color: colors.text, fontFamily, ...typography.section },
  countPill: { minHeight: 27, paddingHorizontal: 10, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft },
  countText: { color: colors.primaryStrong, fontFamily, ...typography.meta, fontWeight: '600' },
  agendaContent: { paddingHorizontal: 20, paddingBottom: 24 },
  agendaRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  agendaIcon: { width: 34, height: 34, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  taskIcon: { backgroundColor: '#E6F5ED' },
  eventIcon: { backgroundColor: '#EDF0FF' },
  importantIcon: { backgroundColor: '#FFF0F4' },
  agendaCopy: { flex: 1 },
  agendaTitle: { color: colors.text, fontFamily, ...typography.bodyStrong },
  agendaMeta: { marginTop: 2, color: colors.textSecondary, fontFamily, ...typography.meta },
  weekCalendar: { flex: 1 },
  weekNavigation: {
    minHeight: 48,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  weekArrow: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  weekRangeTitle: {
    flex: 1,
    color: colors.text,
    fontFamily,
    ...typography.label,
    fontWeight: '600',
    textAlign: 'center',
  },
  weekStrip: {
    minHeight: 86,
    paddingHorizontal: 8,
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderStrong,
  },
  weekDay: {
    minHeight: 85,
    flex: 1,
    paddingVertical: 7,
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: radius.sm,
  },
  weekDayPressed: { backgroundColor: colors.surfaceSubtle },
  weekDayLabel: { color: colors.textSecondary, fontFamily, fontSize: 11, lineHeight: 16, fontWeight: '500' },
  weekDayLabelSelected: { color: colors.primaryStrong, fontWeight: '600' },
  weekDateCircle: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  weekDateToday: { borderWidth: 1, borderColor: colors.primary },
  weekDateSelected: { backgroundColor: colors.primary },
  weekDateText: { color: colors.text, fontFamily, fontSize: 15, lineHeight: 21, fontWeight: '600' },
  weekDateTextSelected: { color: colors.background },
  weekDayCount: { color: colors.textTertiary, fontFamily, fontSize: 10, lineHeight: 14, fontWeight: '500' },
  weekDayCountSelected: { color: colors.primaryStrong, fontWeight: '600' },
  weekAgendaHeader: {
    minHeight: 56,
    marginHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderStrong,
  },
  weekAgendaDate: { flex: 1, color: colors.text, fontFamily, ...typography.section },
  weekAgendaCount: { color: colors.textSecondary, fontFamily, ...typography.meta },
  weekAgendaContent: { flexGrow: 1, paddingHorizontal: 20, paddingBottom: 24 },
  weekAgendaEmpty: { flex: 1, minHeight: 260, alignItems: 'center', justifyContent: 'center' },
  emptyAgenda: { minHeight: 168, alignItems: 'center', justifyContent: 'center' },
  emptyIcon: { width: 46, height: 46, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft },
  emptyTitle: { marginTop: 12, color: colors.textSecondary, fontFamily, ...typography.body },
  emptyHint: { marginTop: 4, color: colors.textSecondary, fontFamily, ...typography.meta, textAlign: 'center' },
  pickerHeader: { minHeight: 58, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center' },
  pickerTitle: { flex: 1, color: colors.text, fontFamily, ...typography.section },
  pickerClose: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  yearBar: { height: 48, marginHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  yearButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  yearText: { color: colors.text, fontFamily, ...typography.bodyStrong },
  monthGrid: { paddingHorizontal: 20, flexDirection: 'row', flexWrap: 'wrap' },
  monthOption: { width: '25%', height: 48, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  monthOptionSelected: { backgroundColor: colors.primarySoft },
  monthOptionText: { color: colors.textSecondary, fontFamily, ...typography.label },
  monthOptionTextSelected: { color: colors.primaryStrong, fontWeight: '600' },
  todayButton: {
    height: 48,
    marginHorizontal: 20,
    marginTop: 8,
    marginBottom: 20,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  todayButtonText: { color: colors.primaryStrong, fontFamily, ...typography.label },
});
