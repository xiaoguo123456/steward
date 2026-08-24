import { memo } from 'react';
import { Alert, Linking, StyleSheet, Text } from 'react-native';
import Markdown, {
  MarkdownIt,
  type RenderRules,
} from 'react-native-markdown-renderer';

import { colors, fontFamily, radius, typography } from '@/theme/tokens';

import {
  assistantImageAlternative,
  normalizeAssistantLink,
} from './assistant-markdown-policy';

const assistantMarkdownParser = MarkdownIt({
  breaks: true,
  html: false,
  linkify: false,
  typographer: false,
}).disable(['table']);

const markdownRules: RenderRules = {
  link: (node, children, _parents, styles) => {
    const url = normalizeAssistantLink(node.attributes.href ?? '');

    if (!url) {
      return <Text key={node.key}>{children}</Text>;
    }

    return (
      <Text
        accessibilityRole="link"
        key={node.key}
        onPress={() => {
          void Linking.openURL(url).catch(() => {
            Alert.alert('链接无法打开', '请稍后再试。');
          });
        }}
        style={styles.link as object}
      >
        {children}
      </Text>
    );
  },
  image: (node, _children, _parents, styles) => {
    const label = assistantImageAlternative(node.attributes.alt);
    return (
      <Text accessibilityLabel={label} key={node.key} style={styles.imageAlternative as object}>
        〔{label}〕
      </Text>
    );
  },
};

const markdownStyles = StyleSheet.create({
  root: {
    width: '100%',
  },
  text: {
    color: colors.text,
    fontFamily,
    ...typography.body,
  },
  paragraph: {
    marginTop: 0,
    marginBottom: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
  },
  strong: {
    fontWeight: '600',
  },
  em: {
    fontStyle: 'italic',
  },
  headingContainer: {
    marginTop: 2,
    marginBottom: 8,
    flexDirection: 'row',
  },
  heading: {
    color: colors.text,
    fontFamily,
    fontWeight: '600',
  },
  heading1: typography.section,
  heading2: typography.section,
  heading3: typography.bodyStrong,
  heading4: typography.bodyStrong,
  heading5: typography.bodyStrong,
  heading6: typography.bodyStrong,
  heading1Container: {
    paddingBottom: 0,
    borderBottomWidth: 0,
  },
  heading2Container: {
    paddingBottom: 0,
    borderBottomWidth: 0,
  },
  list: {
    marginBottom: 8,
  },
  listItem: {
    flex: 1,
    flexWrap: 'wrap',
  },
  listUnorderedItem: {
    marginTop: 0,
    marginBottom: 4,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  listOrderedItem: {
    marginTop: 0,
    marginBottom: 4,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  listUnorderedItemIcon: {
    marginLeft: 1,
    marginRight: 8,
    color: colors.textSecondary,
    fontFamily,
    ...typography.body,
  },
  listOrderedItemIcon: {
    minWidth: 18,
    marginLeft: 0,
    marginRight: 6,
    color: colors.textSecondary,
    fontFamily,
    ...typography.body,
  },
  listUnorderedItemText: {
    color: colors.text,
    fontFamily,
    ...typography.body,
  },
  listOrderedItemText: {
    color: colors.text,
    fontFamily,
    ...typography.body,
  },
  codeInline: {
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 5,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: 13,
    lineHeight: 20,
  },
  codeBlock: {
    marginBottom: 8,
    padding: 10,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: 13,
    lineHeight: 20,
  },
  pre: {
    marginBottom: 0,
  },
  blockquote: {
    marginBottom: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderLeftWidth: 0,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  hr: {
    height: StyleSheet.hairlineWidth,
    marginTop: 8,
    marginBottom: 12,
    backgroundColor: colors.borderStrong,
  },
  link: {
    color: colors.primaryStrong,
    textDecorationLine: 'underline',
  },
  imageAlternative: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
});

/**
 * 将 Assistant 的最终文本按受限 Markdown 渲染。
 * 图片不会触发网络请求，非 HTTPS 链接不会获得点击行为。
 */
export const AssistantMarkdown = memo(function AssistantMarkdown({
  content,
}: {
  content: string;
}) {
  return (
    <Markdown
      allowedImageHandlers={[]}
      defaultImageHandler={null}
      markdownit={assistantMarkdownParser}
      rules={markdownRules}
      style={markdownStyles}
    >
      {content}
    </Markdown>
  );
});
