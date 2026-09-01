import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { errorMessage } from '@steward/api-client';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/ui/app-screen';
import { NavHeader } from '@/components/ui/nav-header';
import { StatePanel } from '@/components/ui/state-panel';
import { TripDetail } from '@/features/trips/trip-detail';
import { useTripDetail } from '@/features/trips/use-trips';
import { colors, fontFamily, typography } from '@/theme/tokens';

export default function TripDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const { trip, loading, failed, error, notFound, refetch, toggleChecklistItem, toggleError } = useTripDetail(id ?? '');

  if (trip) {
    return (
      <TripDetail
        onAddItem={(kind, date) => router.push(
          `/trips/new-item?projectId=${encodeURIComponent(trip.id)}&kind=${kind}&date=${date ?? ''}` as Href,
        )}
        onAddWithAI={() => router.push({
          pathname: '/capture/new',
          params: { intent: 'trip_item', projectId: trip.id },
        })}
        onToggleChecklistItem={toggleChecklistItem}
        failure={toggleError ? errorMessage(toggleError, '行前清单没有保存，请重试。') : null}
        trip={trip}
      />
    );
  }

  return (
    <AppScreen includeBottomInset>
      <NavHeader title="行程" />
      <View style={styles.center}>
        {loading ? (
          <ActivityIndicator color={colors.primary} />
        ) : failed ? (
          <StatePanel
            actionLabel="重试"
            icon="cloud-offline-outline"
            message={errorMessage(error, '行程暂时无法读取，请稍后重试。')}
            onAction={() => void refetch()}
            title="行程加载失败"
          />
        ) : (
          <Text style={styles.message}>
            {notFound ? '这个行程不存在或已被删除。' : '没有找到这个行程。'}
          </Text>
        )}
      </View>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  message: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.body,
    textAlign: 'center',
  },
});
