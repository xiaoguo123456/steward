import { useEffect, useMemo, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, fontFamily, radius } from '@/theme/tokens';

const itemHeight = 44;

function TimeColumn({
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
  const selectedIndex = Math.max(0, values.indexOf(selectedValue));

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ animated: false, y: selectedIndex * itemHeight });
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedIndex]);

  const selectOffset = (offset: number) => {
    const index = Math.max(0, Math.min(values.length - 1, Math.round(offset / itemHeight)));
    const value = values[index];
    if (value !== undefined && value !== selectedValue) onChange(value);
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
                  onChange(value);
                  scrollRef.current?.scrollTo({ animated: true, y: index * itemHeight });
                }}
                style={({ pressed }) => [styles.item, pressed && styles.pressed]}
              >
                <Text style={[styles.value, selected && styles.valueSelected]}>
                  {String(value).padStart(2, '0')}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}

export function TimeWheel({ onChange, value }: { onChange: (value: string) => void; value: string }) {
  const [hour = 0, minute = 0] = value.split(':').map(Number);
  const hours = useMemo(() => Array.from({ length: 24 }, (_, index) => index), []);
  const minutes = useMemo(() => Array.from({ length: 60 }, (_, index) => index), []);

  const update = (nextHour: number, nextMinute: number) => {
    onChange(`${String(nextHour).padStart(2, '0')}:${String(nextMinute).padStart(2, '0')}`);
  };

  return (
    <View style={styles.wheel}>
      <TimeColumn
        label="时"
        onChange={(nextHour) => update(nextHour, minute)}
        selectedValue={hour}
        values={hours}
      />
      <Text pointerEvents="none" style={styles.separator}>:</Text>
      <TimeColumn
        label="分"
        onChange={(nextMinute) => update(hour, nextMinute)}
        selectedValue={minute}
        values={minutes}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wheel: {
    paddingHorizontal: 32,
    paddingTop: 8,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
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
  separator: {
    paddingTop: 18,
    color: colors.text,
    fontFamily,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.62,
  },
});
