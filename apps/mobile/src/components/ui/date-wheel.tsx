import { useEffect, useMemo, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  createNumberOptions,
  getDaysInMonth,
  parseCalendarDateParts,
  updateCalendarDatePart,
  type CalendarDatePart,
} from '@/utils/calendar-date';
import { colors, fontFamily, radius } from '@/theme/tokens';

const itemHeight = 44;

function DateWheelColumn({
  label,
  onChange,
  selectedValue,
  values,
}: {
  label: string;
  onChange: (value: number) => void;
  selectedValue: number;
  values: number[];
}) {
  const scrollRef = useRef<ScrollView>(null);
  const wheelSelectedValueRef = useRef<number | null>(null);
  const selectedIndex = Math.max(0, values.indexOf(selectedValue));

  useEffect(() => {
    if (wheelSelectedValueRef.current === selectedValue) {
      wheelSelectedValueRef.current = null;
      return;
    }

    const frame = requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({
        animated: false,
        y: selectedIndex * itemHeight,
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedIndex, selectedValue]);

  const selectOffset = (offset: number) => {
    const index = Math.max(0, Math.min(values.length - 1, Math.round(offset / itemHeight)));
    const value = values[index];
    if (value !== undefined && value !== selectedValue) {
      wheelSelectedValueRef.current = value;
      onChange(value);
    }
  };

  return (
    <View style={styles.column}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.window}>
        <View pointerEvents="none" style={styles.selection} />
        <ScrollView
          accessibilityLabel={`${label}选择`}
          contentContainerStyle={styles.content}
          decelerationRate="fast"
          nestedScrollEnabled
          onMomentumScrollEnd={(event) => selectOffset(event.nativeEvent.contentOffset.y)}
          onScrollEndDrag={(event) => selectOffset(event.nativeEvent.contentOffset.y)}
          ref={scrollRef}
          showsVerticalScrollIndicator={false}
          snapToInterval={itemHeight}
          style={styles.scroll}
        >
          {values.map((value, index) => {
            const selected = value === selectedValue;
            return (
              <Pressable
                accessibilityLabel={`${value}${label}`}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                key={value}
                onPress={() => {
                  wheelSelectedValueRef.current = value;
                  onChange(value);
                  scrollRef.current?.scrollTo({
                    animated: true,
                    y: index * itemHeight,
                  });
                }}
                style={({ pressed }) => [styles.item, pressed && styles.pressed]}
              >
                <Text style={[styles.value, selected && styles.valueSelected]}>{value}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}

export function DateWheel({
  endYear = new Date().getFullYear() + 100,
  onChange,
  startYear = 1900,
  value,
}: {
  endYear?: number;
  onChange: (date: string) => void;
  startYear?: number;
  value: string;
}) {
  const { year, month, day } = parseCalendarDateParts(value);
  const years = useMemo(
    () => createNumberOptions(startYear, endYear),
    [endYear, startYear],
  );
  const months = useMemo(() => createNumberOptions(1, 12), []);
  const days = useMemo(
    () => createNumberOptions(1, getDaysInMonth(year, month)),
    [month, year],
  );

  const changePart = (part: CalendarDatePart, nextValue: number) => {
    onChange(updateCalendarDatePart(value, part, nextValue));
  };

  return (
    <View style={styles.wheel}>
      <DateWheelColumn
        label="年"
        onChange={(nextValue) => changePart('year', nextValue)}
        selectedValue={year}
        values={years}
      />
      <DateWheelColumn
        label="月"
        onChange={(nextValue) => changePart('month', nextValue)}
        selectedValue={month}
        values={months}
      />
      <DateWheelColumn
        label="日"
        onChange={(nextValue) => changePart('day', nextValue)}
        selectedValue={day}
        values={days}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wheel: {
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 10,
    flexDirection: 'row',
    gap: 8,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSubtle,
  },
  column: {
    minWidth: 0,
    flex: 1,
  },
  label: {
    marginBottom: 4,
    color: colors.textSecondary,
    fontFamily,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  window: {
    height: itemHeight * 3,
    overflow: 'hidden',
    borderRadius: radius.md,
  },
  selection: {
    position: 'absolute',
    top: itemHeight,
    right: 0,
    left: 0,
    height: itemHeight,
    borderWidth: 1,
    borderColor: colors.primaryTrack,
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
  },
  scroll: {
    height: itemHeight * 3,
  },
  content: {
    paddingVertical: itemHeight,
  },
  item: {
    height: itemHeight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  value: {
    color: colors.textTertiary,
    fontFamily,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  valueSelected: {
    color: colors.primaryStrong,
    fontSize: 17,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.62,
  },
});
