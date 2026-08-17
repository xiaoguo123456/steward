export type RecipeGoal = 'balanced' | 'fat-loss' | 'muscle-gain' | 'steady-sugar';

export type MealSlot = 'breakfast' | 'lunch' | 'dinner';

export type WeekDayId = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export type RecipeCategory =
  | 'recommended'
  | 'quick'
  | 'seasonal'
  | 'fat-loss'
  | 'muscle-gain'
  | 'steady-sugar';

export type RecipeDifficulty = '容易' | '适中';

export type IngredientGroup = 'produce' | 'protein' | 'staple' | 'seasoning';

export type RecipeIngredient = {
  id: string;
  name: string;
  amount: string;
  group: IngredientGroup;
};

export type RecipeStep = {
  title: string;
  description: string;
  timerMinutes?: number;
  ingredients?: string[];
};

export type Recipe = {
  id: string;
  title: string;
  image: string;
  imageDescription: string;
  imageCredit: string;
  timeMinutes: number;
  difficulty: RecipeDifficulty;
  servings: number;
  calories: number;
  protein: number;
  carbs: number;
  fiber: number;
  recommendation: string;
  description: string;
  mealSlots: MealSlot[];
  categories: RecipeCategory[];
  goals: RecipeGoal[];
  tags: string[];
  allergens: string[];
  ingredients: RecipeIngredient[];
  steps: RecipeStep[];
  sourceLabel: string;
};

export type WeekDay = {
  id: WeekDayId;
  weekday: string;
  label: string;
  date: string;
  fullDate: string;
  isToday?: boolean;
};

export type DayPlan = Record<MealSlot, string>;

export type WeekPlan = Record<WeekDayId, DayPlan>;

export type RecipeProfile = {
  goal: RecipeGoal;
  age: string;
  sex: 'female' | 'male';
  height: string;
  weight: string;
  targetWeight: string;
  activity: 'light' | 'moderate' | 'active';
  allergies: string[];
  dietaryRestrictions: string[];
  diagnosedDiabetes: boolean;
  people: number;
  maxCookingMinutes: number;
  budget: 'economy' | 'standard' | 'flexible';
  tastes: string[];
  equipment: string[];
};

export type ShoppingItem = {
  id: string;
  name: string;
  amount: string;
  group: IngredientGroup;
  sources: string[];
};

export const mealSlotOrder: MealSlot[] = ['breakfast', 'lunch', 'dinner'];

export const mealSlotLabels: Record<MealSlot, string> = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
};

export const goalLabels: Record<RecipeGoal, string> = {
  balanced: '均衡饮食',
  'fat-loss': '减脂',
  'muscle-gain': '增肌',
  'steady-sugar': '健康控糖',
};

export const ingredientGroupLabels: Record<IngredientGroup, string> = {
  produce: '蔬菜水果',
  protein: '肉蛋奶与豆制品',
  staple: '主食与杂粮',
  seasoning: '调味与其他',
};
