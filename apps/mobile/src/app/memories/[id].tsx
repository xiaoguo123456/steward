import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { NavHeader } from '@/components/ui/nav-header';
import { StatePanel } from '@/components/ui/state-panel';
import { useMemoriesPrototype } from '@/features/memories/memories-context';
import { formatMemoryDateParts } from '@/features/memories/memory-model';
import { colors, fontFamily, radius } from '@/theme/tokens';

export default function MemoryDetailScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const rawId = Array.isArray(params.id) ? params.id[0] : params.id;
  const { moments, deleteMoment } = useMemoriesPrototype();
  const moment = moments.find((item) => item.id === rawId);
  const [activePhoto, setActivePhoto] = useState(0);
  const heroScrollRef = useRef<ScrollView>(null);

  if (!moment) {
    return (
      <AppScreen includeBottomInset>
        <NavHeader title="时光详情" />
        <View style={styles.missing}>
          <StatePanel
            actionLabel="返回时光"
            icon="images-outline"
            message="这段时光可能已经被删除。"
            onAction={() => router.back()}
            title="没有找到"
          />
        </View>
      </AppScreen>
    );
  }

  const date = formatMemoryDateParts(moment.date);
  const photoWidth = Math.max(280, width - 32);

  const confirmDelete = () => {
    Alert.alert(
      '删除这段时光？',
      `${date.full}的 ${moment.photos.length} 张照片将从当前本地原型中移除。此操作不会删除系统相册中的照片。`,
      [
        { text: '保留时光', style: 'cancel' },
        {
          text: '删除这段时光',
          style: 'destructive',
          onPress: () => {
            deleteMoment(moment.id);
            router.back();
          },
        },
      ],
    );
  };

  return (
    <AppScreen includeBottomInset>
      <NavHeader
        right={(
          <Pressable
            accessibilityLabel="编辑这段时光"
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/memories/new', params: { id: moment.id } })}
            style={({ pressed }) => [styles.headerAction, pressed && styles.pressed]}
          >
            <AppIcon color={colors.primaryStrong} name="create-outline" size={21} />
          </Pressable>
        )}
        title="时光详情"
      />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ScrollView
          contentContainerStyle={styles.photoRail}
          decelerationRate="fast"
          horizontal
          onMomentumScrollEnd={(event) => {
            const index = Math.round(event.nativeEvent.contentOffset.x / (photoWidth + 8));
            setActivePhoto(Math.max(0, Math.min(moment.photos.length - 1, index)));
          }}
          showsHorizontalScrollIndicator={false}
          snapToInterval={photoWidth + 8}
          snapToAlignment="start"
          ref={heroScrollRef}
        >
          {moment.photos.map((photo, index) => (
            <View
              accessibilityLabel={`照片 ${index + 1}，共 ${moment.photos.length} 张，${photo.description}`}
              accessibilityRole="image"
              key={photo.id}
              style={[styles.heroPhoto, { width: photoWidth }]}
            >
              <Image contentFit="cover" source={photo.source} style={StyleSheet.absoluteFill} transition={180} />
            </View>
          ))}
        </ScrollView>

        {moment.photos.length > 1 ? (
          <View style={styles.photoStatus}>
            <Text accessibilityLiveRegion="polite" style={styles.photoIndex}>
              {activePhoto + 1} / {moment.photos.length}
            </Text>
            <ScrollView contentContainerStyle={styles.thumbnails} horizontal showsHorizontalScrollIndicator={false}>
              {moment.photos.map((photo, index) => (
                <Pressable
                  accessibilityLabel={`查看第 ${index + 1} 张照片`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: index === activePhoto }}
                  key={photo.id}
                  onPress={() => {
                    setActivePhoto(index);
                    heroScrollRef.current?.scrollTo({ x: index * (photoWidth + 8), animated: true });
                  }}
                  style={[
                    styles.thumbnail,
                    index === activePhoto && styles.thumbnailSelected,
                  ]}
                >
                  <Image contentFit="cover" source={photo.source} style={StyleSheet.absoluteFill} />
                </Pressable>
              ))}
            </ScrollView>
          </View>
        ) : null}

        <View style={styles.copy}>
          <Text style={styles.date}>{date.full}</Text>
          {moment.title ? <Text accessibilityRole="header" style={styles.title}>{moment.title}</Text> : null}
          {moment.story ? <Text style={styles.story}>{moment.story}</Text> : null}
          <View style={styles.sourceRow}>
            <AppIcon color={colors.textTertiary} name="image-outline" size={15} />
            <Text style={styles.sourceText}>
              {moment.origin === 'demo' ? '本地演示内容' : '本次运行中添加'} · {moment.photos.length} 张照片
            </Text>
          </View>
        </View>

        <View style={styles.actions}>
          <AppButton
            icon="create-outline"
            label="编辑照片与文字"
            onPress={() => router.push({ pathname: '/memories/new', params: { id: moment.id } })}
            variant="secondary"
          />
          <AppButton
            icon="trash-outline"
            label="删除这段时光"
            onPress={confirmDelete}
            variant="danger"
          />
        </View>
      </ScrollView>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: 30,
  },
  missing: {
    flex: 1,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  headerAction: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  photoRail: {
    paddingHorizontal: 16,
    gap: 8,
  },
  heroPhoto: {
    aspectRatio: 4 / 3,
    overflow: 'hidden',
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  photoStatus: {
    minHeight: 62,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  photoIndex: {
    width: 38,
    color: colors.textSecondary,
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
    fontVariant: ['tabular-nums'],
  },
  thumbnails: {
    paddingVertical: 8,
    gap: 6,
  },
  thumbnail: {
    width: 44,
    height: 44,
    overflow: 'hidden',
    borderRadius: radius.sm,
    opacity: 0.48,
    backgroundColor: colors.surface,
  },
  thumbnailSelected: {
    opacity: 1,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  copy: {
    paddingHorizontal: 20,
    paddingTop: 18,
  },
  date: {
    color: colors.primaryStrong,
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
  },
  title: {
    marginTop: 9,
    color: colors.text,
    fontFamily,
    fontSize: 24,
    lineHeight: 33,
    fontWeight: '600',
    letterSpacing: -0.35,
  },
  story: {
    marginTop: 10,
    color: colors.textSecondary,
    fontFamily,
    fontSize: 16,
    lineHeight: 26,
  },
  sourceRow: {
    minHeight: 42,
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  sourceText: {
    color: colors.textTertiary,
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
  },
  actions: {
    marginTop: 24,
    paddingHorizontal: 16,
    gap: 8,
  },
  pressed: {
    backgroundColor: colors.primarySoft,
  },
});
