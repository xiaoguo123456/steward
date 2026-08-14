import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppIcon } from '@/components/ui/icon';
import { colors, fontFamily, radius } from '@/theme/tokens';

type Message = {
  id: string;
  role: 'assistant' | 'user';
  text: string;
};

const initialMessages: Message[] = [
  {
    id: 'hello',
    role: 'assistant',
    text: '你好呀，我是你的 AI 助手。可以帮你管理任务、安排日程、总结一天。',
  },
  { id: 'question', role: 'user', text: '帮我总结一下今天的任务吧' },
  {
    id: 'summary',
    role: 'assistant',
    text: '你今天共 5 项任务，已完成 3 项，继续保持！',
  },
];

export default function AiConversationScreen() {
  const router = useRouter();
  const messageListRef = useRef<ScrollView>(null);
  const [messages, setMessages] = useState(initialMessages);
  const [input, setInput] = useState('');

  const close = () => {
    Keyboard.dismiss();
    router.back();
  };

  const scrollToLatest = (animated = true) => {
    requestAnimationFrame(() => {
      messageListRef.current?.scrollToEnd({ animated });
    });
  };

  const send = () => {
    const content = input.trim();
    if (!content) return;
    const stamp = Date.now().toString();
    setMessages((current) => [
      ...current,
      { id: `${stamp}-user`, role: 'user', text: content },
      {
        id: `${stamp}-assistant`,
        role: 'assistant',
        text: '收到，我先记下了。后续接入服务端后会继续帮你整理和执行。',
      },
    ]);
    setInput('');
  };

  return (
    <SafeAreaView edges={['top', 'right', 'bottom', 'left']} style={styles.overlay}>
      <Pressable accessibilityLabel="关闭 AI 助手" onPress={close} style={styles.backdrop} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardArea}
      >
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <View style={styles.headerCopy}>
              <Text style={styles.headerTitle}>AI 管家</Text>
              <Text style={styles.headerStatus}>随时可以继续</Text>
            </View>
            <Pressable
              accessibilityLabel="关闭 AI 管家"
              accessibilityRole="button"
              onPress={close}
              style={({ pressed }) => [styles.headerButton, pressed && styles.iconButtonPressed]}
            >
              <AppIcon name="close" size={24} />
            </Pressable>
          </View>
          <ScrollView
            ref={messageListRef}
            accessibilityLabel="与 AI 管家的对话"
            accessibilityLiveRegion="polite"
            contentContainerStyle={styles.messages}
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() => scrollToLatest(false)}
            showsVerticalScrollIndicator={false}
            style={styles.messageList}
          >
            {messages.map((message) => (
              <View
                key={message.id}
                style={[
                  styles.messageRow,
                  message.role === 'user' ? styles.userRow : styles.assistantRow,
                ]}
              >
                {message.role === 'assistant' ? (
                  <View style={styles.aiAvatar}>
                    <AppIcon color={colors.background} name="sparkles" size={13} />
                  </View>
                ) : null}
                <View
                  style={[
                    styles.bubble,
                    message.role === 'user' ? styles.userBubble : styles.assistantBubble,
                  ]}
                >
                  <Text
                    style={[
                      styles.messageText,
                      message.role === 'user' && styles.userMessageText,
                    ]}
                  >
                    {message.text}
                  </Text>
                </View>
              </View>
            ))}
          </ScrollView>
          <View style={styles.composer}>
            <Pressable
              accessibilityLabel="使用语音回答"
              accessibilityRole="button"
              hitSlop={2}
              style={({ pressed }) => [styles.composerIconButton, pressed && styles.iconButtonPressed]}
            >
              <AppIcon color={colors.textSecondary} name="mic-outline" size={21} />
            </Pressable>
            <TextInput
              accessibilityLabel="输入给 AI 管家的消息"
              onChangeText={setInput}
              onFocus={() => scrollToLatest(false)}
              onSubmitEditing={send}
              placeholder="输入消息…"
              placeholderTextColor={colors.textSecondary}
              returnKeyType="send"
              style={styles.input}
              value={input}
            />
            <Pressable
              accessibilityLabel="发送消息"
              accessibilityRole="button"
              accessibilityState={{ disabled: !input.trim() }}
              disabled={!input.trim()}
              hitSlop={2}
              onPress={send}
              style={({ pressed }) => [
                styles.sendButton,
                !input.trim() && styles.sendButtonDisabled,
                pressed && styles.sendButtonPressed,
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
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(9, 25, 19, 0.14)',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  keyboardArea: {
    flex: 1,
    width: '100%',
    paddingHorizontal: 15,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheet: {
    flex: 1,
    width: '100%',
    maxWidth: 370,
    maxHeight: 500,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#C8F0DB',
    borderRadius: 28,
    backgroundColor: colors.background,
  },
  sheetHeader: {
    minHeight: 60,
    paddingLeft: 17,
    paddingRight: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerCopy: {
    flex: 1,
    gap: 1,
  },
  headerTitle: {
    color: colors.text,
    fontFamily,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '700',
  },
  headerStatus: {
    color: colors.textSecondary,
    fontFamily,
    fontSize: 12,
    lineHeight: 17,
  },
  headerButton: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  messageList: {
    flex: 1,
  },
  messages: {
    paddingHorizontal: 17,
    paddingTop: 16,
    paddingBottom: 20,
    gap: 18,
  },
  messageRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
  },
  assistantRow: {
    justifyContent: 'flex-start',
  },
  userRow: {
    justifyContent: 'flex-end',
  },
  aiAvatar: {
    width: 28,
    height: 28,
    marginTop: 1,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryStrong,
  },
  bubble: {
    maxWidth: '82%',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: radius.lg,
  },
  assistantBubble: {
    borderWidth: 1,
    borderColor: colors.border,
    borderTopLeftRadius: 7,
    backgroundColor: colors.background,
  },
  userBubble: {
    borderTopRightRadius: 7,
    backgroundColor: colors.primaryStrong,
  },
  messageText: {
    color: colors.text,
    fontFamily,
    fontSize: 14,
    lineHeight: 22,
  },
  userMessageText: {
    color: colors.background,
  },
  composer: {
    minHeight: 52,
    margin: 14,
    marginTop: 0,
    paddingHorizontal: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  composerIconButton: {
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
    fontSize: 14,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryStrong,
  },
  sendButtonDisabled: {
    backgroundColor: colors.border,
  },
  sendButtonPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.96 }],
  },
  iconButtonPressed: {
    backgroundColor: colors.border,
  },
});
