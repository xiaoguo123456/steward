import { useGetMediaAsset } from '@steward/api-client';
import { Image } from 'expo-image';
import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AiFab } from '@/components/ui/ai-fab';
import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { NavHeader } from '@/components/ui/nav-header';
import { ModalSheet } from '@/components/ui/modal-sheet';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';
import type { TripAgendaItem, TripBooking, TripChecklistItem, TripPlan } from './trip-data';

type DetailTab = 'schedule' | 'bookings' | 'checklist';

const detailTabs: { id: DetailTab; label: string }[] = [
  { id: 'schedule', label: '安排' },
  { id: 'bookings', label: '预订' },
  { id: 'checklist', label: '清单' },
];

function SegmentedTabs({ value, onChange }: { value: DetailTab; onChange: (value: DetailTab) => void }) {
  return (
    <View accessibilityRole="tablist" style={styles.segmentedTabs}>
      {detailTabs.map((tab) => {
        const selected = value === tab.id;
        return (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            key={tab.id}
            onPress={() => onChange(tab.id)}
            style={({ pressed }) => [
              styles.segmentedTab,
              selected && styles.segmentedTabSelected,
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.segmentedLabel, selected && styles.segmentedLabelSelected]}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function AgendaRow({ item, last }: { item: TripAgendaItem; last: boolean }) {
  return (
    <View style={styles.agendaRow}>
      <View style={styles.agendaTimeColumn}>
        <Text style={styles.agendaTime}>{item.time}</Text>
        {item.endTime ? <Text style={styles.agendaEndTime}>{item.endTime}</Text> : null}
      </View>
      <View style={styles.timelineMarker}>
        <View style={[styles.timelineDot, { borderColor: item.color }]} />
        {!last ? <View style={styles.timelineLine} /> : null}
      </View>
      <View style={styles.agendaMain}>
        <View style={[styles.agendaIcon, { backgroundColor: item.soft }]}>
          <AppIcon color={item.color} name={item.icon} size={18} />
        </View>
        <View style={styles.agendaCopy}>
          <Text style={styles.agendaTitle}>{item.title}</Text>
          {item.meta ? <Text style={styles.agendaMeta}>{item.meta}</Text> : null}
        </View>
      </View>
    </View>
  );
}

function BookingRow({ booking, onPress }: { booking: TripBooking; onPress: () => void }) {
  return (
    <Pressable
      accessibilityLabel={`${booking.title}，${booking.status}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.bookingRow, pressed && styles.pressed]}
    >
      <View style={[styles.bookingIcon, { backgroundColor: booking.soft }]}>
        <AppIcon color={booking.color} name={booking.icon} size={19} />
      </View>
      <View style={styles.bookingCopy}>
        <Text style={styles.bookingTitle}>{booking.title}</Text>
        <Text style={styles.bookingMeta}>{booking.meta}</Text>
      </View>
      <Text style={styles.bookingStatus}>{booking.status}</Text>
      <AppIcon color={colors.borderStrong} name="chevron-forward" size={16} />
    </Pressable>
  );
}

function BookingMedia({ mediaId }: { mediaId: string }) {
  const asset = useGetMediaAsset(mediaId);
  const url = asset.data?.data.read_url;
  if (!url) return <View style={styles.mediaPlaceholder}><AppIcon color={colors.textTertiary} name="image-outline" size={22} /></View>;
  return <Image contentFit="cover" source={{ uri: url }} style={styles.ticketImage} />;
}

function BookingDetailSheet({ booking, onClose }: { booking: TripBooking | null; onClose: () => void }) {
  const rows = booking ? [
    booking.serviceNumber ? ['班次', booking.serviceNumber] : null,
    booking.origin && booking.destination ? ['路线', `${booking.origin} — ${booking.destination}`] : null,
    booking.startAt ? ['开始', formatBookingTime(booking.startAt)] : null,
    booking.endAt ? ['结束', formatBookingTime(booking.endAt)] : null,
    booking.seat ? ['座位', booking.seat] : null,
    booking.location && booking.kind === 'lodging' ? ['地点', booking.location] : null,
  ].filter((row): row is string[] => Boolean(row)) : [];

  return (
    <Modal animationType="fade" onRequestClose={onClose} statusBarTranslucent transparent visible={Boolean(booking)}>
      <ModalSheet maxHeight="78%" onClose={onClose}>
        {booking ? (
          <>
            <View style={styles.sheetHeader}>
              <View style={[styles.bookingIcon, { backgroundColor: booking.soft }]}>
                <AppIcon color={booking.color} name={booking.icon} size={19} />
              </View>
              <View style={styles.sheetTitleCopy}>
                <Text accessibilityRole="header" style={styles.sheetTitle}>{booking.title}</Text>
                <Text style={styles.sheetStatus}>{booking.status}</Text>
              </View>
              <Pressable accessibilityLabel="关闭预订详情" onPress={onClose} style={styles.sheetClose}>
                <AppIcon name="close" size={22} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.bookingSheetBody} showsVerticalScrollIndicator={false}>
              {rows.map(([label, value]) => (
                <View key={label} style={styles.detailRow}>
                  <Text style={styles.detailLabel}>{label}</Text>
                  <Text selectable style={styles.detailValue}>{value}</Text>
                </View>
              ))}
              {booking.attachmentMediaIds.length ? (
                <View style={styles.ticketSection}>
                  <Text style={styles.detailLabel}>票据</Text>
                  <ScrollView contentContainerStyle={styles.ticketList} horizontal showsHorizontalScrollIndicator={false}>
                    {booking.attachmentMediaIds.map((mediaId) => <BookingMedia key={mediaId} mediaId={mediaId} />)}
                  </ScrollView>
                </View>
              ) : null}
            </ScrollView>
          </>
        ) : null}
      </ModalSheet>
    </Modal>
  );
}

function formatBookingTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function ChecklistRow({
  item,
  checked,
  onToggle,
}: {
  item: TripChecklistItem;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={`${checked ? '取消完成' : '标记完成'}，${item.title}`}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      onPress={onToggle}
      style={({ pressed }) => [styles.checklistRow, pressed && styles.pressed]}
    >
      <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
        {checked ? <AppIcon color={colors.background} name="checkmark" size={14} /> : null}
      </View>
      <View style={styles.checklistCopy}>
        <Text style={[styles.checklistTitle, checked && styles.checklistTitleCompleted]}>
          {item.title}
        </Text>
        {item.meta ? <Text style={styles.checklistMeta}>{item.meta}</Text> : null}
      </View>
    </Pressable>
  );
}

export function TripDetail({
  trip,
  onToggleChecklistItem,
  onAddItem,
  onAddWithAI,
  failure,
}: {
  trip: TripPlan;
  onToggleChecklistItem?: (taskId: string, completed: boolean) => void | Promise<void>;
  onAddItem?: (kind: 'transport' | 'lodging' | 'activity', date?: string) => void;
  onAddWithAI?: () => void;
  failure?: string | null;
}) {
  const [activeTab, setActiveTab] = useState<DetailTab>('schedule');
  const [selectedDayId, setSelectedDayId] = useState(trip.days[0]?.id ?? '');
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [selectedBooking, setSelectedBooking] = useState<TripBooking | null>(null);
  // 完成状态直接来自 Task：清单项就是挂在这个项目下的普通任务，
  // 本地再存一份只会和别处看到的状态对不上。
  const completedChecklistIds = useMemo(
    () => new Set(trip.checklist.filter((item) => item.completed).map((item) => item.id)),
    [trip.checklist],
  );
  const selectedDay = trip.days.find((day) => day.id === selectedDayId) ?? trip.days[0];
  const completedCount = completedChecklistIds.size;
  const progress = trip.checklist.length > 0 ? completedCount / trip.checklist.length : 0;

  const checklistItems = useMemo(
    () => [...trip.checklist].sort((left, right) => {
      const leftCompleted = completedChecklistIds.has(left.id);
      const rightCompleted = completedChecklistIds.has(right.id);
      return Number(leftCompleted) - Number(rightCompleted);
    }),
    [completedChecklistIds, trip.checklist],
  );

  const toggleChecklist = (itemId: string) => {
    onToggleChecklistItem?.(itemId, !completedChecklistIds.has(itemId));
  };

  return (
    <AppScreen includeBottomInset>
      <NavHeader
        right={(
          <Pressable
            accessibilityLabel="新增行程安排"
            accessibilityRole="button"
            hitSlop={10}
            onPress={() => setShowAddMenu(true)}
            style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}
          >
            <AppIcon color={colors.primaryStrong} name="add" size={25} />
          </Pressable>
        )}
        title={trip.title}
      />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.summary}>
          <View style={styles.summaryIcon}>
            <AppIcon color={colors.primaryStrong} name="location-outline" size={21} />
          </View>
          <View style={styles.summaryCopy}>
            <Text style={styles.summaryDestination}>{trip.destination}</Text>
            <Text style={styles.summaryDate}>{trip.dateRange} · {trip.duration}</Text>
          </View>
          <View style={styles.summaryStatus}>
            <Text style={styles.summaryStatusText}>{trip.statusLabel}</Text>
          </View>
        </View>

        {trip.notes ? (
          <View style={styles.tripNotes}>
            <AppIcon color={colors.primaryStrong} name="information-circle-outline" size={19} />
            <View style={styles.tripNotesCopy}>
              <Text style={styles.tripNotesTitle}>注意事项</Text>
              <Text style={styles.tripNotesText}>{trip.notes}</Text>
            </View>
          </View>
        ) : null}

        <SegmentedTabs onChange={setActiveTab} value={activeTab} />
        {failure ? <Text accessibilityRole="alert" style={styles.failure}>{failure}</Text> : null}

        {activeTab === 'schedule' ? (
          <View>
            <ScrollView
              contentContainerStyle={styles.dayTabs}
              horizontal
              showsHorizontalScrollIndicator={false}
            >
              {trip.days.map((day) => {
                const selected = day.id === selectedDay?.id;
                return (
                  <Pressable
                    accessibilityLabel={`${day.date}${day.weekday}${day.label ? `，${day.label}` : ''}`}
                    accessibilityRole="tab"
                    accessibilityState={{ selected }}
                    key={day.id}
                    onPress={() => setSelectedDayId(day.id)}
                    style={({ pressed }) => [styles.dayTab, pressed && styles.pressed]}
                  >
                    <Text style={[styles.dayDate, selected && styles.dayDateSelected]}>{day.date}</Text>
                    <Text style={[styles.dayMeta, selected && styles.dayMetaSelected]}>
                      {day.label ? `${day.weekday} · ${day.label}` : day.weekday}
                    </Text>
                    {selected ? <View style={styles.dayIndicator} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
            <View style={styles.agendaList}>
              {selectedDay?.agenda.length ? selectedDay.agenda.map((item, index) => (
                <AgendaRow
                  item={item}
                  key={item.id}
                  last={index === selectedDay.agenda.length - 1}
                />
              )) : <Text style={styles.emptyText}>当天还没有安排</Text>}
            </View>
          </View>
        ) : null}

        {activeTab === 'bookings' ? (
          <View style={styles.panelSection}>
            <View style={styles.panelHeading}>
              <Text accessibilityRole="header" style={styles.panelTitle}>预订信息</Text>
              <Text style={styles.panelCount}>{trip.bookings.length} 项</Text>
            </View>
            <View style={styles.bookingList}>
              {trip.bookings.length ? trip.bookings.map((booking) => (
                <BookingRow booking={booking} key={booking.id} onPress={() => setSelectedBooking(booking)} />
              )) : <Text style={styles.emptyText}>还没有交通或住宿预订</Text>}
            </View>
          </View>
        ) : null}

        {activeTab === 'checklist' ? (
          <View style={styles.panelSection}>
            <View style={styles.checklistHeading}>
              <View>
                <Text accessibilityRole="header" style={styles.panelTitle}>行前清单</Text>
                <Text style={styles.checklistProgressText}>
                  已完成 {completedCount}/{trip.checklist.length}
                </Text>
              </View>
              <Text style={styles.progressPercent}>{Math.round(progress * 100)}%</Text>
            </View>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
            </View>
            <View style={styles.checklistList}>
              {checklistItems.map((item) => (
                <ChecklistRow
                  checked={completedChecklistIds.has(item.id)}
                  item={item}
                  key={item.id}
                  onToggle={() => toggleChecklist(item.id)}
                />
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>
      <AiFab />
      <Modal animationType="fade" onRequestClose={() => setShowAddMenu(false)} statusBarTranslucent transparent visible={showAddMenu}>
        <ModalSheet maxHeight="58%" onClose={() => setShowAddMenu(false)}>
          <View style={styles.addMenuHeader}>
            <Text accessibilityRole="header" style={styles.addMenuTitle}>新增安排</Text>
          </View>
          <View style={styles.addMenuList}>
            {([
              ['transport', '交通', 'train-outline', '#3978B8', '#EAF4FF'],
              ['lodging', '住宿', 'bed-outline', '#7657C8', '#F2EEFF'],
              ['activity', '活动', 'ticket-outline', '#D56C28', '#FFF1E7'],
            ] as const).map(([kind, label, icon, color, soft]) => (
              <Pressable
                accessibilityRole="button"
                key={kind}
                onPress={() => {
                  setShowAddMenu(false);
                  onAddItem?.(kind, selectedDay?.id);
                }}
                style={({ pressed }) => [styles.addMenuRow, pressed && styles.pressed]}
              >
                <View style={[styles.addMenuIcon, { backgroundColor: soft }]}>
                  <AppIcon color={color} name={icon} size={20} />
                </View>
                <Text style={styles.addMenuLabel}>{label}</Text>
                <AppIcon color={colors.borderStrong} name="chevron-forward" size={16} />
              </Pressable>
            ))}
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setShowAddMenu(false);
                onAddWithAI?.();
              }}
              style={({ pressed }) => [styles.addMenuRow, pressed && styles.pressed]}
            >
              <View style={[styles.addMenuIcon, { backgroundColor: colors.primarySoft }]}>
                <AppIcon color={colors.primaryStrong} name="sparkles-outline" size={20} />
              </View>
              <Text style={styles.addMenuLabel}>AI 识别票据</Text>
              <AppIcon color={colors.borderStrong} name="chevron-forward" size={16} />
            </Pressable>
          </View>
        </ModalSheet>
      </Modal>
      <BookingDetailSheet booking={selectedBooking} onClose={() => setSelectedBooking(null)} />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingBottom: 96,
  },
  addButton: {
    width: 44,
    height: 44,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  failure: { marginTop: 12, color: colors.danger, fontFamily, ...typography.meta },
  summary: {
    minHeight: 86,
    marginTop: 6,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.lg,
    backgroundColor: '#F2F8F5',
  },
  summaryIcon: {
    width: 42,
    height: 42,
    marginRight: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.background,
  },
  summaryCopy: {
    flex: 1,
    minWidth: 0,
  },
  summaryDestination: {
    color: colors.text,
    fontFamily,
    ...typography.bodyStrong,
  },
  summaryDate: {
    marginTop: 2,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  summaryStatus: {
    minHeight: 28,
    marginLeft: 10,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.primaryTrack,
  },
  summaryStatusText: {
    color: colors.primaryStrong,
    fontFamily,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '600',
  },
  tripNotes: {
    minHeight: 58,
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
  },
  tripNotesCopy: {
    minWidth: 0,
    flex: 1,
  },
  tripNotesTitle: {
    color: colors.text,
    fontFamily,
    ...typography.label,
    fontWeight: '600',
  },
  tripNotesText: {
    marginTop: 2,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  segmentedTabs: {
    minHeight: 46,
    marginTop: 18,
    padding: 4,
    flexDirection: 'row',
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  segmentedTab: {
    minHeight: 38,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  segmentedTabSelected: {
    backgroundColor: colors.background,
  },
  segmentedLabel: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.label,
  },
  segmentedLabelSelected: {
    color: colors.primaryStrong,
    fontWeight: '600',
  },
  dayTabs: {
    minHeight: 76,
    marginTop: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  dayTab: {
    width: 92,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayDate: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.label,
  },
  dayDateSelected: {
    color: colors.text,
    fontWeight: '600',
  },
  dayMeta: {
    marginTop: 3,
    color: colors.textTertiary,
    fontFamily,
    fontSize: 11,
    lineHeight: 16,
  },
  dayMetaSelected: {
    color: colors.primaryStrong,
  },
  dayIndicator: {
    position: 'absolute',
    bottom: -1,
    width: 32,
    height: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  agendaList: {
    paddingTop: 12,
  },
  agendaRow: {
    minHeight: 82,
    flexDirection: 'row',
  },
  agendaTime: {
    color: colors.text,
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
  },
  agendaTimeColumn: {
    width: 52,
    paddingTop: 4,
  },
  agendaEndTime: {
    marginTop: 2,
    color: colors.textTertiary,
    fontFamily,
    fontSize: 11,
    lineHeight: 16,
    fontVariant: ['tabular-nums'],
  },
  timelineMarker: {
    width: 18,
    alignItems: 'center',
  },
  timelineDot: {
    zIndex: 1,
    width: 10,
    height: 10,
    marginTop: 8,
    borderRadius: radius.pill,
    borderWidth: 2.5,
    backgroundColor: colors.background,
  },
  timelineLine: {
    position: 'absolute',
    top: 18,
    bottom: -8,
    width: StyleSheet.hairlineWidth,
    backgroundColor: colors.borderStrong,
  },
  agendaMain: {
    flex: 1,
    minWidth: 0,
    paddingBottom: 16,
    flexDirection: 'row',
  },
  agendaIcon: {
    width: 38,
    height: 38,
    marginRight: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
  },
  agendaCopy: {
    flex: 1,
    minWidth: 0,
    paddingTop: 1,
  },
  agendaTitle: {
    color: colors.text,
    fontFamily,
    ...typography.bodyStrong,
  },
  agendaMeta: {
    marginTop: 3,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  panelSection: {
    marginTop: 22,
  },
  panelHeading: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  panelTitle: {
    color: colors.text,
    fontFamily,
    ...typography.section,
  },
  panelCount: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  bookingList: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  bookingRow: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  bookingIcon: {
    width: 40,
    height: 40,
    marginRight: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
  },
  bookingCopy: {
    flex: 1,
    minWidth: 0,
  },
  bookingTitle: {
    color: colors.text,
    fontFamily,
    ...typography.bodyStrong,
  },
  bookingMeta: {
    marginTop: 2,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  bookingStatus: {
    marginLeft: 8,
    marginRight: 5,
    color: colors.primaryStrong,
    fontFamily,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '600',
  },
  emptyText: {
    paddingVertical: 30,
    color: colors.textTertiary,
    fontFamily,
    ...typography.body,
    textAlign: 'center',
  },
  addMenuHeader: {
    minHeight: 54,
    paddingHorizontal: 18,
    justifyContent: 'center',
  },
  addMenuTitle: {
    color: colors.text,
    fontFamily,
    ...typography.section,
  },
  addMenuList: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  addMenuRow: {
    minHeight: 62,
    paddingHorizontal: 4,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  addMenuIcon: {
    width: 38,
    height: 38,
    marginRight: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
  },
  addMenuLabel: {
    minWidth: 0,
    flex: 1,
    color: colors.text,
    fontFamily,
    ...typography.bodyStrong,
  },
  sheetHeader: {
    minHeight: 66,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  sheetTitleCopy: { minWidth: 0, flex: 1 },
  sheetTitle: { color: colors.text, fontFamily, ...typography.bodyStrong },
  sheetStatus: { marginTop: 1, color: colors.primaryStrong, fontFamily, ...typography.meta },
  sheetClose: { width: 44, height: 44, alignItems: 'flex-end', justifyContent: 'center' },
  bookingSheetBody: { paddingHorizontal: 16, paddingBottom: 20 },
  detailRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  detailLabel: { width: 58, color: colors.textSecondary, fontFamily, ...typography.meta },
  detailValue: { minWidth: 0, flex: 1, color: colors.text, fontFamily, ...typography.body },
  ticketSection: { paddingTop: 16 },
  ticketList: { paddingTop: 10, gap: 10 },
  ticketImage: { width: 180, height: 112, borderRadius: radius.md, backgroundColor: colors.surface },
  mediaPlaceholder: { width: 180, height: 112, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.surface },
  checklistHeading: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  checklistProgressText: {
    marginTop: 3,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  progressPercent: {
    color: colors.primaryStrong,
    fontFamily,
    ...typography.bodyStrong,
  },
  progressTrack: {
    height: 5,
    marginTop: 13,
    overflow: 'hidden',
    borderRadius: radius.pill,
    backgroundColor: colors.primaryTrack,
  },
  progressFill: {
    height: '100%',
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  checklistList: {
    marginTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  checklistRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  checkbox: {
    width: 22,
    height: 22,
    marginRight: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
  },
  checkboxChecked: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  checklistCopy: {
    flex: 1,
    minWidth: 0,
  },
  checklistTitle: {
    color: colors.text,
    fontFamily,
    ...typography.body,
  },
  checklistTitleCompleted: {
    color: colors.textTertiary,
    textDecorationLine: 'line-through',
  },
  checklistMeta: {
    marginTop: 1,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  pressed: {
    opacity: 0.62,
  },
});
