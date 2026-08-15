import { Stack } from 'expo-router';

import { workoutAccent } from '@/features/workouts/mock-data';

export default function ExerciseLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        contentStyle: { backgroundColor: workoutAccent.background },
      }}
    />
  );
}
