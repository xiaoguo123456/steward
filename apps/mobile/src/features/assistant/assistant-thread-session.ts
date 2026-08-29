export type AssistantThreadSession = {
  threadId: string;
  mode: 'default' | 'fresh' | 'selected';
};

export type AssistantThreadSessionAction =
  | { type: 'restore_current'; threadId: string }
  | { type: 'start_fresh' }
  | { type: 'attach_thread'; threadId: string }
  | { type: 'select_thread'; threadId: string };

export function createAssistantThreadSession(
  routeThreadId?: string,
  startFresh = false,
): AssistantThreadSession {
  const threadId = routeThreadId?.trim() ?? '';
  return {
    threadId,
    mode: threadId ? 'selected' : startFresh ? 'fresh' : 'default',
  };
}

/**
 * 管理默认恢复、历史选择和显式新建之间的竞争关系。
 * 尤其要阻止已经返回的“今天对话”请求覆盖用户刚刚点击的新对话。
 */
export function assistantThreadSessionReducer(
  state: AssistantThreadSession,
  action: AssistantThreadSessionAction,
): AssistantThreadSession {
  switch (action.type) {
    case 'restore_current': {
      const threadId = action.threadId.trim();
      if (!threadId || state.mode !== 'default' || state.threadId) return state;
      return { threadId, mode: 'default' };
    }
    case 'start_fresh':
      return { threadId: '', mode: 'fresh' };
    case 'attach_thread': {
      const threadId = action.threadId.trim();
      return threadId ? { threadId, mode: 'default' } : state;
    }
    case 'select_thread': {
      const threadId = action.threadId.trim();
      return threadId ? { threadId, mode: 'selected' } : state;
    }
    default:
      return state;
  }
}
