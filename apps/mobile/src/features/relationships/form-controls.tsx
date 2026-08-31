import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontFamily, radius, typography } from '@/theme/tokens';

export function FormField({ children, label }: { children: ReactNode; label: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

export function ChoiceChips<T extends string>({
  onChange,
  options,
  value,
}: {
  onChange: (value: T) => void;
  options: readonly { id: T; label: string }[];
  value: T;
}) {
  return (
    <View style={styles.choices}>
      {options.map((option) => {
        const selected = option.id === value;
        return (
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            key={option.id}
            onPress={() => onChange(option.id)}
            style={({ pressed }) => [
              styles.choice,
              selected && styles.choiceSelected,
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export const relationshipFormStyles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingTop: 18, paddingBottom: 32, gap: 22 },
  input: {
    minHeight: 52,
    paddingHorizontal: 16,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSubtle,
    color: colors.text,
    fontFamily,
    ...typography.input,
  },
  multiline: { minHeight: 112, paddingTop: 14, textAlignVertical: 'top' },
  error: { color: colors.danger, fontFamily, ...typography.meta },
  submit: { marginTop: 8 },
});

const styles = StyleSheet.create({
  field: { gap: 9 },
  label: { color: colors.text, fontFamily, ...typography.bodyStrong },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { minHeight: 44, paddingHorizontal: 17, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.surfaceSubtle },
  choiceSelected: { backgroundColor: colors.primarySoft },
  choiceText: { color: colors.textSecondary, fontFamily, ...typography.label },
  choiceTextSelected: { color: colors.primaryStrong, fontWeight: '700' },
  pressed: { opacity: 0.72 },
});
