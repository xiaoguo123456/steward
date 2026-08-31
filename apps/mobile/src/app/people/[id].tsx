import {
  errorMessage,
  type Event,
  type PersonInteraction,
  useGetPerson,
  useListPersonEvents,
  useListPersonInteractions,
} from '@steward/api-client';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AppIcon } from '@/components/ui/icon';
import { AppScreen } from '@/components/ui/app-screen';
import { NavHeader } from '@/components/ui/nav-header';
import { StatePanel } from '@/components/ui/state-panel';
import {
  eventTimestamp,
  formatEventTime,
  formatInteractionTime,
  interactionTypeLabels,
  relationshipGroupLabels,
} from '@/features/relationships/model';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';

export default function PersonDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const personID = Array.isArray(params.id) ? params.id[0] : params.id;
  const personQuery = useGetPerson(personID ?? '', { query: { enabled: Boolean(personID), staleTime: 30_000 } });
  const interactionsQuery = useListPersonInteractions(personID ?? '', { limit: 20 }, { query: { enabled: Boolean(personID) } });
  const eventsQuery = useListPersonEvents(personID ?? '', { limit: 50 }, { query: { enabled: Boolean(personID) } });

  if (personQuery.isPending) {
    return (
      <AppScreen includeBottomInset>
        <NavHeader title="亲友详情" />
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      </AppScreen>
    );
  }

  const person = personQuery.data?.data;
  if (!person || personQuery.isError) {
    return (
      <AppScreen includeBottomInset>
        <NavHeader title="亲友详情" />
        <View style={styles.center}>
          <StatePanel
            actionLabel="返回亲友"
            icon="person-outline"
            message={errorMessage(personQuery.error, '这位亲友可能已经被删除。')}
            onAction={() => router.back()}
            title="没有找到"
          />
        </View>
      </AppScreen>
    );
  }

  const relation = person.relationship_label || relationshipGroupLabels[person.relationship_group];
  const referenceTime = eventsQuery.dataUpdatedAt || personQuery.dataUpdatedAt;
  const upcomingEvents = (eventsQuery.data?.data ?? [])
    .filter((event) => eventTimestamp(event) >= referenceTime)
    .sort((left, right) => eventTimestamp(left) - eventTimestamp(right));
  const interactions = interactionsQuery.data?.data ?? [];

  return (
    <AppScreen includeBottomInset>
      <NavHeader
        right={(
          <Pressable
            accessibilityLabel="编辑亲友资料"
            accessibilityRole="button"
            hitSlop={10}
            onPress={() => router.push({ pathname: '/people/[id]/edit', params: { id: person.id } })}
          >
            <AppIcon color={colors.primaryStrong} name="create-outline" size={22} />
          </Pressable>
        )}
        title="亲友详情"
      />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.identity}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{person.name.trim().slice(0, 1)}</Text></View>
          <Text style={styles.name}>{person.name}</Text>
          <Text style={styles.relation}>{relation}</Text>
        </View>

        <View style={styles.actions}>
          <QuickAction
            icon="chatbubble-ellipses-outline"
            label="记互动"
            onPress={() => router.push({ pathname: '/people/[id]/interaction/new', params: { id: person.id } })}
          />
          <QuickAction
            icon="calendar-outline"
            label="加事件"
            onPress={() => router.push({ pathname: '/people/[id]/event/new', params: { id: person.id } })}
          />
        </View>

        <DetailSection title="接下来">
          {eventsQuery.isPending ? (
            <ActivityIndicator color={colors.primary} style={styles.inlineLoader} />
          ) : eventsQuery.isError ? (
            <InlineFailure onRetry={() => void eventsQuery.refetch()} />
          ) : upcomingEvents.length === 0 ? (
            <EmptyRow label="还没有安排" />
          ) : upcomingEvents.map((event, index) => (
            <EventRow divider={index < upcomingEvents.length - 1} event={event} key={event.id} />
          ))}
        </DetailSection>

        <DetailSection title="最近互动">
          {interactionsQuery.isPending ? (
            <ActivityIndicator color={colors.primary} style={styles.inlineLoader} />
          ) : interactionsQuery.isError ? (
            <InlineFailure onRetry={() => void interactionsQuery.refetch()} />
          ) : interactions.length === 0 ? (
            <EmptyRow label="还没有互动记录" />
          ) : interactions.map((interaction, index) => (
            <InteractionRow
              divider={index < interactions.length - 1}
              interaction={interaction}
              key={interaction.id}
            />
          ))}
        </DetailSection>

        {person.note ? (
          <DetailSection title="关于TA">
            <Text style={styles.note}>{person.note}</Text>
          </DetailSection>
        ) : null}
      </ScrollView>
    </AppScreen>
  );
}

function QuickAction({ icon, label, onPress }: { icon: Parameters<typeof AppIcon>[0]['name']; label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.quickAction, pressed && styles.pressed]}
    >
      <View style={styles.quickIcon}><AppIcon color={colors.primaryStrong} name={icon} size={22} /></View>
      <Text style={styles.quickLabel}>{label}</Text>
    </Pressable>
  );
}

function DetailSection({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function EventRow({ divider, event }: { divider: boolean; event: Event }) {
  return (
    <View style={[styles.timelineRow, divider && styles.divider]}>
      <View style={styles.timelineIcon}>
        <AppIcon color={colors.primaryStrong} name={event.event_kind === 'important_date' ? 'gift-outline' : 'calendar-outline'} size={18} />
      </View>
      <View style={styles.timelineCopy}>
        <Text numberOfLines={2} style={styles.rowTitle}>{event.title}</Text>
        <Text style={styles.rowMeta}>{formatEventTime(event)}{event.recurrence === 'yearly' ? ' · 每年' : ''}</Text>
      </View>
    </View>
  );
}

function InteractionRow({ divider, interaction }: { divider: boolean; interaction: PersonInteraction }) {
  return (
    <View style={[styles.timelineRow, divider && styles.divider]}>
      <View style={styles.timelineIcon}>
        <AppIcon color={colors.primaryStrong} name="chatbubble-outline" size={18} />
      </View>
      <View style={styles.timelineCopy}>
        <Text style={styles.rowTitle}>{interaction.summary}</Text>
        <Text style={styles.rowMeta}>{interactionTypeLabels[interaction.interaction_type]} · {formatInteractionTime(interaction.occurred_at)}</Text>
        {interaction.note ? <Text style={styles.rowNote}>{interaction.note}</Text> : null}
      </View>
    </View>
  );
}

function EmptyRow({ label }: { label: string }) {
  return <Text style={styles.empty}>{label}</Text>;
}

function InlineFailure({ onRetry }: { onRetry: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onRetry} style={styles.failure}>
      <Text style={styles.failureText}>加载失败，点此重试</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 36, gap: 28 },
  identity: { alignItems: 'center' },
  avatar: { width: 84, height: 84, alignItems: 'center', justifyContent: 'center', borderRadius: 42, backgroundColor: colors.primarySoft },
  avatarText: { color: colors.primaryStrong, fontFamily, fontSize: 30, lineHeight: 38, fontWeight: '700' },
  name: { marginTop: 13, color: colors.text, fontFamily, ...typography.detail },
  relation: { marginTop: 2, color: colors.textSecondary, fontFamily, ...typography.meta },
  actions: { flexDirection: 'row', gap: 12 },
  quickAction: { minHeight: 72, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, borderRadius: radius.lg, backgroundColor: colors.primarySoft },
  quickIcon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  quickLabel: { color: colors.primaryStrong, fontFamily, ...typography.bodyStrong },
  section: { gap: 10 },
  sectionTitle: { color: colors.text, fontFamily, ...typography.section },
  sectionBody: { overflow: 'hidden', borderRadius: radius.lg, backgroundColor: colors.surfaceSubtle },
  timelineRow: { minHeight: 72, paddingHorizontal: 14, paddingVertical: 13, flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  timelineIcon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: colors.background },
  timelineCopy: { minWidth: 0, flex: 1, gap: 2 },
  rowTitle: { color: colors.text, fontFamily, ...typography.bodyStrong },
  rowMeta: { color: colors.textSecondary, fontFamily, ...typography.meta },
  rowNote: { marginTop: 4, color: colors.textSecondary, fontFamily, ...typography.body },
  note: { padding: 16, color: colors.text, fontFamily, ...typography.body },
  empty: { padding: 18, color: colors.textSecondary, fontFamily, ...typography.body },
  failure: { minHeight: 52, alignItems: 'center', justifyContent: 'center' },
  failureText: { color: colors.danger, fontFamily, ...typography.meta },
  inlineLoader: { marginVertical: 26 },
  pressed: { opacity: 0.72 },
});
