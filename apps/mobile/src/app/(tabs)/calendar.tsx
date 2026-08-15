import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AiFab } from '@/components/ui/ai-fab';
import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { NavHeader } from '@/components/ui/nav-header';
import { nextAgenda } from '@/mocks/data';
import { colors, fontFamily, radius } from '@/theme/tokens';

type CalendarCell = {
  day: number;
  muted?: boolean;
  dot?: string;
};

const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
const calendarCells: CalendarCell[] = [
  { day: 26, muted: true },
  { day: 27, muted: true },
  { day: 28, muted: true },
  { day: 29, muted: true },
  { day: 30, muted: true },
  { day: 31, muted: true },
  { day: 1 },
  { day: 2 },
  { day: 3 },
  { day: 4 },
  { day: 5 },
  { day: 6 },
  { day: 7 },
  { day: 8 },
  { day: 9 },
  { day: 10 },
  { day: 11, dot: colors.primary },
  { day: 12, dot: colors.warning },
  { day: 13 },
  { day: 14 },
  { day: 15 },
  { day: 16 },
  { day: 17, dot: colors.blue },
  { day: 18 },
  { day: 19, dot: colors.pink },
  { day: 20 },
  { day: 21 },
  { day: 22 },
  { day: 23 },
  { day: 24 },
  { day: 25 },
  { day: 26 },
  { day: 27 },
  { day: 28 },
  { day: 29 },
  { day: 30 },
  { day: 1, muted: true },
  { day: 2, muted: true },
  { day: 3, muted: true },
  { day: 4, muted: true },
  { day: 5, muted: true },
  { day: 6, muted: true },
];

const agenda = [
  {
    title: nextAgenda.title,
    time: `${nextAgenda.time} · ${nextAgenda.location}`,
    icon: 'calendar-outline' as const,
    color: colors.blue,
    background: '#EAF2FF',
  },
  {
    title: '健身 30 分钟',
    time: '19:00 — 20:00 · 健康',
    icon: 'barbell-outline' as const,
    color: colors.primaryStrong,
    background: colors.primarySoft,
  },
  {
    title: '阅读《设计心理学》',
    time: '21:00 — 21:30 · 学习',
    icon: 'book-outline' as const,
    color: colors.purple,
    background: '#F2EEFF',
  },
];

export default function CalendarScreen() {
  const [selectedDay, setSelectedDay] = useState(18);
  const [monthExpanded, setMonthExpanded] = useState(false);
  const selectedDayIndex = calendarCells.findIndex(
    (cell) => !cell.muted && cell.day === selectedDay,
  );
  const selectedWeekStart = Math.floor(Math.max(selectedDayIndex, 0) / 7) * 7;
  const visibleCalendarCells = monthExpanded
    ? calendarCells
    : calendarCells.slice(selectedWeekStart, selectedWeekStart + 7);
  const selectedDateTitle = selectedDay === 18 ? '今天 · 6月18日' : `6月${selectedDay}日`;

  return (
    <AppScreen>
      <NavHeader title="日历" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.monthHeader}>
          <View style={styles.monthPicker}>
            <Pressable accessibilityLabel="上个月" accessibilityRole="button" hitSlop={10}>
              <AppIcon name="chevron-back" size={21} />
            </Pressable>
            <Text style={styles.monthTitle}>2024年6月</Text>
            <Pressable accessibilityLabel="下个月" accessibilityRole="button" hitSlop={10}>
              <AppIcon name="chevron-forward" size={21} />
            </Pressable>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => setSelectedDay(18)}
            style={({ pressed }) => [styles.todayButton, pressed && styles.pressed]}
          >
            <Text style={styles.todayText}>今天</Text>
          </Pressable>
        </View>

        <View style={styles.weekRow}>
          {weekDays.map((day, index) => (
            <Text key={day} style={[styles.weekText, index === 0 && styles.sunday]}>
              {day}
            </Text>
          ))}
        </View>
        <View style={styles.divider} />

        <View style={styles.grid}>
          {visibleCalendarCells.map((cell, index) => {
            const selected = !cell.muted && cell.day === selectedDay;
            return (
              <Pressable
                accessibilityLabel={`${cell.muted ? '相邻月份' : '6月'}${cell.day}日${cell.dot ? '，有安排' : ''}`}
                accessibilityRole="button"
                accessibilityState={{ disabled: Boolean(cell.muted), selected }}
                disabled={cell.muted}
                key={`${cell.day}-${index}`}
                onPress={() => setSelectedDay(cell.day)}
                style={styles.cell}
              >
                <View style={[styles.dateCircle, selected && styles.dateCircleSelected]}>
                  <Text
                    style={[
                      styles.dateText,
                      cell.muted && styles.dateMuted,
                      selected && styles.dateSelected,
                    ]}
                  >
                    {cell.day}
                  </Text>
                </View>
                {cell.dot && !selected ? (
                  <View style={[styles.dot, { backgroundColor: cell.dot }]} />
                ) : (
                  <View style={styles.dotPlaceholder} />
                )}
              </Pressable>
            );
          })}
        </View>

        <Pressable
          accessibilityHint={
            monthExpanded
              ? '收起后仅显示当前选中日期所在的一周'
              : '展开后显示完整月份'
          }
          accessibilityLabel={monthExpanded ? '收起月历' : '展开完整月历'}
          accessibilityRole="button"
          accessibilityState={{ expanded: monthExpanded }}
          onPress={() => setMonthExpanded((current) => !current)}
          style={({ pressed }) => [styles.calendarToggle, pressed && styles.togglePressed]}
        >
          <Text style={styles.calendarToggleText}>
            {monthExpanded ? '收起月历' : '展开月历'}
          </Text>
          <AppIcon
            color={colors.textSecondary}
            name={monthExpanded ? 'chevron-up' : 'chevron-down'}
            size={15}
          />
        </Pressable>

        <View style={styles.agendaHeader}>
          <Text accessibilityRole="header" style={styles.agendaTitle}>{selectedDateTitle}</Text>
          <Text style={styles.agendaCount}>{agenda.length} 项安排</Text>
        </View>
        <View style={styles.agendaList}>
          {agenda.map((item) => (
            <View key={item.title} style={styles.agendaRow}>
              <View style={[styles.agendaIcon, { backgroundColor: item.background }]}>
                <AppIcon color={item.color} name={item.icon} size={18} />
              </View>
              <View style={styles.agendaCopy}>
                <Text style={styles.agendaItemTitle}>{item.title}</Text>
                <Text style={styles.agendaMeta}>{item.time}</Text>
              </View>
              <AppIcon color={colors.borderStrong} name="chevron-forward" size={17} />
            </View>
          ))}
        </View>
      </ScrollView>
      <AiFab count={2} />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingTop: 2,
    paddingBottom: 112,
  },
  monthHeader: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  monthPicker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  monthTitle: {
    color: colors.text,
    fontFamily,
    fontSize: 18,
    lineHeight: 25,
    fontWeight: '700',
  },
  todayButton: {
    height: 36,
    paddingHorizontal: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
  },
  pressed: {
    opacity: 0.58,
  },
  todayText: {
    color: colors.primaryStrong,
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
  },
  weekRow: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
  },
  weekText: {
    width: '14.2857%',
    color: colors.textSecondary,
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  sunday: {
    color: colors.danger,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  grid: {
    marginTop: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  cell: {
    width: '14.2857%',
    height: 47,
    alignItems: 'center',
  },
  dateCircle: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateCircleSelected: {
    backgroundColor: colors.primary,
  },
  dateText: {
    color: colors.text,
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
  },
  dateMuted: {
    color: '#C9CECB',
  },
  dateSelected: {
    color: colors.background,
    fontWeight: '700',
  },
  dot: {
    width: 5,
    height: 5,
    marginTop: 1,
    borderRadius: radius.pill,
  },
  dotPlaceholder: {
    width: 5,
    height: 5,
    marginTop: 1,
  },
  calendarToggle: {
    minHeight: 44,
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderRadius: radius.sm,
  },
  togglePressed: {
    backgroundColor: colors.surface,
  },
  calendarToggleText: {
    color: colors.textSecondary,
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '500',
  },
  agendaHeader: {
    minHeight: 54,
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  agendaTitle: {
    color: colors.text,
    fontFamily,
    fontSize: 16,
    lineHeight: 23,
    fontWeight: '600',
  },
  agendaCount: {
    color: colors.textSecondary,
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
  },
  agendaList: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  agendaRow: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  agendaIcon: {
    width: 36,
    height: 36,
    marginRight: 12,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  agendaCopy: {
    flex: 1,
    paddingRight: 8,
  },
  agendaItemTitle: {
    color: colors.text,
    fontFamily,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '500',
  },
  agendaMeta: {
    marginTop: 4,
    color: colors.textSecondary,
    fontFamily,
    fontSize: 12,
    lineHeight: 17,
  },
});
