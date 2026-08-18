import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppIcon } from '@/components/ui/icon';
import { ModalSheet } from '@/components/ui/modal-sheet';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';

type Message = {
  id: string;
  role: 'assistant' | 'user';
  text: string;
  result?: boolean;
};

const initialMessages: Message[] = [
  {
    id: 'question',
    role: 'assistant',
    text: '这次输入里出现了两个时间。产品需求评审应该安排在哪一个？',
  },
];

const quickReplies = ['周四 15:00', '周五上午', '稍后补充'];

export default function AiConversationScreen() {
  const router = useRouter();
  const messageListRef = useRef<ScrollView>(null);
  const messageCounterRef = useRef(0);
  const [messages, setMessages] = useState(initialMessages);
  const [input, setInput] = useState('');
  const [answered, setAnswered] = useState(false);

  const scrollToLatest = () => {
    requestAnimationFrame(() => messageListRef.current?.scrollToEnd({ animated: true }));
  };

  const sendContent = (content: string) => {
    const normalized = content.trim();
    if (!normalized) return;
    messageCounterRef.current += 1;
    const messageId = messageCounterRef.current.toString();
    const resultText = normalized === '稍后补充'
      ? '好的，这个问题会保留。你可以关闭面板，之后再继续。'
      : `已采用“${normalized}”。我重新整理了这次输入，请查看并确认。`;
    setMessages((current) => [
      ...current,
      { id: `${messageId}-user`, role: 'user', text: normalized },
      {
        id: `${messageId}-assistant`,
        role: 'assistant',
        text: resultText,
        result: normalized !== '稍后补充',
      },
    ]);
    setAnswered(true);
    setInput('');
    scrollToLatest();
  };

  return (
    <ModalSheet maxHeight="84%" onClose={() => router.back()}>
      <View style={styles.header}>
        <View style={styles.headerIcon}>
          <AppIcon color={colors.primaryStrong} name="sparkles" size={19} />
        </View>
        <View style={styles.headerCopy}>
          <Text accessibilityRole="header" style={styles.headerTitle}>AI 管家</Text>
          <Text style={styles.headerStatus}>{answered ? '这次输入已更新' : '1 个问题待确认'}</Text>
        </View>
        <Pressable
          accessibilityLabel="关闭 AI 管家"
          accessibilityRole="button"
          onPress={() => router.back()}
          style={({ pressed }) => [styles.closeButton, pressed && styles.iconPressed]}
        >
          <AppIcon name="close" size={23} />
        </Pressable>
      </View>

      <ScrollView
        ref={messageListRef}
        accessibilityLabel="与 AI 管家的对话"
        accessibilityLiveRegion="polite"
        contentContainerStyle={styles.messages}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={scrollToLatest}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.sourceCard}>
          <View style={styles.sourceTopLine}>
            <AppIcon color={colors.textSecondary} name="document-text-outline" size={17} />
            <Text style={styles.sourceLabel}>原始输入摘要</Text>
          </View>
          <Text numberOfLines={2} style={styles.sourceText}>
            产品评审调整到本周，图片里有周四和周五两个时间。
          </Text>
        </View>

        {messages.map((message) => (
          <View
            key={message.id}
            style={[styles.messageRow, message.role === 'user' && styles.userRow]}
          >
            {message.role === 'assistant' ? (
              <View style={styles.assistantMark}>
                <AppIcon color={colors.background} name="sparkles" size={12} />
              </View>
            ) : null}
            <View
              style={[
                styles.bubble,
                message.role === 'user' ? styles.userBubble : styles.assistantBubble,
              ]}
            >
              <Text style={[styles.messageText, message.role === 'user' && styles.userText]}>
                {message.text}
              </Text>
              {message.result ? (
                <AppButton
                  compact
                  label="查看并确认"
                  onPress={() =>
                    router.replace({
                      pathname: '/capture/confirm',
                      params: { draft: '周四 15:00 产品需求评审' },
                    })
                  }
                  style={styles.resultButton}
                />
              ) : null}
            </View>
          </View>
        ))}

        {!answered ? (
          <View style={styles.quickReplies}>
            {quickReplies.map((reply) => (
              <Pressable
                accessibilityRole="button"
                key={reply}
                onPress={() => sendContent(reply)}
                style={({ pressed }) => [styles.quickReply, pressed && styles.quickReplyPressed]}
              >
                <Text style={styles.quickReplyText}>{reply}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.composerWrap}>
        <View style={styles.composer}>
          <Pressable
            accessibilityLabel="使用语音回答"
            accessibilityRole="button"
            style={({ pressed }) => [styles.composerButton, pressed && styles.iconPressed]}
          >
            <AppIcon color={colors.textSecondary} name="mic-outline" size={21} />
          </Pressable>
          <TextInput
            accessibilityLabel="输入给 AI 管家的消息"
            onChangeText={setInput}
            onSubmitEditing={() => sendContent(input)}
            placeholder="输入回答…"
            placeholderTextColor={colors.textTertiary}
            returnKeyType="send"
            style={styles.input}
            value={input}
          />
          <Pressable
            accessibilityLabel="发送回答"
            accessibilityRole="button"
            accessibilityState={{ disabled: !input.trim() }}
            disabled={!input.trim()}
            onPress={() => sendContent(input)}
            style={({ pressed }) => [
              styles.sendButton,
              !input.trim() && styles.sendDisabled,
              pressed && input.trim() && styles.sendPressed,
            ]}
          >
            <AppIcon
              color={input.trim() ? colors.background : colors.textSecondary}
              name="arrow-up"
              size={19}
            />
          </Pressable>
        </View>
      </View>
    </ModalSheet>
  );
}

const styles = StyleSheet.create({
  header: {
    minHeight: 66,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerIcon: {
    width: 36,
    height: 36,
    marginRight: 10,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
  },
  headerCopy: {
    flex: 1,
  },
  headerTitle: {
    color: colors.text,
    fontFamily,
    ...typography.section,
  },
  headerStatus: {
    marginTop: 1,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconPressed: {
    backgroundColor: colors.surface,
  },
  messages: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 22,
    gap: 16,
  },
  sourceCard: {
    padding: 14,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSubtle,
  },
  sourceTopLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  sourceLabel: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
    fontWeight: '600',
  },
  sourceText: {
    marginTop: 7,
    color: colors.text,
    fontFamily,
    ...typography.body,
  },
  messageRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
  },
  userRow: {
    justifyContent: 'flex-end',
  },
  assistantMark: {
    width: 28,
    height: 28,
    marginTop: 2,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryStrong,
  },
  bubble: {
    maxWidth: '84%',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: radius.lg,
  },
  assistantBubble: {
    borderTopLeftRadius: 7,
    backgroundColor: colors.surfaceSubtle,
  },
  userBubble: {
    borderTopRightRadius: 7,
    backgroundColor: colors.primary,
  },
  messageText: {
    color: colors.text,
    fontFamily,
    ...typography.body,
  },
  userText: {
    color: colors.background,
  },
  resultButton: {
    marginTop: 12,
  },
  quickReplies: {
    marginLeft: 37,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  quickReply: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
  },
  quickReplyPressed: {
    backgroundColor: colors.primaryTrack,
  },
  quickReplyText: {
    color: colors.primaryStrong,
    fontFamily,
    ...typography.label,
    fontWeight: '600',
  },
  composerWrap: {
    padding: 12,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  composer: {
    minHeight: 54,
    paddingHorizontal: 4,
    borderRadius: radius.lg,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  composerButton: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    minWidth: 0,
    height: 48,
    paddingVertical: 0,
    color: colors.text,
    fontFamily,
    ...typography.input,
  },
  sendButton: {
    width: 42,
    height: 42,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  sendDisabled: {
    backgroundColor: colors.border,
  },
  sendPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.96 }],
  },
});
