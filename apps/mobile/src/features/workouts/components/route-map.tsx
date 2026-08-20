import { StyleSheet, Text, View } from 'react-native';

import { AppIcon } from '@/components/ui/icon';
import { colors, fontFamily, radius } from '@/theme/tokens';

import { workoutAccent } from '../workout-content';

type RouteMapProps = {
  compact?: boolean;
  showCurrent?: boolean;
};

const roadSegments = [
  { top: '12%', left: '-8%', width: '125%', rotate: '12deg' },
  { top: '31%', left: '-18%', width: '138%', rotate: '-17deg' },
  { top: '52%', left: '-4%', width: '115%', rotate: '8deg' },
  { top: '72%', left: '-16%', width: '138%', rotate: '-13deg' },
  { top: '42%', left: '4%', width: '94%', rotate: '82deg' },
  { top: '44%', left: '28%', width: '88%', rotate: '72deg' },
  { top: '46%', left: '51%', width: '94%', rotate: '98deg' },
] as const;

const routeSegments = [
  { top: '72%', left: '10%', width: '21%', rotate: '-18deg' },
  { top: '61%', left: '27%', width: '18%', rotate: '-61deg' },
  { top: '50%', left: '37%', width: '25%', rotate: '-28deg' },
  { top: '38%', left: '56%', width: '18%', rotate: '-55deg' },
  { top: '27%', left: '66%', width: '22%', rotate: '-20deg' },
] as const;

export function RouteMap({ compact = false, showCurrent = true }: RouteMapProps) {
  return (
    <View
      accessibilityLabel="示意用的运动路线图，这一版不记录真实轨迹"
      style={[styles.map, compact && styles.mapCompact]}
    >
      <View style={styles.parkOne} />
      <View style={styles.parkTwo} />
      <View style={styles.water} />

      {roadSegments.map((road, index) => (
        <View
          key={`road-${index}`}
          style={[
            styles.road,
            {
              top: road.top,
              left: road.left,
              width: road.width,
              transform: [{ rotate: road.rotate }],
            },
          ]}
        />
      ))}

      {routeSegments.map((segment, index) => (
        <View
          key={`route-${index}`}
          style={[
            styles.route,
            {
              top: segment.top,
              left: segment.left,
              width: segment.width,
              transform: [{ rotate: segment.rotate }],
            },
          ]}
        />
      ))}

      <View style={[styles.marker, styles.startMarker]}>
        <View style={styles.markerCenter} />
      </View>
      <View style={[styles.pin, styles.endPin]}>
        <AppIcon color={colors.background} name="location" size={compact ? 15 : 18} />
      </View>
      {showCurrent ? (
        <View style={styles.currentHalo}>
          <View style={styles.currentDot} />
        </View>
      ) : null}
      <View style={styles.previewBadge}>
        <Text style={styles.previewBadgeText}>模拟路线</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  map: {
    height: 360,
    overflow: 'hidden',
    backgroundColor: '#F1F5F2',
  },
  mapCompact: {
    height: 190,
    borderRadius: radius.lg,
  },
  road: {
    position: 'absolute',
    height: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.background,
  },
  route: {
    position: 'absolute',
    height: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  parkOne: {
    position: 'absolute',
    top: '15%',
    left: '16%',
    width: '19%',
    height: '18%',
    borderRadius: radius.lg,
    backgroundColor: workoutAccent.mapPark,
    transform: [{ rotate: '-9deg' }],
  },
  parkTwo: {
    position: 'absolute',
    top: '58%',
    left: '55%',
    width: '18%',
    height: '17%',
    borderRadius: radius.lg,
    backgroundColor: workoutAccent.mapPark,
    transform: [{ rotate: '11deg' }],
  },
  water: {
    position: 'absolute',
    right: '-22%',
    bottom: '-19%',
    width: '55%',
    height: '50%',
    borderRadius: radius.pill,
    backgroundColor: workoutAccent.mapWater,
    transform: [{ rotate: '12deg' }],
  },
  marker: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: colors.background,
    backgroundColor: colors.primary,
  },
  markerCenter: {
    width: 6,
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.background,
  },
  startMarker: {
    left: '8%',
    top: '73%',
  },
  pin: {
    position: 'absolute',
    width: 31,
    height: 31,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryStrong,
  },
  endPin: {
    right: '10%',
    top: '18%',
  },
  currentHalo: {
    position: 'absolute',
    left: '46%',
    top: '46%',
    width: 46,
    height: 46,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.18)',
  },
  currentDot: {
    width: 18,
    height: 18,
    borderRadius: radius.pill,
    borderWidth: 4,
    borderColor: colors.background,
    backgroundColor: colors.primary,
  },
  previewBadge: {
    position: 'absolute',
    left: 12,
    top: 12,
    height: 28,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
  },
  previewBadgeText: {
    color: workoutAccent.muted,
    fontFamily,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '600',
  },
});
