const CONTEXT_MARKER = '【灵感上下文】';
const ANSWER_MARKER = '【我的想法】';
const TRANSCRIPT_LIMIT = 6_000;

type TranscriptMessage = {
  role: string;
  content: string;
};

/** 首次回复携带所选问题，但界面只展示用户真正输入的部分。 */
export function buildInspirationTurnText(context: string, answer: string): string {
  return [
    CONTEXT_MARKER,
    context.trim(),
    '',
    ANSWER_MARKER,
    answer.trim(),
  ].join('\n');
}

/** 普通消息原样返回；只有符合完整标记格式的灵感首条回复才隐藏上下文模板。 */
export function visibleInspirationUserText(content: string): string {
  if (!content.startsWith(`${CONTEXT_MARKER}\n`)) return content;
  const marker = `\n\n${ANSWER_MARKER}\n`;
  const answerIndex = content.indexOf(marker);
  return answerIndex >= 0 ? content.slice(answerIndex + marker.length) : content;
}

/** 将一次灵感对话转成受控的 Note Capture 输入，长度上限避免复制无限历史。 */
export function buildInspirationNoteCaptureText(
  openingPrompt: string,
  messages: readonly TranscriptMessage[],
): string {
  const transcript = [
    `开场问题：${openingPrompt.trim()}`,
    ...messages.map((message) => {
      const speaker = message.role === 'user' ? '我' : '助理';
      const content = message.role === 'user'
        ? visibleInspirationUserText(message.content)
        : message.content;
      return `${speaker}：${content.trim()}`;
    }),
  ].join('\n\n');
  const limited = transcript.length > TRANSCRIPT_LIMIT
    ? transcript.slice(transcript.length - TRANSCRIPT_LIMIT)
    : transcript;

  return [
    '请把下面这次灵感对话整理成一条笔记候选。',
    '只把用户明确表达的内容当作事实；助理回复只能帮助组织结构，不能补写新的经历或结论。',
    '保留自然的第一人称表达，生成清晰标题和正文，不创建任务、日程或长期记忆。',
    '',
    limited,
  ].join('\n');
}

export function buildInspirationTaskProposalRequest(): string {
  return [
    '请根据刚才这次灵感对话，提炼一条最明确、现在可执行的待办建议。',
    '只生成 task_create Proposal，不要直接执行；如果还缺少关键信息，只追问一个问题。',
  ].join('\n');
}
