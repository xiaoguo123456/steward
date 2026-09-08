import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';
import { trackerPresets } from './tracker-presets';

export function TrackerPresetChoices({ onSelect, selectedId }: { onSelect: (id: string) => void; selectedId?: string }) {
  return (
    <View style={styles.choices}>
      {trackerPresets.map((preset) => (
        <Pressable
          accessibilityLabel={`选择${preset.name}模板`}
          accessibilityRole="button"
          accessibilityState={{ selected: selectedId === preset.id }}
          key={preset.id}
          onPress={() => onSelect(preset.id)}
          style={({ pressed }) => [styles.choice, selectedId === preset.id && styles.selected, pressed && styles.pressed]}
        >
          <Text style={styles.name}>{preset.name}</Text>
          <Text style={styles.hint}>{preset.hint}</Text>
        </Pressable>
      ))}
    </View>
  );
}
const styles = StyleSheet.create({
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  choice: { flexBasis: '46%', flexGrow: 1, minHeight: 76, padding: 14, borderRadius: radius.md, backgroundColor: colors.surfaceSubtle, borderWidth: 1, borderColor: colors.border },
  selected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  name: { color: colors.text, fontFamily, ...typography.bodyStrong },
  hint: { marginTop: 4, color: colors.textSecondary, fontFamily, ...typography.caption },
  pressed: { opacity: 0.65 },
});
