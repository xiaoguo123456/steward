import { Stack } from 'expo-router';

import { recipeColors } from '@/features/recipes/mock-data';
import { RecipePrototypeProvider } from '@/features/recipes/recipe-context';

export default function RecipesLayout() {
  return (
    <RecipePrototypeProvider>
      <Stack
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
          contentStyle: { backgroundColor: recipeColors.background },
        }}
      />
    </RecipePrototypeProvider>
  );
}
