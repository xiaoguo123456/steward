import type { AssistantChoice } from '@steward/api-client';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { choiceLabelParts } from './clarification-choice-model';

import { AppIcon } from '@/components/ui/icon';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';

export function ClarificationChoices({ choices, selectedId, active, busy, onSelect }: {
  choices: AssistantChoice[];
  selectedId?: string;
  active: boolean;
  busy: boolean;
  onSelect?: (id: string, label: string) => void;
}) {
  if (!choices.length) return null;
  const disabled = !active || busy || !onSelect;
  const status = selectedId ? '已选择' : active ? busy ? '正在提交选择…' : '请选择一项' : '本轮选择已结束';
  return (
    <View style={styles.group}>
      <View style={styles.heading}>
        <Text accessibilityLiveRegion="polite" style={styles.status}>{status}</Text>
        {active && busy ? <ActivityIndicator size="small" color={colors.primaryStrong} /> : null}
      </View>
      {choices.map((choice, index) => {
        const selected = choice.id === selectedId;
        const { title, detail } = choiceLabelParts(choice.label);
        return (
          <Pressable
            key={choice.id}
            accessibilityRole="button"
            accessibilityLabel={choice.label}
            accessibilityHint={disabled ? undefined : '选择此项后继续处理，保存前仍需确认'}
            accessibilityState={{ disabled, selected, busy: active && busy }}
            disabled={disabled}
            onPress={() => onSelect?.(choice.id, choice.label)}
            style={({ pressed }) => [styles.card, selected && styles.selected, pressed && styles.pressed]}
          >
            <View style={[styles.marker, selected && styles.selectedMarker]}>
              {selected ? <AppIcon name="checkmark" size={16} color={colors.background} /> : <Text style={styles.number}>{index + 1}</Text>}
            </View>
            <View style={styles.copy}>
              <Text style={styles.title}>{title}</Text>
              {detail ? <Text style={styles.detail}>{detail}</Text> : null}
            </View>
            {selected ? <Text style={styles.selectedText}>已选</Text> : !disabled ? <AppIcon name="chevron-forward" size={18} color={colors.primaryStrong} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { marginLeft: 39, gap: 8 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  status: { color: colors.textSecondary, fontFamily, ...typography.meta },
  card: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.md, backgroundColor: colors.background },
  selected: { borderColor: colors.primaryStrong, backgroundColor: colors.primarySoft },
  pressed: { borderColor: colors.primaryStrong, backgroundColor: colors.primarySoft },
  marker: { minWidth: 28, minHeight: 28, padding: 4, borderRadius: radius.pill, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  selectedMarker: { backgroundColor: colors.primaryStrong },
  number: { color: colors.textSecondary, fontFamily, ...typography.meta },
  copy: { flex: 1, minWidth: 0, gap: 4 },
  title: { color: colors.text, fontFamily, ...typography.bodyStrong },
  detail: { color: colors.textSecondary, fontFamily, ...typography.meta },
  selectedText: { color: colors.primaryStrong, fontFamily, ...typography.meta },
});
