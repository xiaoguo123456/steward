import { useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/ui/app-screen';
import { NavHeader } from '@/components/ui/nav-header';
import { TripDetail } from '@/features/trips/trip-detail';
import { useTripDetail } from '@/features/trips/use-trips';
import { colors, fontFamily, typography } from '@/theme/tokens';

export default function TripDetailScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const { trip, loading, notFound, toggleChecklistItem } = useTripDetail(id ?? '');

  if (trip) {
    return <TripDetail onToggleChecklistItem={toggleChecklistItem} trip={trip} />;
  }

  return (
    <AppScreen includeBottomInset>
      <NavHeader title="行程" />
      <View style={styles.center}>
        {loading ? (
          <ActivityIndicator color={colors.primary} />
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
