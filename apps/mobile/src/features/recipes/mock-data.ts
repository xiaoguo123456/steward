import type {
  RecipeCategory,
  RecipeProfile,
  WeekDay,
  WeekPlan,
} from './model';


export const weekDays: WeekDay[] = [
  { id: 'mon', weekday: '一', label: '周一', date: '17', fullDate: '8月17日', isToday: true },
  { id: 'tue', weekday: '二', label: '周二', date: '18', fullDate: '8月18日' },
  { id: 'wed', weekday: '三', label: '周三', date: '19', fullDate: '8月19日' },
  { id: 'thu', weekday: '四', label: '周四', date: '20', fullDate: '8月20日' },
  { id: 'fri', weekday: '五', label: '周五', date: '21', fullDate: '8月21日' },
  { id: 'sat', weekday: '六', label: '周六', date: '22', fullDate: '8月22日' },
  { id: 'sun', weekday: '日', label: '周日', date: '23', fullDate: '8月23日' },
];

export const categoryOptions: { id: RecipeCategory; label: string }[] = [
  { id: 'recommended', label: '精选' },
  { id: 'quick', label: '快手菜' },
  { id: 'seasonal', label: '时令' },
  { id: 'fat-loss', label: '减脂' },
  { id: 'muscle-gain', label: '增肌' },
  { id: 'steady-sugar', label: '健康控糖' },
];

export const initialWeekPlan: WeekPlan = {
  mon: { breakfast: 'oat-egg', lunch: 'chicken-brown-rice', dinner: 'salmon-vegetables' },
  tue: { breakfast: 'wholegrain-sandwich', lunch: 'tomato-beef', dinner: 'tofu-shrimp' },
  wed: { breakfast: 'millet-pumpkin', lunch: 'mushroom-chicken-rice', dinner: 'shrimp-vegetables' },
  thu: { breakfast: 'oat-egg', lunch: 'beef-noodle', dinner: 'salmon-vegetables' },
  fri: { breakfast: 'wholegrain-sandwich', lunch: 'chicken-brown-rice', dinner: 'tofu-shrimp' },
  sat: { breakfast: 'millet-pumpkin', lunch: 'tomato-beef', dinner: 'shrimp-vegetables' },
  sun: { breakfast: 'oat-egg', lunch: 'mushroom-chicken-rice', dinner: 'beef-noodle' },
};

export const defaultProfile: RecipeProfile = {
  goal: 'steady-sugar',
  age: '31',
  sex: 'female',
  height: '165',
  weight: '60',
  targetWeight: '58',
  activity: 'moderate',
  allergies: [],
  dietaryRestrictions: [],
  diagnosedDiabetes: false,
  people: 1,
  maxCookingMinutes: 40,
  budget: 'standard',
  tastes: ['清淡', '家常'],
  equipment: ['炒锅', '电饭煲'],
};

