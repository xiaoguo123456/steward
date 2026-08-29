import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontFamily, radius } from '@/theme/tokens';
import type { MemoryPhoto } from './memory-model';

export function MemoryPhotoGrid({
  photos,
  dateLabel,
  onPress,
}: {
  photos: readonly MemoryPhoto[];
  dateLabel: string;
  onPress?: () => void;
}) {
  const visible = photos.slice(0, 3);

  if (photos.length === 1) {
    return (
      <MemoryImage
        accessibilityLabel={`${dateLabel}，照片 1，共 1 张，${photos[0].description}`}
        onPress={onPress}
        photo={photos[0]}
        style={styles.single}
      />
    );
  }

  if (photos.length === 2) {
    return (
      <View style={styles.doubleRow}>
        {photos.map((photo, index) => (
          <MemoryImage
            accessibilityLabel={`${dateLabel}，照片 ${index + 1}，共 2 张，${photo.description}`}
            key={photo.id}
            onPress={onPress}
            photo={photo}
            style={styles.double}
          />
        ))}
      </View>
    );
  }

  return (
    <View style={styles.multi}>
      <MemoryImage
        accessibilityLabel={`${dateLabel}，照片 1，共 ${photos.length} 张，${visible[0].description}`}
        onPress={onPress}
        photo={visible[0]}
        style={styles.multiHero}
      />
      <View style={styles.multiRow}>
        {visible.slice(1).map((photo, index) => {
          const photoIndex = index + 2;
          const remaining = photos.length - 3;
          return (
            <View key={photo.id} style={styles.multiThumbShell}>
              <MemoryImage
                accessibilityLabel={`${dateLabel}，照片 ${photoIndex}，共 ${photos.length} 张，${photo.description}`}
                onPress={onPress}
                photo={photo}
                style={styles.multiThumb}
              />
              {index === 1 && remaining > 0 ? (
                <Pressable
                  accessibilityLabel={`查看其余 ${remaining} 张照片`}
                  accessibilityRole="button"
                  onPress={onPress}
                  style={({ pressed }) => [styles.remaining, pressed && styles.pressed]}
                >
                  <Text style={styles.remainingText}>+{remaining}</Text>
                </Pressable>
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

function MemoryImage({
  photo,
  style,
  accessibilityLabel,
  onPress,
}: {
  photo: MemoryPhoto;
  style: object;
  accessibilityLabel: string;
  onPress?: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="imagebutton"
      onPress={onPress}
      style={({ pressed }) => [style, pressed && styles.pressed]}
    >
      <Image contentFit="cover" source={photo.source} style={StyleSheet.absoluteFill} transition={160} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  single: {
    width: '100%',
    aspectRatio: 3 / 2,
    overflow: 'hidden',
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  doubleRow: {
    width: '100%',
    aspectRatio: 1.52,
    flexDirection: 'row',
    gap: 4,
  },
  double: {
    flex: 1,
    overflow: 'hidden',
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  multi: {
    width: '100%',
    gap: 4,
  },
  multiHero: {
    width: '100%',
    aspectRatio: 16 / 9,
    overflow: 'hidden',
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  multiRow: {
    width: '100%',
    aspectRatio: 2.4,
    flexDirection: 'row',
    gap: 4,
  },
  multiThumbShell: {
    flex: 1,
    overflow: 'hidden',
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  multiThumb: {
    flex: 1,
  },
  remaining: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    minWidth: 48,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(16, 24, 21, 0.54)',
  },
  remainingText: {
    color: colors.background,
    fontFamily,
    fontSize: 20,
    lineHeight: 28,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.78,
  },
});
