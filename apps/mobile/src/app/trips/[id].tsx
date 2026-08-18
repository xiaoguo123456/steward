import { useLocalSearchParams } from 'expo-router';

import { TripDetail } from '@/features/trips/trip-detail';
import { getTripPlan } from '@/features/trips/trip-data';

export default function TripDetailScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;

  return <TripDetail trip={getTripPlan(id)} />;
}
