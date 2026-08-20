import {
  confirmMealPlan,
  errorMessage,
  useGetMealPlan,
  type MealPlan as ApiMealPlan,
} from '@steward/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import type { MealSlot, WeekDay, WeekDayId, WeekPlan } from './model';

/**
 * 本周菜单。
 *
 * 已确认的菜单在服务端；用户正在调整、还没点「采用」的那一版留在本地。
 * 规格 8.2.2 要求预览只是预览，所以草稿不落库——用户改到一半退出去，
 * 下次看到的应当仍是他上次确认过的那份，而不是一个改了一半的东西。
 *
 * 这一周从哪天开始由服务端算：周一还是周日开始是用户设置，
 * 客户端自己推会和服务端不一致。
 */
export function useMealPlan() {
  const queryClient = useQueryClient();
  const query = useGetMealPlan();
  const [draft, setDraft] = useState<WeekPlan | null>(null);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const plan = query.data?.data;
  const weekStart = plan?.week_start ?? '';

  const days = useMemo(() => weekDaysFrom(weekStart), [weekStart]);
  const confirmed = useMemo(() => toWeekPlan(plan, days), [plan, days]);

  const confirm = async () => {
    if (!draft || !weekStart) return false;
    setSaving(true);
    setFailure(null);
    try {
      await confirmMealPlan(
        {
          week_start: weekStart,
          entries: toEntries(draft),
        },
        // 带上版本号：别人在另一台设备上改过这一周时，
        // 服务端会返回 VERSION_CONFLICT 而不是默默覆盖掉。
        { headers: { 'If-Match': String(plan?.version ?? 0) } },
      );
      await queryClient.invalidateQueries();
      setDraft(null);
      return true;
    } catch (error) {
      setFailure(errorMessage(error, '菜单没能保存。'));
      return false;
    } finally {
      setSaving(false);
    }
  };

  return {
    days,
    weekStart,
    /** 当前展示的菜单：有草稿看草稿，否则看已确认的。 */
    plan: draft ?? confirmed,
    hasPendingPlan: draft !== null,
    loading: query.isPending,
    failed: query.isError,
    error: query.error,
    saving,
    failure,
    plannedNutrition: plan?.planned_nutrition,

    setRecipeForMeal: (dayId: WeekDayId, meal: MealSlot, recipeId: string) => {
      setDraft((current) => {
        const base = current ?? confirmed;
        return { ...base, [dayId]: { ...base[dayId], [meal]: recipeId } };
      });
    },
    replaceWeek: (next: WeekPlan) => setDraft(next),
    confirm,
    discard: () => {
      setDraft(null);
      setFailure(null);
    },
    refetch: () => void query.refetch(),
  };
}

/**
 * 由本周第一天推出七天。
 *
 * 只有起点来自服务端；剩下六天是纯日期加法，本地算不会有歧义。
 */
export function weekDaysFrom(weekStart: string): WeekDay[] {
  if (!weekStart) return [];
  const labels = ['日', '一', '二', '三', '四', '五', '六'];
  const today = isoDate(new Date());

  return Array.from({ length: 7 }, (_, offset) => {
    const day = addDays(weekStart, offset);
    const parsed = new Date(`${day}T00:00:00`);
    const weekday = labels[parsed.getDay()];
    return {
      id: day,
      weekday,
      label: `周${weekday}`,
      date: String(parsed.getDate()),
      fullDate: `${parsed.getMonth() + 1}月${parsed.getDate()}日`,
      isToday: day === today,
    };
  });
}

/** 服务端的条目列表摊平成「哪天哪餐吃什么」。 */
function toWeekPlan(plan: ApiMealPlan | undefined, days: WeekDay[]): WeekPlan {
  const out: WeekPlan = {};
  // 先把七天都摆出来，空着的格子也要能渲染成「还没安排」。
  for (const day of days) {
    out[day.id] = { breakfast: '', lunch: '', dinner: '' };
  }
  for (const entry of plan?.entries ?? []) {
    const day = out[entry.date];
    if (day) day[entry.meal_slot as MealSlot] = entry.recipe_id;
  }
  return out;
}

/** 摊平的菜单转回契约的条目数组。空格子不提交。 */
function toEntries(plan: WeekPlan) {
  const entries: { date: string; meal_slot: MealSlot; recipe_id: string }[] = [];
  for (const [date, meals] of Object.entries(plan)) {
    for (const meal of ['breakfast', 'lunch', 'dinner'] as const) {
      const recipeId = meals[meal];
      if (recipeId) entries.push({ date, meal_slot: meal, recipe_id: recipeId });
    }
  }
  return entries;
}

function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00`);
  parsed.setDate(parsed.getDate() + days);
  return isoDate(parsed);
}

function isoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
