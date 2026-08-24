/**
 * Assistant 消息中的链接只允许显式 HTTPS 地址。
 * 相对路径、自定义 scheme 与可执行协议都保持为不可点击文本。
 */
export function normalizeAssistantLink(value: string): string | undefined {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || !url.hostname) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

/** 远程图片不在对话中加载，只保留模型提供的文字说明。 */
export function assistantImageAlternative(alt: string | undefined): string {
  const normalized = alt?.trim();
  return normalized ? `图片：${normalized}` : '图片已省略';
}
