import {
  errorMessage,
  updateDietProfile,
  useGetDietProfile,
  type DietProfile as ApiDietProfile,
  type UpdateDietProfileRequest,
} from '@steward/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import type { RecipeProfile } from './model';

/**
 * 饮食档案。
 *
 * 身体数据属于高敏信息：只能由用户自己填写与修改，助理不会推断，
 * 也不写进日志或埋点。这里只做展示模型与契约之间的翻译。
 *
 * 没填过问卷时服务端返回一份默认档案（completed=false），
 * 客户端据此引导填写，但不拦着他浏览菜谱。
 */
export function useDietProfile() {
  const queryClient = useQueryClient();
  const query = useGetDietProfile();
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const profile = useMemo(
    () => (query.data ? toLocalProfile(query.data.data) : null),
    [query.data],
  );

  const save = async (next: RecipeProfile) => {
    setSaving(true);
    setFailure(null);
    try {
      await updateDietProfile(toRequest(next));
      await queryClient.invalidateQueries();
      return true;
    } catch (error) {
      setFailure(errorMessage(error, '问卷没能保存。'));
      return false;
    } finally {
      setSaving(false);
    }
  };

  return {
    profile,
    completed: query.data?.data.completed ?? false,
    loading: query.isPending,
    failed: query.isError,
    error: query.error,
    saving,
    failure,
    save,
  };
}

/** 契约枚举用下划线，展示模型沿用原来的连字符写法。 */
const goalToLocal = {
  balanced: 'balanced',
  fat_loss: 'fat-loss',
  muscle_gain: 'muscle-gain',
  steady_sugar: 'steady-sugar',
} as const;

const goalToApi = {
  balanced: 'balanced',
  'fat-loss': 'fat_loss',
  'muscle-gain': 'muscle_gain',
  'steady-sugar': 'steady_sugar',
} as const;

function toLocalProfile(api: ApiDietProfile): RecipeProfile {
  return {
    goal: goalToLocal[api.goal] ?? 'balanced',
    // 表单用字符串，空值显示为空而不是 0——「体重 0 公斤」比留空更奇怪。
    age: api.age === undefined || api.age === null ? '' : String(api.age),
    sex: api.sex === 'male' ? 'male' : 'female',
    height: numberText(api.height_cm),
    weight: numberText(api.weight_kg),
    targetWeight: numberText(api.target_weight_kg),
    activity: api.activity_level === 'sedentary' ? 'light' : (api.activity_level ?? 'moderate'),
    allergies: api.allergens,
    dietaryRestrictions: api.dislikes,
    diagnosedDiabetes: api.diagnosed_condition ?? false,
    people: api.servings,
    maxCookingMinutes: api.max_cook_minutes ?? 30,
    budget: api.budget ?? 'standard',
    tastes: api.tastes ?? [],
    equipment: api.equipment ?? [],
  };
}

function toRequest(profile: RecipeProfile): UpdateDietProfileRequest {
  const clear: UpdateDietProfileRequest['clear'] = [];
  const body: UpdateDietProfileRequest = {
    goal: goalToApi[profile.goal] ?? 'balanced',
    sex: profile.sex,
    activity_level: profile.activity,
    allergens: profile.allergies,
    dislikes: profile.dietaryRestrictions,
    servings: profile.people,
    max_cook_minutes: profile.maxCookingMinutes,
    budget: profile.budget,
    tastes: profile.tastes,
    equipment: profile.equipment,
    diagnosed_condition: profile.diagnosedDiabetes,
    // 走到这里就是用户点了保存，问卷算填过了。
    completed: true,
  };

  // 留空表示「不想填这项」，要真的清掉服务端的旧值，
  // 而不是保持不变——否则用户删掉体重后刷新又看见它。
  const age = parseNumber(profile.age);
  if (age === undefined) clear.push('age');
  else body.age = age;

  const height = parseNumber(profile.height);
  if (height === undefined) clear.push('height_cm');
  else body.height_cm = height;

  const weight = parseNumber(profile.weight);
  if (weight === undefined) clear.push('weight_kg');
  else body.weight_kg = weight;

  const target = parseNumber(profile.targetWeight);
  if (target === undefined) clear.push('target_weight_kg');
  else body.target_weight_kg = target;

  if (clear.length > 0) body.clear = clear;
  return body;
}

function numberText(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value);
}

function parseNumber(raw: string): number | undefined {
  const text = raw.trim();
  if (text === '') return undefined;
  const value = Number(text);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}
