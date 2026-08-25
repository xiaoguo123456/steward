import type { TrackerSchedule, TrackerScheduleFrequency } from '@steward/api-client';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontFamily, radius, typography } from '@/theme/tokens';

type ScheduleChoice = 'none' | TrackerScheduleFrequency;

const frequencyOptions: { value: ScheduleChoice; label: string }[] = [
  { value: 'none', label: '不定期' },
  { value: 'daily', label: '每天' },
  { value: 'weekly', label: '每周' },
];

const weekdays = [
  { value: 1, label: '一' },
  { value: 2, label: '二' },
  { value: 3, label: '三' },
  { value: 4, label: '四' },
  { value: 5, label: '五' },
  { value: 6, label: '六' },
  { value: 7, label: '日' },
];

export function TrackerSchedulePicker({
  value,
  onChange,
}: {
  value: TrackerSchedule | null;
  onChange: (value: TrackerSchedule | null) => void;
}) {
  const selected: ScheduleChoice = value?.frequency ?? 'none';

  const selectFrequency = (next: ScheduleChoice) => {
    if (next === 'none') {
      onChange(null);
      return;
    }
    if (next === 'daily') {
      onChange({ frequency: 'daily' });
      return;
    }
    const jsDay = new Date().getDay();
    onChange({ frequency: 'weekly', weekdays: [jsDay === 0 ? 7 : jsDay] });
  };

  const toggleWeekday = (weekday: number) => {
    const current = value?.frequency === 'weekly' ? (value.weekdays ?? []) : [];
    const next = current.includes(weekday)
      ? current.filter((item) => item !== weekday)
      : [...current, weekday].sort((a, b) => a - b);
    if (next.length > 0) onChange({ frequency: 'weekly', weekdays: next });
  };

  return (
    <View>
      <View style={styles.frequencyRow}>
        {frequencyOptions.map((option) => {
          const active = selected === option.value;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              key={option.value}
              onPress={() => selectFrequency(option.value)}
              style={({ pressed }) => [
                styles.frequencyButton,
                active && styles.frequencyButtonActive,
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.frequencyText, active && styles.frequencyTextActive]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {value?.frequency === 'weekly' ? (
        <View style={styles.weekdayRow}>
          {weekdays.map((weekday) => {
            const active = value.weekdays?.includes(weekday.value) ?? false;
            return (
              <Pressable
                accessibilityLabel={`周${weekday.label}`}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                key={weekday.value}
                onPress={() => toggleWeekday(weekday.value)}
                style={({ pressed }) => [
                  styles.weekdayButton,
                  active && styles.weekdayButtonActive,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.weekdayText, active && styles.weekdayTextActive]}>
                  {weekday.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

export function describeTrackerSchedule(schedule?: TrackerSchedule): string {
  if (!schedule) return '不定期';
  if (schedule.frequency === 'daily') return '每天';
  const selected = schedule.weekdays ?? [];
  return selected.length > 0
    ? `每周${selected.map((day) => weekdays.find((item) => item.value === day)?.label).join('、')}`
    : '每周';
}

const styles = StyleSheet.create({
  frequencyRow: {
    flexDirection: 'row',
    gap: 8,
  },
  frequencyButton: {
    minHeight: 44,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  frequencyButtonActive: {
    backgroundColor: colors.primarySoft,
  },
  frequencyText: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.label,
  },
  frequencyTextActive: {
    color: colors.primaryStrong,
    fontWeight: '600',
  },
  weekdayRow: {
    marginTop: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  weekdayButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  weekdayButtonActive: {
    backgroundColor: colors.primary,
  },
  weekdayText: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.label,
  },
  weekdayTextActive: {
    color: colors.background,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.68,
  },
});
