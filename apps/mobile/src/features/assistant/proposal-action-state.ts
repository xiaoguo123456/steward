/** 拒绝无需满足确认条件；空标题不能在提交时被悄悄过滤掉。 */
export function proposalActionState(
  type: string,
  busy: boolean,
  tasks: readonly { selected: boolean; title: string }[],
) {
  const selected = tasks.filter((task) => task.selected);
  const invalid = type === 'task_split' && (
    selected.length < 2 || selected.length > 10 || selected.some((task) => !task.title.trim())
  );
  return { rejectDisabled: busy, confirmDisabled: busy || invalid };
}
