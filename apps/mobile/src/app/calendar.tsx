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
  PanResponder,
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
import {
  buildWeekTimeline,
  buildWeekTimelineBlocks,
  type WeekAllDayItem,
  type WeekSpanningItem,
  type WeekTimeline,
  type WeekTimelineItem,
} from '@/features/calendar/calendar-week-timeline';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';
import { formatMinuteClock, formatMinuteDateTime, zonedDateTimeParts } from '@/utils/date-time';
import { formatDateParam } from '@/utils/format';

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
  const { height, width } = useWindowDimensions();
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
  const timezone = calendar.data?.data.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
  const weekTimeline = useMemo(() => buildWeekTimeline(weekCells, daysByDate, timezone), [weekCells, daysByDate, timezone]);
  const selected = calendarView === 'week' ? weekTimeline.agendaByDate.get(selectedDate) : daysByDate.get(selectedDate);
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
            timeline={weekTimeline}
            onSelectDate={(date) => { selectWeekDate(date); setAgendaVisible(true); }}
            onShiftWeek={shiftWeek}
            onOpenEvent={(id) => router.push({ pathname: '/events/[id]' as never, params: { id } })}
            onOpenTask={(id) => router.push({ pathname: '/tasks/[id]', params: { id } })}
            selectedDate={selectedDate}
            todayKey={todayKey}
            timezone={timezone}
            viewportWidth={width}
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
            onOpenEvent={(id) => {
              setAgendaVisible(false);
              router.push({ pathname: '/events/[id]' as never, params: { id } });
            }}
            onOpenTask={(id) => {
              setAgendaVisible(false);
              router.push({ pathname: '/tasks/[id]', params: { id } });
            }}
            timezone={calendar.data?.data.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC'}
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
  onOpenEvent,
  onOpenTask,
  timezone,
}: {
  day?: CalendarDay;
  date: string;
  onClose: () => void;
  onOpenEvent: (id: string) => void;
  onOpenTask: (id: string) => void;
  timezone: string;
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
          <AgendaRows day={day} onOpenEvent={onOpenEvent} onOpenTask={onOpenTask} timezone={timezone} />
        )}
      </ScrollView>
    </View>
  );
}

function WeekCalendar({
  cells,
  timeline,
  selectedDate,
  todayKey,
  timezone,
  viewportWidth,
  onSelectDate,
  onShiftWeek,
  onOpenEvent,
  onOpenTask,
}: {
  cells: { date: string; day: number }[];
  timeline: WeekTimeline;
  selectedDate: string;
  todayKey: string;
  timezone: string;
  viewportWidth: number;
  onSelectDate: (date: string) => void;
  onShiftWeek: (weeks: number) => void;
  onOpenEvent: (id: string) => void;
  onOpenTask: (id: string) => void;
}) {
  const [containerWidth, setContainerWidth] = useState(viewportWidth);
  const timeGutter = 38;
  const dayWidth = Math.max(1, (containerWidth - timeGutter) / 7);
  const totalCount = timeline.timed.length + timeline.allDay.length + timeline.spanning.length;

  const swipeResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_, gesture) => {
      const horizontal = Math.abs(gesture.dx) > 16 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5;
      return horizontal;
    },
    onPanResponderRelease: (_, gesture) => {
      if (Math.abs(gesture.dx) >= 48) onShiftWeek(gesture.dx > 0 ? -1 : 1);
    },
  }), [onShiftWeek]);

  return (
    <View onLayout={event => setContainerWidth(event.nativeEvent.layout.width)} style={styles.weekCalendar}>
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
        {...swipeResponder.panHandlers}
        style={styles.weekStrip}
      >
        <View style={{ width: timeGutter }} />
        {cells.map((cell, index) => {
          const agenda = timeline.agendaByDate.get(cell.date);
          const dayCount = (agenda?.events.length ?? 0) + (agenda?.tasks.length ?? 0);
          const selected = cell.date === selectedDate;
          const today = cell.date === todayKey;
          return (
            <Pressable
              accessibilityLabel={`${cell.date}，${dayCount} 项安排`}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              key={cell.date}
              onPress={() => onSelectDate(cell.date)}
              style={({ pressed }) => [styles.weekDay, { width: dayWidth }, pressed && styles.weekDayPressed]}
            >
              <Text style={[styles.weekDayLabel, selected && styles.weekDayLabelSelected]}>
                {weekDays[index].slice(1)}
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
            </Pressable>
          );
        })}
      </View>

      <WeekAllDayBand
        allDay={timeline.allDay}
        cells={cells}
        dayWidth={dayWidth}
        onOpenEvent={onOpenEvent}
        onOpenTask={onOpenTask}
        onOpenDay={onSelectDate}
        timeGutter={timeGutter}
      />

      <WeekSpanningBand
        key={`spanning:${cells[0]?.date}`}
        items={timeline.spanning}
        dayWidth={dayWidth}
        timeGutter={timeGutter}
        onOpenEvent={onOpenEvent}
        onOpenTask={onOpenTask}
      />

      <WeekTimeGrid
        key={`grid:${cells[0]?.date}`}
        cells={cells}
        dayWidth={dayWidth}
        initialMinute={timeline.initialMinute}
        items={timeline.timed}
        onOpenEvent={onOpenEvent}
        onOpenTask={onOpenTask}
        onOpenDay={onSelectDate}
        selectedDate={selectedDate}
        timeGutter={timeGutter}
        timezone={timezone}
        todayKey={todayKey}
        totalCount={totalCount}
      />
    </View>
  );
}

const HOUR_HEIGHT = 52;

function WeekAllDayBand({
  allDay,
  cells,
  dayWidth,
  timeGutter,
  onOpenEvent,
  onOpenTask,
  onOpenDay,
}: {
  allDay: WeekAllDayItem[];
  cells: { date: string }[];
  dayWidth: number;
  timeGutter: number;
  onOpenEvent: (id: string) => void;
  onOpenTask: (id: string) => void;
  onOpenDay: (date: string) => void;
}) {
  const dayCounts = cells.map(cell => allDay.filter(item => item.date === cell.date).length);
  const maxRows = Math.min(2, Math.max(0, ...dayCounts));
  const hasOverflow = dayCounts.some(count => count > 2);
  if (maxRows === 0) return null;

  return (
    <View
      style={[styles.allDayBand, { minHeight: 8 + maxRows * 22 + (hasOverflow ? 28 : 0) }]}
    >
      <Text style={[styles.allDayLabel, { width: timeGutter }]}>全天</Text>
      {cells.map(cell => {
        const items = allDay.filter(item => item.date === cell.date);
        return (
          <View key={cell.date} style={[styles.allDayColumn, { width: dayWidth }]}>
            {items.slice(0, 2).map(item => (
              <WeekAllDayPill
                item={item}
                key={item.instanceKey}
                onPress={() => item.type === 'task' ? onOpenTask(item.id) : onOpenEvent(item.id)}
              />
            ))}
            {items.length > 2 ? (
              <Pressable accessibilityRole="button" accessibilityLabel={`查看 ${cell.date} 全部安排`} onPress={() => onOpenDay(cell.date)} style={styles.allDayMoreButton}>
                <Text style={styles.allDayMore}>+{items.length - 2}</Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function WeekAllDayPill({ item, onPress }: { item: WeekAllDayItem; onPress: () => void }) {
  const palette = timelinePalette(item.type);
  return (
    <Pressable
      accessibilityLabel={`${item.type === 'task' ? '待办' : item.type === 'important' ? '重要日' : '全天日程'}：${item.title}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.allDayPill, { backgroundColor: palette.background }, pressed && styles.timelinePressed]}
    >
      <Text numberOfLines={1} style={[styles.allDayPillText, { color: palette.text }]}>{item.title}</Text>
    </Pressable>
  );
}

function WeekSpanningBand({ items, dayWidth, timeGutter, onOpenEvent, onOpenTask }: {
  items: WeekSpanningItem[];
  dayWidth: number;
  timeGutter: number;
  onOpenEvent: (id: string) => void;
  onOpenTask: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!items.length) return null;
  const rowCount = Math.max(...items.map(item => item.row)) + 1;
  const visibleRows = expanded ? rowCount : Math.min(2, rowCount);
  const hiddenCount = items.filter(item => item.row >= visibleRows).length;
  return (
    <View style={styles.spanningBand}>
      <ScrollView style={{ maxHeight: 160 }} nestedScrollEnabled>
        <View style={{ height: visibleRows * 36 + 8 }}>
          <Text style={[styles.allDayLabel, { width: timeGutter }]}>跨天</Text>
          {items.filter(item => item.row < visibleRows).map(item => {
            const palette = timelinePalette(item.type);
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`跨天${item.type === 'task' ? '待办' : '日程'}：${item.title}，${item.timeLabel}`}
                key={`${item.type}:${item.id}`}
                onPress={() => item.type === 'task' ? onOpenTask(item.id) : onOpenEvent(item.id)}
                style={({ pressed }) => [styles.spanningItem, {
                  left: timeGutter + item.dayIndex * dayWidth + 2,
                  top: item.row * 36 + 4,
                  width: item.daySpan * dayWidth - 4,
                  backgroundColor: palette.background,
                  borderLeftColor: palette.accent,
                }, pressed && styles.timelinePressed]}
              >
                <Text numberOfLines={1} style={[styles.spanningTitle, { color: palette.text }]}>{item.title}</Text>
                <Text numberOfLines={1} style={[styles.spanningTime, { color: palette.text }]}>{compactSpanningTime(item.timeLabel)}</Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
      {rowCount > 2 ? (
        <Pressable accessibilityRole="button" onPress={() => setExpanded(value => !value)} style={styles.spanningToggle}>
          <Text style={styles.retryText}>{expanded ? '收起跨天安排' : `展开其余 ${hiddenCount} 项跨天安排`}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function WeekTimeGrid({
  cells,
  dayWidth,
  initialMinute,
  items,
  onOpenEvent,
  onOpenTask,
  onOpenDay,
  selectedDate,
  timeGutter,
  timezone,
  todayKey,
  totalCount,
}: {
  cells: { date: string }[];
  dayWidth: number;
  initialMinute: number;
  items: WeekTimelineItem[];
  onOpenEvent: (id: string) => void;
  onOpenTask: (id: string) => void;
  onOpenDay: (date: string) => void;
  selectedDate: string;
  timeGutter: number;
  timezone: string;
  todayKey: string;
  totalCount: number;
}) {
  const gridHeight = 24 * HOUR_HEIGHT;
  const scrollRef = useRef<ScrollView>(null);
  const positioned = useRef(false);
  const blocks = useMemo(() => buildWeekTimelineBlocks(items, dayWidth), [items, dayWidth]);
  const now = zonedDateTimeParts(new Date(), timezone);
  const nowMinute = now && cells.some(cell => cell.date === now.date) ? now.hour * 60 + now.minute : null;
  const initialOffset = Math.max(0, initialMinute / 60 * HOUR_HEIGHT - 12);
  const [scrollY, setScrollY] = useState(initialOffset);
  const earlyCount = new Set(items.filter(item => item.startMinute < 8 * 60).map(item => `${item.type}:${item.id}`)).size;
  const lateCount = new Set(items.filter(item => item.endMinute > 21 * 60).map(item => `${item.type}:${item.id}`)).size;
  const earlyMinute = Math.min(8 * 60, ...items.map(item => item.startMinute));

  return (
    <View style={styles.timeGridScroll}>
      {earlyCount > 0 || lateCount > 0 ? (
        <View style={styles.timeShortcuts}>
          {earlyCount > 0 ? <Pressable accessibilityRole="button" accessibilityLabel={`查看 08:00 前的 ${earlyCount} 项安排`} onPress={() => scrollRef.current?.scrollTo({ y: Math.max(0, earlyMinute / 60 * HOUR_HEIGHT - 12), animated: true })} style={styles.timeShortcut}><Text style={styles.timeShortcutText}>早间 · {earlyCount}项 ↑</Text></Pressable> : null}
          {lateCount > 0 ? <Pressable accessibilityRole="button" accessibilityLabel={`查看 21:00 后的 ${lateCount} 项安排`} onPress={() => scrollRef.current?.scrollTo({ y: 21 * HOUR_HEIGHT, animated: true })} style={styles.timeShortcut}><Text style={styles.timeShortcutText}>夜间 · {lateCount}项 ↓</Text></Pressable> : null}
        </View>
      ) : null}
    <ScrollView
      contentOffset={{ x: 0, y: initialOffset }}
      contentContainerStyle={{ height: gridHeight }}
      onContentSizeChange={() => {
        if (positioned.current) return;
        positioned.current = true;
        scrollRef.current?.scrollTo({ y: initialOffset, animated: false });
      }}
      ref={scrollRef}
      onScroll={event => setScrollY(event.nativeEvent.contentOffset.y)}
      scrollEventThrottle={32}
      showsVerticalScrollIndicator
      style={styles.timeGridScroll}
    >
      <View style={[styles.timeGrid, { height: gridHeight }]}>
        {cells.map(cell => (
          <View
            key={cell.date}
            pointerEvents="none"
            style={[
              styles.timeDayColumn,
              { left: timeGutter + cells.findIndex(value => value.date === cell.date) * dayWidth, width: dayWidth },
              cell.date === selectedDate && styles.timeDaySelected,
              cell.date === todayKey && styles.timeDayToday,
            ]}
          />
        ))}

        {Array.from({ length: 25 }, (_, hour) => (
          <View key={hour} pointerEvents="none" style={[styles.hourRow, { top: hour * HOUR_HEIGHT }]}>
            <Text style={[styles.hourLabel, { width: timeGutter - 6 }]}>{hour < 24 ? `${String(hour).padStart(2, '0')}:00` : ''}</Text>
            <View style={styles.hourLine} />
          </View>
        ))}

        {totalCount === 0 ? (
          <View pointerEvents="none" style={[styles.weekEmpty, { left: timeGutter, top: 8 * HOUR_HEIGHT, width: dayWidth * 7 }]}>
            <Text style={styles.weekEmptyTitle}>本周还没有安排</Text>
            <Text style={styles.weekEmptyHint}>时间轴会按开始和结束时间显示日程</Text>
          </View>
        ) : null}

        {blocks.map(block => {
          const item = block.items[0];
          const grouped = block.items.length > 1;
          const palette = timelinePalette(item.type);
          const laneWidth = dayWidth / block.columnCount;
          const top = block.startMinute / 60 * HOUR_HEIGHT;
          const visualMinutes = Math.max(32, block.endMinute - block.startMinute);
          const height = Math.min(gridHeight - top, Math.max(28, visualMinutes / 60 * HOUR_HEIGHT - 2));
          const left = timeGutter + block.dayIndex * dayWidth + block.column * laneWidth + 1;
          const contentTop = Math.min(Math.max(0, height - 32), Math.max(0, scrollY - top));
          const visibleHeight = height - contentTop;
          return (
            <Pressable
              accessibilityLabel={grouped ? `${block.date}，${block.items.length} 项重叠安排，点击查看全部` : `${item.type === 'task' ? '待办' : '日程'}：${item.title}，${item.timeLabel}`}
              accessibilityRole="button"
              key={item.instanceKey}
              onPress={() => grouped ? onOpenDay(block.date) : item.type === 'task' ? onOpenTask(item.id) : onOpenEvent(item.id)}
              style={({ pressed }) => [
                styles.timelineItem,
                {
                  backgroundColor: grouped ? colors.surface : palette.background,
                  borderLeftColor: grouped ? colors.textSecondary : palette.accent,
                  height,
                  left,
                  top,
                  width: Math.max(12, laneWidth - 2),
                },
                pressed && styles.timelinePressed,
              ]}
            >
              <View style={{ marginTop: contentTop }}>
                <Text numberOfLines={visibleHeight >= 48 ? 2 : 1} style={[styles.timelineTitle, { color: grouped ? colors.text : palette.text }]}>{grouped ? `共${block.items.length}项` : item.title}</Text>
                {visibleHeight >= 64 ? <Text numberOfLines={2} style={[styles.timelineTime, { color: grouped ? colors.textSecondary : palette.text }]}>{grouped ? '点击查看' : item.timeLabel.replace('–', '\n')}</Text> : null}
              </View>
            </Pressable>
          );
        })}

        {nowMinute !== null ? (
          <View pointerEvents="none" style={[styles.nowLine, { left: timeGutter, top: nowMinute / 60 * HOUR_HEIGHT, width: dayWidth * 7 }]}>
            <View style={styles.nowDot} />
            <View style={styles.nowRule} />
          </View>
        ) : null}
      </View>
    </ScrollView>
    </View>
  );
}

function timelinePalette(type: WeekTimelineItem['type']) {
  if (type === 'important') return { background: '#FFF0F4', accent: '#D9486D', text: '#942044' };
  if (type === 'task') return { background: '#E6F5ED', accent: colors.primary, text: '#176E52' };
  return { background: '#EDF0FF', accent: '#6173C9', text: '#354899' };
}

function AgendaRows({
  day,
  onOpenEvent,
  onOpenTask,
  timezone,
}: {
  day?: CalendarDay;
  onOpenEvent: (id: string) => void;
  onOpenTask: (id: string) => void;
  timezone: string;
}) {
  return (
    <>
      {day?.events.map((event) => <EventAgendaRow event={event} key={event.id} onPress={() => onOpenEvent(event.id)} timezone={timezone} />)}
      {day?.tasks.map((task) => (
        <Pressable key={task.id} onPress={() => onOpenTask(task.id)} style={({ pressed }) => [styles.agendaRow, pressed && styles.pressed]}>
          <View style={[styles.agendaIcon, styles.taskIcon]}>
            <AppIcon color={colors.primaryStrong} name="checkmark" size={17} />
          </View>
          <View style={styles.agendaCopy}>
            <Text style={styles.agendaTitle}>{task.title}</Text>
            <Text style={styles.agendaMeta}>{task.scheduled_start_at ? `待办 · ${calendarTimeRange(task.scheduled_start_at, task.scheduled_end_at, timezone)}` : task.due_at ? `${calendarClock(task.due_at, timezone)} 截止` : '待办'}</Text>
          </View>
          <AppIcon color={colors.textTertiary} name="chevron-forward" size={17} />
        </Pressable>
      ))}
    </>
  );
}

function EventAgendaRow({ event, onPress, timezone }: { event: Event; onPress: () => void; timezone: string }) {
  const important = event.event_kind === 'important_date';
  return (
    <Pressable accessibilityLabel={`打开日程：${event.title}`} accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.agendaRow, pressed && styles.pressed]}>
      <View style={[styles.agendaIcon, important ? styles.importantIcon : styles.eventIcon]}>
        <AppIcon color={important ? '#B4234D' : '#4258B5'} name={important ? 'gift-outline' : 'calendar-outline'} size={17} />
      </View>
      <View style={styles.agendaCopy}>
        <Text style={styles.agendaTitle}>{event.title}</Text>
        <Text style={styles.agendaMeta}>
          {important
            ? event.important_date_handled_at ? '重要日 · 已处理' : '重要日'
            : event.all_day ? '全天' : event.start_at ? calendarTimeRange(event.start_at, event.end_at, timezone) : '日程'}
          {event.location ? ` · ${event.location}` : ''}
        </Text>
      </View>
      <AppIcon color={colors.textTertiary} name="chevron-forward" size={17} />
    </Pressable>
  );
}

function calendarClock(value: string, timezone: string) {
  const parts = zonedDateTimeParts(value, timezone);
  return parts ? formatMinuteClock(parts.hour * 60 + parts.minute) : '';
}

function calendarTimeRange(start: string, end: string | null | undefined, timezone: string) {
  if (!end) return calendarClock(start, timezone);
  if (zonedDateTimeParts(start, timezone)?.date === zonedDateTimeParts(end, timezone)?.date) {
    return `${calendarClock(start, timezone)}–${calendarClock(end, timezone)}`;
  }
  return `${formatMinuteDateTime(start, timezone)} 至 ${formatMinuteDateTime(end, timezone)}`;
}

function compactSpanningTime(label: string) {
  const match = label.match(/^(\d{4})\/(.+) 至 (\d{4})\/(.+)$/);
  return match && match[1] === match[3] ? `${match[2]}–${match[4]}` : label;
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
    minHeight: 44,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  viewControl: {
    width: 156,
    minHeight: 36,
    padding: 3,
    flexDirection: 'row',
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  viewOption: {
    minHeight: 30,
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
    minHeight: 44,
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
    minHeight: 58,
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderStrong,
  },
  weekDay: {
    minHeight: 57,
    paddingVertical: 3,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  weekDayPressed: { backgroundColor: colors.surfaceSubtle },
  weekDayLabel: { color: colors.textSecondary, fontFamily, fontSize: 11, lineHeight: 16, fontWeight: '500' },
  weekDayLabelSelected: { color: colors.primaryStrong, fontWeight: '600' },
  weekDateCircle: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  weekDateToday: { borderWidth: 1, borderColor: colors.primary },
  weekDateSelected: { backgroundColor: colors.primary },
  weekDateText: { color: colors.text, fontFamily, fontSize: 15, lineHeight: 21, fontWeight: '600' },
  weekDateTextSelected: { color: colors.background },
  allDayBand: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderStrong,
    backgroundColor: colors.surfaceSubtle,
  },
  allDayLabel: {
    paddingTop: 7,
    paddingRight: 6,
    color: colors.textTertiary,
    fontFamily,
    fontSize: 9,
    lineHeight: 13,
    textAlign: 'right',
  },
  allDayColumn: {
    paddingHorizontal: 1,
    paddingVertical: 4,
    gap: 2,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.border,
  },
  allDayPill: {
    minHeight: 20,
    paddingHorizontal: 3,
    borderRadius: 4,
    justifyContent: 'center',
  },
  allDayPillText: { fontFamily, fontSize: 11, lineHeight: 15, fontWeight: '500' },
  allDayMoreButton: { minHeight: 28, justifyContent: 'center' },
  allDayMore: { color: colors.textSecondary, fontFamily, fontSize: 9, lineHeight: 12, textAlign: 'center' },
  spanningBand: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, backgroundColor: colors.background },
  spanningItem: { position: 'absolute', height: 32, paddingHorizontal: 5, borderLeftWidth: 2, borderRadius: 4, justifyContent: 'center' },
  spanningTitle: { fontFamily, fontSize: 11, lineHeight: 15, fontWeight: '600' },
  spanningTime: { fontFamily, fontSize: 10, lineHeight: 13, fontVariant: ['tabular-nums'] },
  spanningToggle: { minHeight: 32, alignItems: 'center', justifyContent: 'center' },
  timeShortcuts: { flexDirection: 'row', justifyContent: 'flex-end', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  timeShortcut: { minHeight: 32, paddingHorizontal: 12, justifyContent: 'center' },
  timeShortcutText: { color: colors.primaryStrong, fontFamily, fontSize: 11, lineHeight: 16 },
  timeGridScroll: { flex: 1 },
  timeGrid: { position: 'relative' },
  timeDayColumn: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.border,
  },
  timeDaySelected: { backgroundColor: 'rgba(7, 134, 95, 0.035)' },
  timeDayToday: { borderLeftColor: 'rgba(7, 134, 95, 0.30)' },
  hourRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  hourLabel: {
    marginTop: -13,
    color: colors.textTertiary,
    fontFamily,
    fontSize: 9,
    lineHeight: 12,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  hourLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  timelineItem: {
    position: 'absolute',
    zIndex: 2,
    minHeight: 0,
    paddingHorizontal: 3,
    paddingVertical: 2,
    borderLeftWidth: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  timelinePressed: { opacity: 0.62 },
  timelineTitle: { fontFamily, fontSize: 11, lineHeight: 15, fontWeight: '600' },
  timelineTime: { marginTop: 3, fontFamily, fontSize: 10, lineHeight: 13, fontVariant: ['tabular-nums'] },
  nowLine: { position: 'absolute', zIndex: 3, height: 8, flexDirection: 'row', alignItems: 'center' },
  nowDot: { width: 7, height: 7, marginLeft: -3, borderRadius: radius.pill, backgroundColor: colors.primary },
  nowRule: { flex: 1, height: 1, backgroundColor: colors.primary },
  weekEmpty: {
    position: 'absolute',
    zIndex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekEmptyTitle: { color: colors.textSecondary, fontFamily, ...typography.label, fontWeight: '600' },
  weekEmptyHint: { marginTop: 3, color: colors.textTertiary, fontFamily, fontSize: 11, lineHeight: 16 },
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
