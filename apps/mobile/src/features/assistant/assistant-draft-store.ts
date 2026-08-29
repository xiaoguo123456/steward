export type AssistantDraft = {
  text: string;
  contextLabel: string;
  /** 只有灵感入口使用全屏呈现；普通全局入口保持底部面板。 */
  surface?: 'inspiration';
  /** 全屏页本地展示的问题，不会仅因打开页面就写入服务端。 */
  openingPrompt?: string;
  /** 用户首次发送时附加给 Assistant 的上下文，不进入路由 URL。 */
  firstTurnContext?: string;
};

let pendingDraft: AssistantDraft | null = null;

/**
 * 在页面跳转间暂存一条待用户确认发送的 Assistant 输入。
 *
 * 不写入持久化存储，也不把私人正文放入 URL；读取后立即清空。
 */
export function stageAssistantDraft(draft: AssistantDraft): void {
  pendingDraft = draft;
}

export function takeAssistantDraft(): AssistantDraft | null {
  const draft = pendingDraft;
  pendingDraft = null;
  return draft;
}
