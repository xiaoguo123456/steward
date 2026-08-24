import {
  Camera,
  GeoJSONSource,
  Layer,
  Map,
} from '@maplibre/maplibre-react-native';
import type { FeatureCollection, LineString, Point } from 'geojson';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontFamily, radius } from '@/theme/tokens';

import { formatDistanceKilometers } from '../workout-location';
import type { RouteMapProps } from './route-map.types';

const DEFAULT_CENTER: [number, number] = [104.1954, 35.8617];
const MAP_STYLE_URL =
  process.env.EXPO_PUBLIC_MAP_STYLE_URL?.trim() ||
  'https://img.qhzhiyin.com/steward/maps/protomaps/20260823/style-light-zh-hans.json';

export function RouteMap({
  routeSegments,
  currentPoint,
  distanceMeters,
  trackingStatus,
  statusMessage,
  actionLabel,
  onAction,
}: RouteMapProps) {
  const [mapAttempt, setMapAttempt] = useState(0);
  const [mapState, setMapState] = useState<'loading' | 'ready' | 'error'>('loading');
  const routeData = useMemo(() => createRouteData(routeSegments), [routeSegments]);
  const startData = useMemo(
    () => createPointData(routeSegments[0]?.[0]),
    [routeSegments],
  );
  const currentData = useMemo(() => createPointData(currentPoint), [currentPoint]);
  const center: [number, number] = currentPoint
    ? [currentPoint.longitude, currentPoint.latitude]
    : DEFAULT_CENTER;
  const showLocationMessage = trackingStatus !== 'tracking';

  const retryMap = () => {
    setMapState('loading');
    setMapAttempt((current) => current + 1);
  };

  return (
    <View
      accessibilityLabel={`实际运动地图，已记录 ${formatDistanceKilometers(distanceMeters)} 公里。${statusMessage}`}
      style={styles.container}
    >
      <Map
        attribution
        attributionPosition={{ bottom: 8, left: 8 }}
        compass
        compassHiddenFacingNorth
        compassPosition={{ right: 10, top: 52 }}
        key={mapAttempt}
        logo={false}
        mapStyle={MAP_STYLE_URL}
        onDidFailLoadingMap={() => setMapState('error')}
        onDidFinishLoadingMap={() => setMapState('ready')}
        scaleBar={false}
        style={StyleSheet.absoluteFill}
        touchPitch={false}
        touchRotate={false}
      >
        <Camera
          center={center}
          duration={currentPoint ? 450 : 0}
          easing="ease"
          initialViewState={{ center: DEFAULT_CENTER, zoom: 3.4 }}
          zoom={currentPoint ? 16 : 3.4}
        />

        {routeData.features.length > 0 ? (
          <GeoJSONSource data={routeData} id="workout-route-source">
            <Layer
              id="workout-route-casing"
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{ 'line-color': '#FFFFFF', 'line-opacity': 0.9, 'line-width': 8 }}
              type="line"
            />
            <Layer
              id="workout-route"
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{ 'line-color': colors.primary, 'line-width': 5 }}
              type="line"
            />
          </GeoJSONSource>
        ) : null}

        {startData ? (
          <GeoJSONSource data={startData} id="workout-start-source">
            <Layer
              id="workout-start-border"
              paint={{ 'circle-color': '#FFFFFF', 'circle-radius': 9 }}
              type="circle"
            />
            <Layer
              id="workout-start"
              paint={{ 'circle-color': colors.primaryStrong, 'circle-radius': 5 }}
              type="circle"
            />
          </GeoJSONSource>
        ) : null}

        {currentData ? (
          <GeoJSONSource data={currentData} id="workout-current-source">
            <Layer
              id="workout-current-halo"
              paint={{ 'circle-color': colors.primary, 'circle-opacity': 0.2, 'circle-radius': 18 }}
              type="circle"
            />
            <Layer
              id="workout-current-border"
              paint={{ 'circle-color': '#FFFFFF', 'circle-radius': 9 }}
              type="circle"
            />
            <Layer
              id="workout-current"
              paint={{ 'circle-color': colors.primary, 'circle-radius': 5 }}
              type="circle"
            />
          </GeoJSONSource>
        ) : null}
      </Map>

      {mapState === 'loading' ? (
        <View pointerEvents="none" style={styles.mapStatePill}>
          <Text style={styles.mapStateText}>地图加载中…</Text>
        </View>
      ) : null}

      {mapState === 'error' ? (
        <View style={styles.mapError}>
          <Text style={styles.mapErrorTitle}>地图暂时没有加载出来</Text>
          <Text style={styles.mapErrorCopy}>计时和 GPS 记录仍会继续。</Text>
          <Pressable
            accessibilityRole="button"
            onPress={retryMap}
            style={({ pressed }) => [styles.retryButton, pressed && styles.buttonPressed]}
          >
            <Text style={styles.retryText}>重新加载地图</Text>
          </Pressable>
        </View>
      ) : null}

      {mapState !== 'error' && showLocationMessage ? (
        <View style={styles.locationMessage}>
          <Text style={styles.locationMessageText}>{statusMessage}</Text>
          {actionLabel && onAction ? (
            <Pressable
              accessibilityRole="button"
              onPress={onAction}
              style={({ pressed }) => [styles.locationAction, pressed && styles.buttonPressed]}
            >
              <Text style={styles.locationActionText}>{actionLabel}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function createRouteData(routeSegments: RouteMapProps['routeSegments']): FeatureCollection<LineString> {
  return {
    type: 'FeatureCollection',
    features: routeSegments
      .filter((segment) => segment.length >= 2)
      .map((segment, index) => ({
        type: 'Feature',
        id: index,
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: segment.map((point) => [point.longitude, point.latitude]),
        },
      })),
  };
}

function createPointData(
  point: RouteMapProps['currentPoint'],
): FeatureCollection<Point> | undefined {
  if (!point) return undefined;
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Point',
          coordinates: [point.longitude, point.latitude],
        },
      },
    ],
  };
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: colors.surfaceSubtle,
  },
  mapStatePill: {
    position: 'absolute',
    left: '50%',
    top: 58,
    minHeight: 32,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    transform: [{ translateX: -58 }],
  },
  mapStateText: {
    color: colors.textSecondary,
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
  },
  mapError: {
    ...StyleSheet.absoluteFill,
    paddingHorizontal: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceSubtle,
  },
  mapErrorTitle: {
    color: colors.text,
    fontFamily,
    fontSize: 16,
    lineHeight: 23,
    fontWeight: '700',
  },
  mapErrorCopy: {
    marginTop: 4,
    color: colors.textSecondary,
    fontFamily,
    fontSize: 13,
    lineHeight: 20,
  },
  retryButton: {
    minHeight: 44,
    marginTop: 8,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: {
    color: colors.primaryStrong,
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  locationMessage: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 14,
    minHeight: 42,
    paddingLeft: 13,
    paddingRight: 7,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
  },
  locationMessageText: {
    flex: 1,
    color: colors.textSecondary,
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
  },
  locationAction: {
    minWidth: 58,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  locationActionText: {
    color: colors.primaryStrong,
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
  },
  buttonPressed: {
    opacity: 0.58,
  },
});
