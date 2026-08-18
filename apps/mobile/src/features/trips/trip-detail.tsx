import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AiFab } from '@/components/ui/ai-fab';
import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { NavHeader } from '@/components/ui/nav-header';
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
      <Text style={styles.agendaTime}>{item.time}</Text>
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
          <Text style={styles.agendaMeta}>{item.meta}</Text>
        </View>
      </View>
    </View>
  );
}

function BookingRow({ booking }: { booking: TripBooking }) {
  return (
    <Pressable
      accessibilityLabel={`${booking.title}，${booking.status}`}
      accessibilityRole="button"
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

export function TripDetail({ trip }: { trip: TripPlan }) {
  const [activeTab, setActiveTab] = useState<DetailTab>('schedule');
  const [selectedDayId, setSelectedDayId] = useState(trip.days[0]?.id ?? '');
  const [completedChecklistIds, setCompletedChecklistIds] = useState(
    () => new Set(trip.checklist.filter((item) => item.completed).map((item) => item.id)),
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
    setCompletedChecklistIds((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  return (
    <AppScreen includeBottomInset>
      <NavHeader title={trip.title} />
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

        <SegmentedTabs onChange={setActiveTab} value={activeTab} />

        {activeTab === 'schedule' ? (
          <View>
            <View style={styles.dayTabs}>
              {trip.days.map((day) => {
                const selected = day.id === selectedDay?.id;
                return (
                  <Pressable
                    accessibilityLabel={`${day.date}${day.weekday}，${day.label}`}
                    accessibilityRole="tab"
                    accessibilityState={{ selected }}
                    key={day.id}
                    onPress={() => setSelectedDayId(day.id)}
                    style={({ pressed }) => [styles.dayTab, pressed && styles.pressed]}
                  >
                    <Text style={[styles.dayDate, selected && styles.dayDateSelected]}>{day.date}</Text>
                    <Text style={[styles.dayMeta, selected && styles.dayMetaSelected]}>
                      {day.weekday} · {day.label}
                    </Text>
                    {selected ? <View style={styles.dayIndicator} /> : null}
                  </Pressable>
                );
              })}
            </View>
            <View style={styles.agendaList}>
              {selectedDay?.agenda.map((item, index) => (
                <AgendaRow
                  item={item}
                  key={item.id}
                  last={index === selectedDay.agenda.length - 1}
                />
              ))}
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
              {trip.bookings.map((booking) => (
                <BookingRow booking={booking} key={booking.id} />
              ))}
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
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingBottom: 96,
  },
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
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  dayTab: {
    flex: 1,
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
    width: 48,
    paddingTop: 4,
    color: colors.text,
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
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
