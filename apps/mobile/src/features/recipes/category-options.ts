// 分类选项是界面上的固定文案，不是用户数据也不是服务端内容。
//
// 本周菜单、饮食档案与收藏都已经落库，分别走 use-meal-plan、
// use-diet-profile 与 use-recipe-marks；这里不再有它们的本地副本。
import type { RecipeCategory } from './model';


export const categoryOptions: { id: RecipeCategory; label: string }[] = [
  { id: 'recommended', label: '精选' },
  { id: 'quick', label: '快手菜' },
  { id: 'seasonal', label: '时令' },
  { id: 'fat-loss', label: '减脂' },
  { id: 'muscle-gain', label: '增肌' },
  { id: 'steady-sugar', label: '健康控糖' },
];


