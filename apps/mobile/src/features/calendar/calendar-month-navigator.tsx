import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { AppIcon } from '@/components/ui/icon';
import { ModalSheet } from '@/components/ui/modal-sheet';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';
import { formatCalendarMonthTitle } from './calendar-month';

const months = Array.from({ length: 12 }, (_, index) => index);

export function CalendarMonthNavigator({
  monthAnchor,
  onChangeMonth,
  selectedBackground = colors.primarySoft,
  selectedText = colors.primaryStrong,
}: {
  monthAnchor: Date;
  onChangeMonth: (next: Date) => void;
  selectedBackground?: string;
  selectedText?: string;
}) {
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerYear, setPickerYear] = useState(() => monthAnchor.getFullYear());

  const shiftMonth = (offset: number) => {
    onChangeMonth(new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() + offset, 1));
  };

  const openPicker = () => {
    setPickerYear(monthAnchor.getFullYear());
    setPickerVisible(true);
  };

  const chooseMonth = (month: number) => {
    onChangeMonth(new Date(pickerYear, month, 1));
    setPickerVisible(false);
  };

  return (
    <>
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
          onPress={openPicker}
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

      <Modal
        animationType="fade"
        onRequestClose={() => setPickerVisible(false)}
        transparent
        visible={pickerVisible}
      >
        <ModalSheet maxHeight="62%" onClose={() => setPickerVisible(false)}>
          <View style={styles.pickerHeader}>
            <Text accessibilityRole="header" style={styles.pickerTitle}>
              选择月份
            </Text>
            <Pressable
              accessibilityLabel="关闭月份选择"
              accessibilityRole="button"
              onPress={() => setPickerVisible(false)}
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
            >
              <AppIcon name="chevron-back" size={20} />
            </Pressable>
            <Text style={styles.yearText}>{pickerYear} 年</Text>
            <Pressable
              accessibilityLabel="下一年"
              accessibilityRole="button"
              onPress={() => setPickerYear((year) => year + 1)}
              style={styles.yearButton}
            >
              <AppIcon name="chevron-forward" size={20} />
            </Pressable>
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
                  onPress={() => chooseMonth(month)}
                  style={({ pressed }) => [
                    styles.monthOption,
                    selected && { backgroundColor: selectedBackground },
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[
                    styles.monthOptionText,
                    selected && { color: selectedText, fontWeight: '700' },
                  ]}>{month + 1}月</Text>
                </Pressable>
              );
            })}
          </View>
        </ModalSheet>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
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
  pickerHeader: {
    height: 54,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pickerTitle: { color: colors.text, fontFamily, ...typography.bodyStrong },
  pickerClose: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  yearBar: {
    height: 56,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  yearButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  yearText: { color: colors.text, fontFamily, ...typography.section, fontVariant: ['tabular-nums'] },
  monthGrid: { paddingHorizontal: 16, paddingBottom: 24, flexDirection: 'row', flexWrap: 'wrap' },
  monthOption: {
    width: '33.333%',
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
  },
  monthOptionText: { color: colors.textSecondary, fontFamily, ...typography.label },
  pressed: { opacity: 0.58, backgroundColor: colors.surface },
});
