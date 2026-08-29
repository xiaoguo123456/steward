import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontFamily, radius } from '@/theme/tokens';
import { formatMemoryDateParts, type MemoryMoment } from './memory-model';
import { MemoryPhotoGrid } from './memory-photo-grid';

export function MemoryMomentRow({
  moment,
  onPress,
  compact = false,
}: {
  moment: MemoryMoment;
  onPress: () => void;
  compact?: boolean;
}) {
  const date = formatMemoryDateParts(moment.date);

  if (compact) {
    return (
      <Pressable
        accessibilityLabel={`${date.full}，${moment.title || '照片时光'}，${moment.photos.length} 张照片`}
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [styles.compactRow, pressed && styles.pressed]}
      >
        <View style={styles.compactDate}>
          <Text style={styles.compactDay}>{date.day}</Text>
          <Text style={styles.compactWeekday}>{date.weekday}</Text>
        </View>
        <View style={styles.compactCopy}>
          <Text numberOfLines={1} style={styles.compactTitle}>
            {moment.title || '这一天的照片'}
          </Text>
          <Text numberOfLines={1} style={styles.compactStory}>
            {moment.story || `${moment.photos.length} 张照片`}
          </Text>
        </View>
        <View
          accessibilityLabel={`${date.full}，封面照片，${moment.photos[0].description}`}
          accessibilityRole="image"
          style={styles.compactThumb}
        >
          <Image
            contentFit="cover"
            source={moment.photos[0].source}
            style={StyleSheet.absoluteFill}
          />
        </View>
      </Pressable>
    );
  }

  return (
    <View style={styles.row}>
      <View style={styles.dateColumn}>
        <Text style={styles.day}>{date.day}</Text>
        <Text style={styles.weekday}>{date.weekday}</Text>
      </View>
      <View style={styles.content}>
        <MemoryPhotoGrid dateLabel={date.full} onPress={onPress} photos={moment.photos} />
        <Pressable
          accessibilityLabel={`${date.full}，打开${moment.title || '这段时光'}`}
          accessibilityRole="button"
          onPress={onPress}
          style={({ pressed }) => [styles.copyButton, pressed && styles.pressed]}
        >
          {moment.title ? <Text style={styles.title}>{moment.title}</Text> : null}
          {moment.story ? (
            <Text numberOfLines={2} style={styles.story}>
              {moment.story}
            </Text>
          ) : null}
          <Text style={styles.photoCount}>{moment.photos.length} 张照片</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  dateColumn: {
    width: 44,
    paddingTop: 2,
    alignItems: 'flex-start',
  },
  day: {
    color: colors.text,
    fontFamily,
    fontSize: 30,
    lineHeight: 34,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.8,
  },
  weekday: {
    marginTop: 2,
    color: colors.textSecondary,
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
  },
  content: {
    flex: 1,
    minWidth: 0,
  },
  copyButton: {
    minHeight: 48,
    paddingTop: 10,
    paddingBottom: 2,
    justifyContent: 'center',
  },
  title: {
    color: colors.text,
    fontFamily,
    fontSize: 16,
    lineHeight: 23,
    fontWeight: '600',
  },
  story: {
    marginTop: 3,
    color: colors.textSecondary,
    fontFamily,
    fontSize: 14,
    lineHeight: 21,
  },
  photoCount: {
    marginTop: 5,
    color: colors.textTertiary,
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
  },
  compactRow: {
    minHeight: 82,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  compactDate: {
    width: 42,
    alignItems: 'center',
  },
  compactDay: {
    color: colors.text,
    fontFamily,
    fontSize: 23,
    lineHeight: 28,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  compactWeekday: {
    color: colors.textSecondary,
    fontFamily,
    fontSize: 11,
    lineHeight: 16,
  },
  compactCopy: {
    flex: 1,
    minWidth: 0,
  },
  compactTitle: {
    color: colors.text,
    fontFamily,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
  },
  compactStory: {
    marginTop: 3,
    color: colors.textSecondary,
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
  },
  compactThumb: {
    width: 72,
    height: 72,
    overflow: 'hidden',
    borderRadius: radius.md,
  },
  pressed: {
    opacity: 0.62,
  },
});
