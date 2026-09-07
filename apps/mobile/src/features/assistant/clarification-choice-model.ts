import type { AssistantChoice, AssistantMessage } from '@steward/api-client';

// 仅用于历史选择的视觉回显；实际目标与选项有效性仍由服务端校验。
export function selectedChoiceId(choices: AssistantChoice[], nextMessage?: AssistantMessage) {
  if (nextMessage?.role !== 'user') return undefined;
  const answer = nextMessage.content.trim();
  return choices.find((choice, index) => answer === choice.label || answer === String(index + 1))?.id;
}

// 标签保持服务端原文，只把最后两段元信息分行展示，不解析或推断领域字段。
export function choiceLabelParts(label: string) {
  const copy = label.replace(/^\d+\.\s*/, '');
  const parts = copy.split(' · ');
  return parts.length >= 3
    ? { title: parts.slice(0, -2).join(' · '), detail: parts.slice(-2).join(' · ') }
    : { title: copy, detail: '' };
}
