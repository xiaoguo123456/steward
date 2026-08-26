/**
 * 把指定清单移动到目标位置。拖动与无障碍“上移／下移”共用这段确定性逻辑。
 */
export function moveTaskList<T extends { id: string }>(
  lists: T[],
  listId: string,
  targetIndex: number,
): T[] {
  const sourceIndex = lists.findIndex((list) => list.id === listId);
  if (sourceIndex < 0 || lists.length < 2) return lists;

  const boundedTarget = Math.max(0, Math.min(targetIndex, lists.length - 1));
  if (sourceIndex === boundedTarget) return lists;

  const next = [...lists];
  const [moved] = next.splice(sourceIndex, 1);
  next.splice(boundedTarget, 0, moved);
  return next;
}

/** 只返回真正变化的位置，避免排序时产生无意义的并发更新。 */
export function changedTaskListPositions<T extends { position: number }>(lists: T[]) {
  return lists.flatMap((list, index) => (
    list.position === index ? [] : [{ list, position: index }]
  ));
}
