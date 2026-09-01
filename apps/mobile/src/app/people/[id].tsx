import {
  errorMessage,
  type Event,
  useGetPerson,
  useListPersonEvents,
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

import { AppButton } from '@/components/ui/app-button';
import { AppIcon } from '@/components/ui/icon';
import { AppScreen } from '@/components/ui/app-screen';
import { NavHeader } from '@/components/ui/nav-header';
import { SectionTitle } from '@/components/ui/section-title';
import { StatePanel } from '@/components/ui/state-panel';
import {
  eventTimestamp,
  formatEventTime,
  relationshipGroupLabels,
} from '@/features/relationships/model';
import { colors, fontFamily, radius, spacing, typography } from '@/theme/tokens';

export default function PersonDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const personID = Array.isArray(params.id) ? params.id[0] : params.id;
  const personQuery = useGetPerson(personID ?? '', { query: { enabled: Boolean(personID), staleTime: 30_000 } });
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
    .filter((event) => event.event_kind !== 'important_date' && eventTimestamp(event) >= referenceTime)
    .sort((left, right) => eventTimestamp(left) - eventTimestamp(right));
  const importantDates = (eventsQuery.data?.data ?? [])
    .filter((event) => event.event_kind === 'important_date')
    .sort((left, right) => eventTimestamp(left) - eventTimestamp(right));

  return (
    <AppScreen includeBottomInset>
      <NavHeader
        right={(
          <Pressable
            accessibilityLabel="编辑亲友资料"
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/people/[id]/edit', params: { id: person.id } })}
            style={({ pressed }) => [styles.editButton, pressed && styles.pressed]}
          >
            <AppIcon color={colors.primaryStrong} name="create-outline" size={22} />
          </Pressable>
        )}
        title="亲友详情"
      />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.identity}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{person.name.trim().slice(0, 1)}</Text></View>
          <View style={styles.identityCopy}>
            <Text style={styles.name}>{person.name}</Text>
            <Text style={styles.relation}>{relation}</Text>
          </View>
        </View>

        <AppButton
          compact
          icon="calendar-outline"
          label="添加事件"
          onPress={() => router.push({ pathname: '/people/[id]/event/new', params: { id: person.id } })}
        />

        <DetailSection title="近期安排">
          {eventsQuery.isPending ? (
            <ActivityIndicator color={colors.primary} style={styles.inlineLoader} />
          ) : eventsQuery.isError ? (
            <InlineFailure onRetry={() => void eventsQuery.refetch()} />
          ) : upcomingEvents.length === 0 ? (
            <EmptyRow label="暂无安排" />
          ) : upcomingEvents.map((event, index) => (
            <EventRow divider={index < upcomingEvents.length - 1} event={event} key={event.id} />
          ))}
        </DetailSection>

        <DetailSection title="重要日">
          {eventsQuery.isPending ? (
            <ActivityIndicator color={colors.primary} style={styles.inlineLoader} />
          ) : eventsQuery.isError ? (
            <InlineFailure onRetry={() => void eventsQuery.refetch()} />
          ) : importantDates.length === 0 ? (
            <EmptyRow label="暂无重要日" />
          ) : importantDates.map((event, index) => (
            <EventRow divider={index < importantDates.length - 1} event={event} key={event.id} />
          ))}
        </DetailSection>

        {person.note ? (
          <View style={styles.about}>
            <SectionTitle title="关于TA" />
            <Text style={styles.note}>{person.note}</Text>
          </View>
        ) : null}
      </ScrollView>
    </AppScreen>
  );
}

function DetailSection({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <View style={styles.section}>
      <SectionTitle title={title} />
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
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.xl, paddingBottom: 40, gap: spacing.xxxl },
  editButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill },
  identity: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  identityCopy: { minWidth: 0, flex: 1, gap: spacing.xs },
  avatar: { width: 72, height: 72, alignItems: 'center', justifyContent: 'center', borderRadius: 36, backgroundColor: colors.primarySoft },
  avatarText: { color: colors.primaryStrong, fontFamily, fontSize: 28, lineHeight: 36, fontWeight: '700' },
  name: { color: colors.text, fontFamily, ...typography.detail },
  relation: { color: colors.textSecondary, fontFamily, ...typography.body },
  section: { gap: spacing.xs },
  sectionBody: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  timelineRow: { minHeight: 68, paddingVertical: spacing.md, flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  timelineIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.primarySoft },
  timelineCopy: { minWidth: 0, flex: 1, gap: 2 },
  rowTitle: { color: colors.text, fontFamily, ...typography.bodyStrong },
  rowMeta: { color: colors.textSecondary, fontFamily, ...typography.meta },
  about: { gap: spacing.xs },
  note: { paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, color: colors.text, fontFamily, ...typography.body },
  empty: { paddingVertical: spacing.lg, color: colors.textSecondary, fontFamily, ...typography.body },
  failure: { minHeight: 52, alignItems: 'center', justifyContent: 'center' },
  failureText: { color: colors.danger, fontFamily, ...typography.meta },
  inlineLoader: { marginVertical: 26 },
  pressed: { opacity: 0.72 },
});
