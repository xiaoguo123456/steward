import type { Notification, NotificationType } from '@steward/api-client';
import { type Href, useRouter } from 'expo-router';
import { useMemo } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppIcon } from '@/components/ui/icon';
import { StatePanel } from '@/components/ui/state-panel';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';
import { formatRelativeTime } from '@/utils/format';

import { groupNotifications, notificationDestination } from './notification-model';
import { useNotifications } from './use-notifications';

const notificationIcons: Record<NotificationType, React.ComponentProps<typeof AppIcon>['name']> = {
  event_reminder: 'calendar-outline',
  task_due: 'checkbox',
  daily_brief: 'sunny-outline',
  project_risk: 'alert-circle-outline',
  weekly_review: 'refresh-outline',
};

export function NotificationsContent() {
  const router = useRouter();
  const notifications = useNotifications();
  const groups = useMemo(() => groupNotifications(notifications.items), [notifications.items]);

  if (notifications.initialLoading) return <NotificationSkeleton />;
  if (notifications.initialFailure) {
    return (
      <View style={styles.stateWrap}>
        <StatePanel
          actionLabel="重试"
          icon="cloud-offline-outline"
          message={notifications.initialFailure}
          onAction={() => void notifications.refresh()}
          title="通知加载失败"
        />
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          onRefresh={() => void notifications.refresh()}
          refreshing={notifications.refreshing}
          tintColor={colors.primary}
        />
      }
      showsVerticalScrollIndicator={false}
    >
      {notifications.items.length === 0 ? (
        <StatePanel
          compact
          icon="notifications-outline"
          message="任务、日程和复盘有新进展时，会集中显示在这里。"
          title="还没有通知"
        />
      ) : (
        groups.map((group) => (
          <View key={group.key} style={styles.group}>
            <Text accessibilityRole="header" style={styles.groupTitle}>
              {group.title}
            </Text>
            <View style={styles.list}>
              {group.items.map((item, index) => (
                <NotificationRow
                  item={item}
                  key={item.id}
                  onPress={() => {
                    notifications.markRead(item);
                    if (!item.source_deleted) {
                      router.push(notificationDestination(item.source_type, item.source_id) as Href);
                    }
                  }}
                  showDivider={index < group.items.length - 1}
                />
              ))}
            </View>
          </View>
        ))
      )}

      {notifications.pageFailure ? (
        <View accessibilityRole="alert" style={styles.inlineError}>
          <Text style={styles.inlineErrorText}>{notifications.pageFailure}</Text>
          {notifications.hasMore ? (
            <AppButton compact label="重试" onPress={notifications.loadMore} variant="text" />
          ) : null}
        </View>
      ) : null}

      {notifications.hasMore ? (
        <AppButton
          disabled={notifications.pageLoading}
          label={notifications.pageLoading ? '加载中…' : '加载更多'}
          onPress={notifications.loadMore}
          style={styles.loadMore}
          variant="secondary"
        />
      ) : null}
    </ScrollView>
  );
}

function NotificationRow({ item, onPress, showDivider }: {
  item: Notification;
  onPress: () => void;
  showDivider: boolean;
}) {
  const unread = item.read_at === null;
  const status = item.source_deleted ? '内容已删除' : item.body;

  return (
    <Pressable
      accessibilityHint={item.source_deleted ? '将标记为已读，不会打开详情' : '打开来源详情'}
      accessibilityLabel={`${unread ? '未读，' : '已读，'}${item.title}，${status}，${formatRelativeTime(item.occurred_at)}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        showDivider && styles.rowDivider,
        pressed && styles.rowPressed,
      ]}
    >
      <View style={[styles.typeIcon, unread && styles.typeIconUnread]}>
        <AppIcon
          color={unread ? colors.primaryStrong : colors.textSecondary}
          name={notificationIcons[item.type]}
          size={19}
        />
      </View>
      <View style={styles.rowCopy}>
        <View style={styles.titleLine}>
          {unread ? <View style={styles.unreadDot} /> : null}
          <Text numberOfLines={2} style={[styles.rowTitle, unread && styles.rowTitleUnread]}>
            {item.title}
          </Text>
        </View>
        <Text numberOfLines={2} style={[styles.rowBody, item.source_deleted && styles.deletedText]}>
          {status}
        </Text>
        <Text style={styles.time}>{formatRelativeTime(item.occurred_at)}</Text>
      </View>
      {!item.source_deleted ? (
        <AppIcon color={colors.borderStrong} name="chevron-forward" size={17} />
      ) : null}
    </Pressable>
  );
}

function NotificationSkeleton() {
  return (
    <View accessibilityLabel="正在加载通知" style={styles.skeletonWrap}>
      {[0, 1, 2, 3].map((item) => (
        <View key={item} style={styles.skeletonRow}>
          <View style={styles.skeletonIcon} />
          <View style={styles.skeletonCopy}>
            <View style={styles.skeletonTitle} />
            <View style={styles.skeletonBody} />
          </View>
        </View>
      ))}
      <ActivityIndicator color={colors.primary} style={styles.skeletonIndicator} />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingBottom: 36 },
  stateWrap: { flex: 1, padding: 16, justifyContent: 'center' },
  group: { marginTop: 18 },
  groupTitle: { marginBottom: 8, color: colors.textSecondary, fontFamily, ...typography.label },
  list: { borderRadius: radius.lg, backgroundColor: colors.surfaceSubtle, overflow: 'hidden' },
  row: { minHeight: 96, paddingVertical: 14, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowPressed: { backgroundColor: colors.surface },
  typeIcon: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  typeIconUnread: { backgroundColor: colors.primarySoft },
  rowCopy: { flex: 1, minWidth: 0 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  unreadDot: { width: 7, height: 7, borderRadius: radius.pill, backgroundColor: colors.danger },
  rowTitle: { flex: 1, color: colors.text, fontFamily, ...typography.body },
  rowTitleUnread: { ...typography.bodyStrong },
  rowBody: { marginTop: 2, color: colors.textSecondary, fontFamily, ...typography.meta },
  deletedText: { color: colors.textTertiary },
  time: { marginTop: 4, color: colors.textTertiary, fontFamily, ...typography.caption },
  inlineError: { marginTop: 14, paddingHorizontal: 14, minHeight: 48, borderRadius: radius.md, backgroundColor: colors.dangerSoft, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  inlineErrorText: { flex: 1, color: colors.danger, fontFamily, ...typography.meta },
  loadMore: { alignSelf: 'center', minWidth: 140, marginTop: 18 },
  skeletonWrap: { paddingHorizontal: 16, paddingTop: 18 },
  skeletonRow: { minHeight: 96, flexDirection: 'row', alignItems: 'center', gap: 12 },
  skeletonIcon: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.surface },
  skeletonCopy: { flex: 1, gap: 9 },
  skeletonTitle: { width: '58%', height: 16, borderRadius: radius.sm, backgroundColor: colors.surface },
  skeletonBody: { width: '78%', height: 12, borderRadius: radius.sm, backgroundColor: colors.surface },
  skeletonIndicator: { marginTop: 8 },
});
