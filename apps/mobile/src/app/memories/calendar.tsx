import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { ModalSheet } from '@/components/ui/modal-sheet';
import { NavHeader } from '@/components/ui/nav-header';
import {
  buildCalendarMonthCells,
  dateKeyForSelectedMonth,
  formatCalendarMonthTitle,
  monthAnchorFromDateKey,
} from '@/features/calendar/calendar-month';
import { useMemoriesPrototype } from '@/features/memories/memories-context';
import {
  formatMemoryDateParts,
  memoriesForDate,
  memoryDatesWithCounts,
} from '@/features/memories/memory-model';
import { MemoryMomentRow } from '@/features/memories/memory-moment-row';
import { colors, fontFamily, radius } from '@/theme/tokens';
import { formatDateParam } from '@/utils/format';

const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
const months = Array.from({ length: 12 }, (_, index) => index);

export default function MemoriesCalendarScreen() {
  const router = useRouter();
  const { moments } = useMemoriesPrototype();
  const latestDate = moments[0]?.date ?? formatDateParam(new Date());
  const [selectedDate, setSelectedDate] = useState(latestDate);
  const [monthAnchor, setMonthAnchor] = useState(() => monthAnchorFromDateKey(latestDate));
  const [monthPickerVisible, setMonthPickerVisible] = useState(false);
  const [pickerYear, setPickerYear] = useState(() => monthAnchor.getFullYear());
  const cells = useMemo(() => buildCalendarMonthCells(monthAnchor), [monthAnchor]);
  const counts = useMemo(() => memoryDatesWithCounts(moments), [moments]);
  const selectedMoments = memoriesForDate(moments, selectedDate);
  const selectedLabel = formatMemoryDateParts(selectedDate).full;
  const todayKey = formatDateParam(new Date());

  const shiftMonth = (offset: number) => {
    const next = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() + offset, 1);
    setMonthAnchor(next);
    setSelectedDate(dateKeyForSelectedMonth(next, new Date()));
  };

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

  return (
    <AppScreen includeBottomInset>
      <NavHeader title="按日期查找" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.monthBar}>
          <Pressable
            accessibilityLabel="上个月"
            accessibilityRole="button"
            onPress={() => shiftMonth(-1)}
            style={({ pressed }) => [styles.monthArrow, pressed && styles.pressed]}
          >
            <AppIcon name="chevron-back" size={21} />
          </Pressable>
          <Pressable
            accessibilityLabel={`选择月份，当前 ${formatCalendarMonthTitle(monthAnchor)}`}
            accessibilityRole="button"
            onPress={openMonthPicker}
            style={({ pressed }) => [styles.monthTitleButton, pressed && styles.pressed]}
          >
            <Text style={styles.monthTitle}>{formatCalendarMonthTitle(monthAnchor)}</Text>
            <AppIcon color={colors.textSecondary} name="chevron-down" size={16} />
          </Pressable>
          <Pressable
            accessibilityLabel="下个月"
            accessibilityRole="button"
            onPress={() => shiftMonth(1)}
            style={({ pressed }) => [styles.monthArrow, pressed && styles.pressed]}
          >
            <AppIcon name="chevron-forward" size={21} />
          </Pressable>
        </View>

        <View style={styles.weekRow}>
          {weekDays.map((label) => <Text key={label} style={styles.weekLabel}>{label}</Text>)}
        </View>
        <View style={styles.grid}>
          {cells.map((cell) => {
            const count = counts.get(cell.date) ?? 0;
            const selected = cell.date === selectedDate;
            const today = cell.date === todayKey;
            return (
              <Pressable
                accessibilityLabel={`${cell.date}，${count ? `${count} 段时光` : '没有时光'}`}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                key={cell.date}
                onPress={() => {
                  setSelectedDate(cell.date);
                  if (cell.muted) setMonthAnchor(monthAnchorFromDateKey(cell.date));
                }}
                style={({ pressed }) => [styles.cell, pressed && styles.cellPressed]}
              >
                <View style={[
                  styles.dayCircle,
                  selected && styles.dayCircleSelected,
                  today && !selected && styles.dayCircleToday,
                ]}>
                  <Text style={[
                    styles.dayText,
                    cell.muted && styles.dayTextMuted,
                    selected && styles.dayTextSelected,
                  ]}>{cell.day}</Text>
                </View>
                {count > 0 ? <View style={styles.memoryDot} /> : null}
              </Pressable>
            );
          })}
        </View>

        <View style={styles.daySection}>
          <View style={styles.dayHeading}>
            <Text accessibilityRole="header" style={styles.dayTitle}>{selectedLabel}</Text>
            {selectedMoments.length > 0 ? (
              <Text style={styles.dayCount}>{selectedMoments.length} 段</Text>
            ) : null}
          </View>
          {selectedMoments.length > 0 ? (
            <View style={styles.dayMoments}>
              {selectedMoments.map((moment) => (
                <MemoryMomentRow
                  compact
                  key={moment.id}
                  moment={moment}
                  onPress={() => router.push({
                    pathname: '/memories/[id]',
                    params: { id: moment.id },
                  })}
                />
              ))}
            </View>
          ) : (
            <View style={styles.emptyDay}>
              <Text style={styles.emptyDayTitle}>这一天还没有时光</Text>
              <Text style={styles.emptyDayMessage}>选择其他日期，或返回首页添加照片。</Text>
            </View>
          )}
        </View>
      </ScrollView>

      <Modal
        animationType="fade"
        onRequestClose={() => setMonthPickerVisible(false)}
        transparent
        visible={monthPickerVisible}
      >
        <ModalSheet maxHeight="62%" onClose={() => setMonthPickerVisible(false)}>
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
            <Pressable
              accessibilityLabel="上一年"
              accessibilityRole="button"
              onPress={() => setPickerYear((year) => year - 1)}
              style={styles.yearButton}
            ><AppIcon name="chevron-back" size={20} /></Pressable>
            <Text style={styles.yearText}>{pickerYear} 年</Text>
            <Pressable
              accessibilityLabel="下一年"
              accessibilityRole="button"
              onPress={() => setPickerYear((year) => year + 1)}
              style={styles.yearButton}
            ><AppIcon name="chevron-forward" size={20} /></Pressable>
          </View>
          <View style={styles.monthGrid}>
            {months.map((month) => {
              const selected = pickerYear === monthAnchor.getFullYear()
                && month === monthAnchor.getMonth();
              return (
                <Pressable
                  accessibilityLabel={`${pickerYear}年${month + 1}月`}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  key={month}
                  onPress={() => chooseMonth(pickerYear, month)}
                  style={({ pressed }) => [
                    styles.monthOption,
                    selected && styles.monthOptionSelected,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[
                    styles.monthOptionText,
                    selected && styles.monthOptionTextSelected,
                  ]}>{month + 1}月</Text>
                </Pressable>
              );
            })}
          </View>
        </ModalSheet>
      </Modal>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  monthBar: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  monthArrow: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  monthTitleButton: {
    minHeight: 48,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: radius.md,
  },
  monthTitle: {
    color: colors.text,
    fontFamily,
    fontSize: 18,
    lineHeight: 26,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  weekRow: {
    height: 34,
    flexDirection: 'row',
    alignItems: 'center',
  },
  weekLabel: {
    width: `${100 / 7}%`,
    color: colors.textSecondary,
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  cell: {
    width: `${100 / 7}%`,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellPressed: {
    opacity: 0.5,
  },
  dayCircle: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  dayCircleSelected: {
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  dayCircleToday: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  dayText: {
    color: colors.text,
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  dayTextMuted: {
    color: colors.textTertiary,
  },
  dayTextSelected: {
    color: colors.primaryStrong,
    fontWeight: '700',
  },
  memoryDot: {
    position: 'absolute',
    bottom: 3,
    width: 5,
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  daySection: {
    marginTop: 30,
    paddingTop: 22,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  dayHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dayTitle: {
    color: colors.text,
    fontFamily,
    fontSize: 18,
    lineHeight: 26,
    fontWeight: '600',
  },
  dayCount: {
    color: colors.primaryStrong,
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
  },
  dayMoments: {
    marginTop: 10,
    gap: 4,
  },
  emptyDay: {
    minHeight: 150,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyDayTitle: {
    color: colors.text,
    fontFamily,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
  },
  emptyDayMessage: {
    marginTop: 5,
    color: colors.textSecondary,
    fontFamily,
    fontSize: 13,
    lineHeight: 20,
  },
  pressed: {
    opacity: 0.58,
    backgroundColor: colors.surface,
  },
  pickerHeader: {
    height: 54,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pickerTitle: {
    color: colors.text,
    fontFamily,
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '600',
  },
  pickerClose: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  yearBar: {
    height: 52,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  yearButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  yearText: {
    color: colors.text,
    fontFamily,
    fontSize: 16,
    lineHeight: 23,
    fontWeight: '600',
  },
  monthGrid: {
    paddingHorizontal: 12,
    paddingBottom: 22,
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  monthOption: {
    width: '25%',
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
  },
  monthOptionSelected: {
    backgroundColor: colors.primarySoft,
  },
  monthOptionText: {
    color: colors.textSecondary,
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
  },
  monthOptionTextSelected: {
    color: colors.primaryStrong,
    fontWeight: '700',
  },
});
