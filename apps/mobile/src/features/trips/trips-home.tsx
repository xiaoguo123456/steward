import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AiFab } from '@/components/ui/ai-fab';
import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { NavHeader } from '@/components/ui/nav-header';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';
import { tripPlans, type TripPlan } from './trip-data';

function SectionHeading({ title, count }: { title: string; count: number }) {
  return (
    <View style={styles.sectionHeading}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionCount}>{count} 个</Text>
    </View>
  );
}

function TripCard({ trip, onPress }: { trip: TripPlan; onPress: () => void }) {
  const completedChecklist = trip.checklist.filter((item) => item.completed).length;
  const primaryStatus = trip.statusTone === 'primary';

  return (
    <Pressable
      accessibilityLabel={`${trip.title}，${trip.dateRange}，${trip.statusLabel}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.tripCard, pressed && styles.pressed]}
    >
      <View style={styles.tripCardTop}>
        <View style={styles.destinationLine}>
          <View style={styles.tripIcon}>
            <AppIcon color={colors.primaryStrong} name="airplane-outline" size={20} />
          </View>
          <Text style={styles.destination}>{trip.destination}</Text>
        </View>
        <View style={[styles.statusPill, !primaryStatus && styles.statusPillNeutral]}>
          <Text style={[styles.statusText, !primaryStatus && styles.statusTextNeutral]}>
            {trip.statusLabel}
          </Text>
        </View>
      </View>

      <Text numberOfLines={1} style={styles.tripTitle}>{trip.title}</Text>
      <Text style={styles.tripDate}>{trip.dateRange} · {trip.duration}</Text>

      <View style={styles.tripFooter}>
        <Text style={styles.tripMeta}>
          {trip.bookings.length} 项预订 · 行前清单 {completedChecklist}/{trip.checklist.length}
        </Text>
        <AppIcon color={colors.textTertiary} name="chevron-forward" size={17} />
      </View>
    </Pressable>
  );
}

function CompletedTripRow({ trip, onPress }: { trip: TripPlan; onPress: () => void }) {
  return (
    <Pressable
      accessibilityLabel={`查看历史行程${trip.title}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.completedRow, pressed && styles.pressed]}
    >
      <View style={styles.completedIcon}>
        <AppIcon color={colors.textSecondary} name="location-outline" size={19} />
      </View>
      <View style={styles.completedCopy}>
        <Text style={styles.completedTitle}>{trip.title}</Text>
        <Text style={styles.completedMeta}>{trip.dateRange} · {trip.duration}</Text>
      </View>
      <AppIcon color={colors.borderStrong} name="chevron-forward" size={17} />
    </Pressable>
  );
}

export function TripsHome() {
  const router = useRouter();
  const upcomingTrips = tripPlans.filter((trip) => trip.status === 'upcoming');
  const completedTrips = tripPlans.filter((trip) => trip.status === 'completed');
  const openTrip = (trip: TripPlan) => {
    router.push({ pathname: '/trips/[id]', params: { id: trip.id } });
  };

  return (
    <AppScreen includeBottomInset>
      <NavHeader title="行程" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <SectionHeading count={upcomingTrips.length} title="近期行程" />
        <View style={styles.upcomingList}>
          {upcomingTrips.map((trip) => (
            <TripCard key={trip.id} onPress={() => openTrip(trip)} trip={trip} />
          ))}
        </View>

        {completedTrips.length > 0 ? (
          <View style={styles.completedSection}>
            <SectionHeading count={completedTrips.length} title="历史行程" />
            <View style={styles.completedList}>
              {completedTrips.map((trip) => (
                <CompletedTripRow key={trip.id} onPress={() => openTrip(trip)} trip={trip} />
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
  sectionHeading: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    color: colors.text,
    fontFamily,
    ...typography.section,
  },
  sectionCount: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  upcomingList: {
    gap: 12,
  },
  tripCard: {
    minHeight: 190,
    padding: 18,
    borderRadius: radius.xl,
    backgroundColor: '#F2F8F5',
  },
  tripCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  destinationLine: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  tripIcon: {
    width: 36,
    height: 36,
    marginRight: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.background,
  },
  destination: {
    color: colors.primaryStrong,
    fontFamily,
    ...typography.label,
    fontWeight: '600',
  },
  statusPill: {
    minHeight: 28,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.primaryTrack,
  },
  statusPillNeutral: {
    backgroundColor: colors.surface,
  },
  statusText: {
    color: colors.primaryStrong,
    fontFamily,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '600',
  },
  statusTextNeutral: {
    color: colors.textSecondary,
  },
  tripTitle: {
    marginTop: 22,
    color: colors.text,
    fontFamily,
    fontSize: 22,
    lineHeight: 30,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  tripDate: {
    marginTop: 4,
    color: colors.textSecondary,
    fontFamily,
    ...typography.body,
  },
  tripFooter: {
    marginTop: 20,
    paddingTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#DCE7E1',
  },
  tripMeta: {
    flex: 1,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  completedSection: {
    marginTop: 22,
  },
  completedList: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  completedRow: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  completedIcon: {
    width: 40,
    height: 40,
    marginRight: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSubtle,
  },
  completedCopy: {
    flex: 1,
  },
  completedTitle: {
    color: colors.text,
    fontFamily,
    ...typography.bodyStrong,
  },
  completedMeta: {
    marginTop: 2,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  pressed: {
    opacity: 0.64,
  },
});
