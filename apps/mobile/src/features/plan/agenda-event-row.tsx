import type { Event } from '@steward/api-client';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppIcon } from '@/components/ui/icon';
import { colors, fontFamily } from '@/theme/tokens';
import { agendaEventTime } from './day-agenda';

/** 日程保留独立类型和详情入口，不显示任务完成圆圈。 */
export function AgendaEventRow({ event, timezone, date }: { event: Event; timezone: string; date: string }) {
  const router = useRouter();
  const type = event.event_kind === 'important_date' ? '重要日' : '日程';
  const time = agendaEventTime(event, timezone, date);
  return (
    <Pressable
      accessibilityLabel={`查看${type}：${event.title}，${time}`}
      accessibilityRole="button"
      onPress={() => router.push({ pathname: '/events/[id]', params: { id: event.id } })}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <AppIcon color={colors.primaryStrong} name={event.event_kind === 'important_date' ? 'gift-outline' : 'calendar-outline'} size={20} />
      <View style={styles.content}>
        <Text numberOfLines={2} style={styles.title}>{event.title}</Text>
        <Text style={styles.meta}>{type}{time ? ` · ${time}` : ''}</Text>
      </View>
      <AppIcon color={colors.textSecondary} name="chevron-forward" size={16} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 77, flexDirection: 'row', alignItems: 'center', gap: 13 },
  pressed: { opacity: 0.7 },
  content: { flex: 1 },
  title: { color: colors.text, fontFamily, fontSize: 15, lineHeight: 21, fontWeight: '500' },
  meta: { marginTop: 5, color: colors.textSecondary, fontFamily, fontSize: 12, lineHeight: 17 },
});
