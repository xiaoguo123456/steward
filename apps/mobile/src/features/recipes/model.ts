export type RecipeGoal = 'balanced' | 'fat-loss' | 'muscle-gain' | 'steady-sugar';

export type MealSlot = 'breakfast' | 'lunch' | 'dinner';

/**
 * 一天的标识，就是它的日期（`2026-08-17`）。
 *
 * 不用「周几」：跨周和跨时区时「周三」是哪天并不唯一，
 * 而且周从周一还是周日开始是用户设置，只有服务端算得准。
 */
export type WeekDayId = string;

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
  /** 脂肪与膳食纤维可能没有。空表示「不知道」，界面显示「—」而不是 0。 */
  fat?: number;
  fiber?: number;
  recommendation: string;
  description: string;
  mealSlots: MealSlot[];
  categories: RecipeCategory[];
  goals: RecipeGoal[];
  tags: string[];
  allergens: string[];
  /** 这道菜在一餐里扮演什么角色。未分类的菜谱为空。 */
  component?: RecipeComponent;
  ingredients: RecipeIngredient[];
  steps: RecipeStep[];
  sourceLabel: string;
};

export type WeekDay = {
  /** 该天的日期，同时也是它的标识。 */
  id: WeekDayId;
  /** 「一」「二」……用于日期条上的一行小字。 */
  weekday: string;
  /** 「周一」。 */
  label: string;
  /** 「17」，日期条上的大字。 */
  date: string;
  /** 「8月17日」。 */
  fullDate: string;
  isToday?: boolean;
};

/**
 * 一格里的一道菜。
 *
 * 一餐是一个**组合**而不是一道菜：早餐主食+蛋白，午晚主食+荤+素。
 * component 决定展示顺序（主食在前），也让「换一道」知道该在哪一类里换。
 */
export type PlannedDish = {
  recipeId: string;
  component?: RecipeComponent;
};

/** 这道菜在一餐里扮演什么角色。 */
export type RecipeComponent = 'staple' | 'one_dish' | 'protein' | 'vegetable';

export type DayPlan = Record<MealSlot, PlannedDish[]>;

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

/**
 * 整周菜单本身的能量合计。
 *
 * 说的是「照这个方案做出来有多少」。用户实际吃多少我们不追踪，
 * 所以文案上不要写成「你的摄入」。
 */
export type RecipeNutrition = {
  calories: number;
  protein_g: number;
  carbs_g: number;
  /**
   * 脂肪与膳食纤维可能为空。
   *
   * 空表示「不知道」而不是 0：不同来源的菜谱给出的营养项不一样，
   * 而「这道菜 0g 膳食纤维」和「不知道多少」是完全不同的两句话。
   * 整周求和时只要有一道菜缺，这一项就是空。
   */
  fat_g?: number | null;
  fiber_g?: number | null;
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
