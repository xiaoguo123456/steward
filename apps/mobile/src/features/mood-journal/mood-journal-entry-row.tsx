import type { MoodJournalEntry } from '@steward/api-client';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppIcon } from '@/components/ui/icon';
import { colors, fontFamily, moodColors, radius, typography } from '@/theme/tokens';
import { entryMoodText, entryTime } from './model';

export function MoodJournalEntryRow({
  entry,
  showDivider = false,
}: {
  entry: MoodJournalEntry;
  showDivider?: boolean;
}) {
  const router = useRouter();
  const moodText = entryMoodText(entry);

  return (
    <Pressable
      accessibilityLabel={`${entryTime(entry)}，${entry.content_plaintext}`}
      accessibilityRole="button"
      onPress={() => router.push({ pathname: '/mood-journal/[id]', params: { id: entry.id } })}
      style={({ pressed }) => [
        styles.entry,
        showDivider && styles.entryDivider,
        pressed && styles.entryPressed,
      ]}
    >
      <Text style={styles.entryTime}>{entryTime(entry)}</Text>
      <View style={styles.entryBody}>
        <Text numberOfLines={4} style={styles.entryText}>{entry.content_plaintext}</Text>
        {moodText ? (
          <View style={styles.moodMeta}>
            <View style={styles.moodGlyph} />
            <Text style={styles.moodText}>{moodText}</Text>
          </View>
        ) : null}
      </View>
      <AppIcon color={colors.textTertiary} name="chevron-forward" size={16} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  entry: {
    minHeight: 116,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  entryDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  entryPressed: { opacity: 0.58 },
  entryTime: { width: 43, color: colors.textSecondary, fontFamily, ...typography.meta },
  entryBody: { flex: 1, minWidth: 0 },
  entryText: { color: colors.text, fontFamily, fontSize: 16, lineHeight: 25 },
  moodMeta: { marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 7 },
  moodGlyph: {
    width: 8,
    height: 8,
    borderWidth: 2,
    borderColor: moodColors.accent,
    borderRadius: radius.pill,
  },
  moodText: { color: colors.textSecondary, fontFamily, ...typography.meta },
});
