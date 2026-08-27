type ResetListener = () => void;

const listeners = new Set<ResetListener>();
let resetVersion = 0;

/** 用户离开计划一级页时，只重置页内临时视图，不清空查询和列表状态。 */
export function requestPlanTransientViewReset() {
  resetVersion += 1;
  listeners.forEach((listener) => listener());
}

export function getPlanTransientViewResetVersion() {
  return resetVersion;
}

/** 旧版本的页内视图已经失效；查询缓存和一级页自身状态不受影响。 */
export function resolvePlanTransientView<View>(
  view: View,
  viewResetVersion: number,
  currentResetVersion: number,
): View | null {
  return viewResetVersion === currentResetVersion ? view : null;
}

export function subscribePlanTransientViewReset(listener: ResetListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
