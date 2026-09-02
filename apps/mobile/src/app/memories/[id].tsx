import {
  deleteMemoryMoment,
  errorMessage,
  getGetMemoryMomentQueryKey,
  getListMemoryMomentsQueryKey,
  newIdempotencyKey,
  useGetMemoryMoment,
} from '@steward/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppScreen } from '@/components/ui/app-screen';
import { confirmAction } from '@/components/ui/confirm-action';
import { NavHeader } from '@/components/ui/nav-header';
import { StatePanel } from '@/components/ui/state-panel';
import { useToast } from '@/components/ui/toast';
import { formatMemoryDateParts, toMemoryMoment } from '@/features/memories/memory-model';
import { colors, fontFamily, radius } from '@/theme/tokens';

export default function MemoryDetailScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const rawId = Array.isArray(params.id) ? params.id[0] : params.id;
  const query = useGetMemoryMoment(rawId ?? '', {
    query: { enabled: Boolean(rawId), staleTime: 3 * 60 * 1000 },
  });
  const moment = query.data?.data ? toMemoryMoment(query.data.data) : null;
  const [activePhoto, setActivePhoto] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const heroScrollRef = useRef<ScrollView>(null);
  const deleteKeyRef = useRef<string | null>(null);

  if (query.isPending) {
    return (
      <AppScreen includeBottomInset>
        <NavHeader title="时光详情" />
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </AppScreen>
    );
  }

  if (query.isError || !moment) {
    return (
      <AppScreen includeBottomInset>
        <NavHeader title="时光详情" />
        <View style={styles.missing}>
          <StatePanel
            actionLabel="返回时光"
            icon="images-outline"
            message={errorMessage(query.error, '这段时光可能已经被删除。')}
            onAction={() => router.back()}
            title="没有找到"
          />
        </View>
      </AppScreen>
    );
  }

  const date = formatMemoryDateParts(moment.date);
  const photoWidth = Math.max(280, width - 32);

  const confirmDelete = async () => {
    const confirmed = await confirmAction({
      title: '删除这段时光？',
      message: `${date.full}的 ${moment.photos.length} 张服务端照片副本将一并删除，不会影响系统相册中的原文件。删除后无法恢复。`,
      confirmLabel: '删除这段时光',
      cancelLabel: '保留时光',
      destructive: true,
    });
    if (!confirmed) return;
    setDeleting(true);
    deleteKeyRef.current ??= newIdempotencyKey();
    await deleteMemoryMoment(moment.id, {
      headers: { 'Idempotency-Key': deleteKeyRef.current },
    })
      .then(async () => {
        queryClient.removeQueries({
          queryKey: getGetMemoryMomentQueryKey(moment.id),
          exact: true,
        });
        await queryClient.invalidateQueries({
          queryKey: getListMemoryMomentsQueryKey(),
        });
      })
      .then(() => {
        showToast('时光已删除');
        router.back();
      })
      .catch((error) => showToast(errorMessage(error, '删除没有完成，请稍后重试。')))
      .finally(() => setDeleting(false));
  };

  return (
    <AppScreen includeBottomInset>
      <NavHeader title="时光详情" />
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
          {moment.description ? <Text style={styles.description}>{moment.description}</Text> : null}
        </View>

        <View style={styles.actions}>
          <AppButton
            disabled={deleting}
            icon="trash-outline"
            label={deleting ? '正在删除…' : '删除这段时光'}
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
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
  description: {
    marginTop: 10,
    color: colors.text,
    fontFamily,
    fontSize: 16,
    lineHeight: 26,
  },
  actions: {
    marginTop: 24,
    paddingHorizontal: 16,
    gap: 8,
  },
});
