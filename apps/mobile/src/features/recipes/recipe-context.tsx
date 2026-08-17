import {
  createContext,
  type PropsWithChildren,
  useContext,
  useState,
} from 'react';

import { defaultProfile, initialWeekPlan, recipes, weekDays } from './mock-data';
import {
  mealSlotOrder,
  type MealSlot,
  type RecipeProfile,
  type WeekDayId,
  type WeekPlan,
} from './model';

type RecipePrototypeValue = {
  profile: RecipeProfile;
  setProfile: (profile: RecipeProfile) => void;
  selectedDayId: WeekDayId;
  setSelectedDayId: (dayId: WeekDayId) => void;
  plan: WeekPlan;
  hasPendingPlan: boolean;
  swapRecipe: (dayId: WeekDayId, meal: MealSlot) => void;
  setRecipeForMeal: (dayId: WeekDayId, meal: MealSlot, recipeId: string) => void;
  regenerateWeek: () => void;
  confirmPlan: () => void;
  discardPlan: () => void;
  favoriteIds: Set<string>;
  toggleFavorite: (recipeId: string) => void;
  cookedIds: Set<string>;
  markCooked: (recipeId: string) => void;
};

const RecipePrototypeContext = createContext<RecipePrototypeValue | null>(null);

function nextRecipeId(currentId: string, meal: MealSlot, offset = 1) {
  const candidates = recipes.filter((recipe) => recipe.mealSlots.includes(meal));
  const currentIndex = Math.max(
    0,
    candidates.findIndex((recipe) => recipe.id === currentId),
  );
  return candidates[(currentIndex + offset) % candidates.length]?.id ?? currentId;
}

export function RecipePrototypeProvider({ children }: PropsWithChildren) {
  const [profile, setProfile] = useState(defaultProfile);
  const [selectedDayId, setSelectedDayId] = useState<WeekDayId>(
    weekDays.find((day) => day.isToday)?.id ?? 'mon',
  );
  const [confirmedPlan, setConfirmedPlan] = useState<WeekPlan>(initialWeekPlan);
  const [draftPlan, setDraftPlan] = useState<WeekPlan | null>(null);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(
    new Set(['chicken-brown-rice']),
  );
  const [cookedIds, setCookedIds] = useState<Set<string>>(new Set());

  const setRecipeForMeal = (dayId: WeekDayId, meal: MealSlot, recipeId: string) => {
    setDraftPlan((currentDraft) => {
      const current = currentDraft ?? confirmedPlan;
      return {
        ...current,
        [dayId]: { ...current[dayId], [meal]: recipeId },
      };
    });
  };

  const swapRecipe = (dayId: WeekDayId, meal: MealSlot) => {
    setDraftPlan((currentDraft) => {
      const current = currentDraft ?? confirmedPlan;
      return {
        ...current,
        [dayId]: {
          ...current[dayId],
          [meal]: nextRecipeId(current[dayId][meal], meal),
        },
      };
    });
  };

  const regenerateWeek = () => {
    setDraftPlan((currentDraft) => {
      const current = currentDraft ?? confirmedPlan;
      const next = { ...current } as WeekPlan;
      weekDays.forEach((day, dayIndex) => {
        const dayPlan = { ...current[day.id] };
        mealSlotOrder.forEach((meal, mealIndex) => {
          dayPlan[meal] = nextRecipeId(dayPlan[meal], meal, dayIndex + mealIndex + 1);
        });
        next[day.id] = dayPlan;
      });
      return next;
    });
  };

  const confirmPlan = () => {
    if (draftPlan) setConfirmedPlan(draftPlan);
    setDraftPlan(null);
  };

  const discardPlan = () => setDraftPlan(null);

  const toggleFavorite = (recipeId: string) => {
    setFavoriteIds((current) => {
      const next = new Set(current);
      if (next.has(recipeId)) next.delete(recipeId);
      else next.add(recipeId);
      return next;
    });
  };

  const markCooked = (recipeId: string) => {
    setCookedIds((current) => new Set(current).add(recipeId));
  };

  const value: RecipePrototypeValue = {
    profile,
    setProfile,
    selectedDayId,
    setSelectedDayId,
    plan: draftPlan ?? confirmedPlan,
    hasPendingPlan: draftPlan !== null,
    swapRecipe,
    setRecipeForMeal,
    regenerateWeek,
    confirmPlan,
    discardPlan,
    favoriteIds,
    toggleFavorite,
    cookedIds,
    markCooked,
  };

  return (
    <RecipePrototypeContext.Provider value={value}>
      {children}
    </RecipePrototypeContext.Provider>
  );
}

export function useRecipePrototype() {
  const value = useContext(RecipePrototypeContext);
  if (!value) {
    throw new Error('useRecipePrototype 必须在 RecipePrototypeProvider 中使用');
  }
  return value;
}
