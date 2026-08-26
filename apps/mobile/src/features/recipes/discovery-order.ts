type DiscoveryOrderOptions = {
  category: string;
  query: string;
  seed: number;
};

/**
 * 发现页的展示顺序只影响浏览，不改变服务端分类、搜索结果或推荐权重。
 * 搜索时保留服务端顺序；无关键词时按当前浏览会话和分类稳定洗牌。
 */
export function orderDiscoveryRecipes<T extends { id: string }>(
  recipes: T[],
  { category, query, seed }: DiscoveryOrderOptions,
): T[] {
  if (query.trim() || recipes.length < 2) return recipes;

  const result = [...recipes];
  let state = hashSeed(`${seed}:${category}`);
  for (let index = result.length - 1; index > 0; index -= 1) {
    state = nextRandom(state);
    const target = state % (index + 1);
    [result[index], result[target]] = [result[target] as T, result[index] as T];
  }
  return result;
}

export function createDiscoveryShuffleSeed(): number {
  return (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
}

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function nextRandom(value: number): number {
  let next = value || 0x6d2b79f5;
  next ^= next << 13;
  next ^= next >>> 17;
  next ^= next << 5;
  return next >>> 0;
}
