import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppIcon } from '@/components/ui/icon';
import {
  AppSegmentedControl,
  AppSlider,
} from '@/components/ui/selection-controls';
import { colors, fontFamily, radius } from '@/theme/tokens';

import type { OutdoorWorkoutTarget } from '../model';
import { workoutAccent } from '../mock-data';

type WorkoutTargetSelectorProps = {
  targets: OutdoorWorkoutTarget[];
  selectedTarget: OutdoorWorkoutTarget;
  value: number;
  onSelectTarget: (target: OutdoorWorkoutTarget) => void;
  onValueChange: (value: number) => void;
};

export function formatWorkoutTargetValue(target: OutdoorWorkoutTarget, value: number) {
  if (target.id === 'open') {
    return target.value;
  }

  if (target.id === 'distance') {
    return `${value.toFixed(1)} ${target.unit}`;
  }

  return `${Math.round(value)} ${target.unit}`;
}

function formatTargetNumber(target: OutdoorWorkoutTarget, value: number) {
  if (target.id === 'open') {
    return target.value;
  }

  return target.id === 'distance' ? value.toFixed(1) : `${Math.round(value)}`;
}

function formatPresetNumber(target: OutdoorWorkoutTarget, value: number) {
  if (target.id === 'open') {
    return target.value;
  }

  if (target.id === 'distance' && !Number.isInteger(value)) {
    return value.toFixed(1);
  }

  return `${Math.round(value)}`;
}

export function WorkoutTargetSelector({
  targets,
  selectedTarget,
  value,
  onSelectTarget,
  onValueChange,
}: WorkoutTargetSelectorProps) {
  const selectedIndex = Math.max(
    0,
    targets.findIndex((target) => target.id === selectedTarget.id),
  );

  return (
    <View style={styles.container}>
      <AppSegmentedControl
        onChange={(event) => {
          const target = targets[event.nativeEvent.selectedSegmentIndex];
          if (target) {
            onSelectTarget(target);
          }
        }}
        selectedIndex={selectedIndex}
        style={styles.segmentedControl}
        values={targets.map((target) => target.label)}
      />

      {selectedTarget.id === 'open' ? (
        <View style={styles.openTarget}>
          <Text accessibilityRole="header" style={styles.openTargetValue}>
            {selectedTarget.value}
          </Text>
          <Text style={styles.description}>{selectedTarget.description}</Text>
        </View>
      ) : (
        <View style={styles.numericTarget}>
          <View style={styles.valueRow}>
            <Pressable
              accessibilityLabel={`减少${selectedTarget.label}目标`}
              accessibilityRole="button"
              disabled={value <= selectedTarget.minimumValue}
              onPress={() =>
                onValueChange(
                  Math.max(selectedTarget.minimumValue, value - selectedTarget.step),
                )
              }
              style={({ pressed }) => [
                styles.adjustButton,
                value <= selectedTarget.minimumValue && styles.adjustButtonDisabled,
                pressed && value > selectedTarget.minimumValue && styles.adjustButtonPressed,
              ]}
            >
              <AppIcon color={workoutAccent.ink} name="remove" size={21} />
            </Pressable>

            <View accessibilityLiveRegion="polite" style={styles.valueDisplay}>
              <Text style={styles.valueText}>{formatTargetNumber(selectedTarget, value)}</Text>
              <Text style={styles.unitText}>{selectedTarget.unit}</Text>
            </View>

            <Pressable
              accessibilityLabel={`增加${selectedTarget.label}目标`}
              accessibilityRole="button"
              disabled={value >= selectedTarget.maximumValue}
              onPress={() =>
                onValueChange(
                  Math.min(selectedTarget.maximumValue, value + selectedTarget.step),
                )
              }
              style={({ pressed }) => [
                styles.adjustButton,
                value >= selectedTarget.maximumValue && styles.adjustButtonDisabled,
                pressed && value < selectedTarget.maximumValue && styles.adjustButtonPressed,
              ]}
            >
              <AppIcon color={workoutAccent.ink} name="add" size={21} />
            </Pressable>
          </View>

          <AppSlider
            accessibilityLabel={`调整${selectedTarget.label}目标`}
            accessibilityValue={{
              max: selectedTarget.maximumValue,
              min: selectedTarget.minimumValue,
              now: value,
              text: formatWorkoutTargetValue(selectedTarget, value),
            }}
            max={selectedTarget.maximumValue}
            min={selectedTarget.minimumValue}
            onValueChange={onValueChange}
            step={selectedTarget.step}
            style={styles.slider}
            value={value}
          />
          <View style={styles.rangeLabels}>
            <Text style={styles.rangeLabel}>
              {formatPresetNumber(selectedTarget, selectedTarget.minimumValue)}
            </Text>
            <Text style={styles.rangeLabel}>
              {formatPresetNumber(selectedTarget, selectedTarget.maximumValue)}
            </Text>
          </View>

          <View accessibilityRole="radiogroup" style={styles.presets}>
            {selectedTarget.presets.map((preset) => {
              const selected = Math.abs(value - preset) < 0.001;
              return (
                <Pressable
                  accessibilityLabel={`${formatPresetNumber(selectedTarget, preset)}${selectedTarget.unit}`}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  key={preset}
                  onPress={() => onValueChange(preset)}
                  style={({ pressed }) => [
                    styles.preset,
                    selected && styles.presetSelected,
                    pressed && styles.presetPressed,
                  ]}
                >
                  <Text style={[styles.presetText, selected && styles.presetTextSelected]}>
                    {formatPresetNumber(selectedTarget, preset)}
                    <Text style={styles.presetUnit}> {selectedTarget.unit}</Text>
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.description}>{selectedTarget.description}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    borderRadius: radius.lg,
    backgroundColor: colors.background,
  },
  segmentedControl: {
    height: 44,
  },
  openTarget: {
    minHeight: 210,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  openTargetValue: {
    color: workoutAccent.ink,
    fontFamily,
    fontSize: 34,
    lineHeight: 43,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  numericTarget: {
    minHeight: 210,
    paddingTop: 14,
  },
  valueRow: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  adjustButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSubtle,
  },
  adjustButtonPressed: {
    opacity: 0.64,
    transform: [{ scale: 0.97 }],
  },
  adjustButtonDisabled: {
    opacity: 0.35,
  },
  valueDisplay: {
    minWidth: 140,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: 7,
  },
  valueText: {
    color: workoutAccent.ink,
    fontFamily,
    fontSize: 40,
    lineHeight: 50,
    fontWeight: '700',
    letterSpacing: -0.8,
    fontVariant: ['tabular-nums'],
  },
  unitText: {
    color: workoutAccent.muted,
    fontFamily,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '600',
  },
  slider: {
    height: 44,
  },
  rangeLabels: {
    marginTop: -8,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  rangeLabel: {
    color: colors.textTertiary,
    fontFamily,
    fontSize: 11,
    lineHeight: 16,
    fontVariant: ['tabular-nums'],
  },
  presets: {
    marginTop: 12,
    flexDirection: 'row',
    gap: 8,
  },
  preset: {
    minWidth: 0,
    minHeight: 44,
    flex: 1,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSubtle,
  },
  presetSelected: {
    backgroundColor: colors.primarySoft,
  },
  presetPressed: {
    opacity: 0.64,
  },
  presetText: {
    color: workoutAccent.ink,
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  presetTextSelected: {
    color: colors.primaryStrong,
  },
  presetUnit: {
    fontSize: 10,
    fontWeight: '500',
  },
  description: {
    marginTop: 14,
    color: workoutAccent.muted,
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
});
