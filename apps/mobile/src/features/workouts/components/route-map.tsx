import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppIcon } from '@/components/ui/icon';
import { colors, fontFamily, radius } from '@/theme/tokens';

import type { RouteMapProps } from './route-map.types';

/** Web 的静态预览不伪造路线；原生安装包由 route-map.native.tsx 渲染真实地图。 */
export function RouteMap({ statusMessage, actionLabel, onAction }: RouteMapProps) {
  return (
    <View accessibilityLabel={statusMessage} style={styles.map}>
      <View style={styles.iconCircle}>
        <AppIcon color={colors.primaryStrong} name="map-outline" size={30} />
      </View>
      <Text style={styles.title}>真机地图</Text>
      <Text style={styles.copy}>{statusMessage}</Text>
      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          onPress={onAction}
          style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
        >
          <Text style={styles.actionText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  map: {
    height: 330,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceSubtle,
  },
  iconCircle: {
    width: 58,
    height: 58,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
  },
  title: {
    marginTop: 13,
    color: colors.text,
    fontFamily,
    fontSize: 16,
    lineHeight: 23,
    fontWeight: '700',
  },
  copy: {
    maxWidth: 280,
    marginTop: 5,
    color: colors.textSecondary,
    fontFamily,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
  },
  action: {
    minHeight: 44,
    marginTop: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionPressed: {
    opacity: 0.58,
  },
  actionText: {
    color: colors.primaryStrong,
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
});
