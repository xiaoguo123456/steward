import {
  errorMessage,
  useAnswerCaptureQuestion,
  useListCaptureQuestions,
} from '@steward/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { AiAssistantAvatar } from '@/components/ui/ai-assistant-avatar';
import { AppButton } from '@/components/ui/app-button';
import { AppIcon } from '@/components/ui/icon';
import { ModalSheet } from '@/components/ui/modal-sheet';
import { StatePanel } from '@/components/ui/state-panel';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';

/**
 * 全局 AI 待答面板。
 *
 * 待答问题属于 Capture，不进入通用 Assistant 的自由对话写入路径。回答后由服务端
 * 创建新 revision 并重新解析，最终仍回到统一确认页。
 */
export default function PendingAssistantScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const questions = useListCaptureQuestions({ status: 'open', limit: 100 });
  const answerQuestion = useAnswerCaptureQuestion();
  const [answer, setAnswer] = useState('');
  const [failure, setFailure] = useState<string | null>(null);

  const pending = questions.data?.data ?? [];
  const current = pending[0];
  const submitting = answerQuestion.isPending;
  const canSubmit = Boolean(current && answer.trim()) && !submitting;

  const submit = async (value = answer) => {
    const normalized = value.trim();
    if (!current || !normalized || submitting) return;
    setFailure(null);
    try {
      const response = await answerQuestion.mutateAsync({
        questionId: current.id,
        data: { answer: normalized },
      });
      await queryClient.invalidateQueries();
      router.replace({
        pathname: '/capture/processing',
        params: {
          captureId: response.data.resource_id ?? current.capture_id,
          operationId: response.data.operation_id,
          draft: normalized,
        },
      });
    } catch (error) {
      setFailure(errorMessage(error, '这条补充暂时没能提交，请稍后重试。'));
    }
  };

  return (
    <ModalSheet maxHeight="84%" onClose={() => router.back()}>
      <View style={styles.header}>
        <AiAssistantAvatar size={38} />
        <View style={styles.headerCopy}>
          <Text accessibilityRole="header" style={styles.headerTitle}>AI 管家</Text>
          <Text style={styles.headerStatus}>
            {pending.length > 0 ? `${pending.length} 项等你补充` : '没有待处理问题'}
          </Text>
        </View>
        <Pressable
          accessibilityLabel="关闭待答面板"
          accessibilityRole="button"
          onPress={() => router.back()}
          style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
        >
          <AppIcon color={colors.textSecondary} name="close" size={21} />
        </Pressable>
      </View>

      {questions.isPending ? (
        <View accessibilityLabel="正在加载待答问题" style={styles.loading}>
          <View style={[styles.skeleton, styles.skeletonShort]} />
          <View style={[styles.skeleton, styles.skeletonWide]} />
          <View style={[styles.skeleton, styles.skeletonMedium]} />
        </View>
      ) : questions.isError ? (
        <View style={styles.stateWrap}>
          <StatePanel
            actionLabel="重试"
            icon="cloud-offline-outline"
            message={errorMessage(questions.error, '暂时无法读取待答问题。')}
            onAction={() => void questions.refetch()}
            title="加载失败"
          />
        </View>
      ) : current ? (
        <>
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.summaryRow}>
              <AppIcon color={colors.primaryStrong} name="document-text-outline" size={17} />
              <Text numberOfLines={2} style={styles.summaryText}>
                {current.capture_summary ?? '刚才的一次输入'}
              </Text>
            </View>

            <View style={styles.questionBlock}>
              <Text style={styles.questionLabel}>需要你确认</Text>
              <Text style={styles.question}>{current.question}</Text>
            </View>

            {(current.quick_answers?.length ?? 0) > 0 ? (
              <View accessibilityRole="radiogroup" style={styles.quickAnswers}>
                {current.quick_answers?.map((option) => (
                  <Pressable
                    accessibilityRole="button"
                    disabled={submitting}
                    key={option}
                    onPress={() => void submit(option)}
                    style={({ pressed }) => [styles.quickAnswer, pressed && styles.pressed]}
                  >
                    <Text style={styles.quickAnswerText}>{option}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            {failure ? (
              <Text accessibilityLiveRegion="assertive" accessibilityRole="alert" style={styles.failure}>
                {failure}
              </Text>
            ) : null}
          </ScrollView>

          <View style={styles.composer}>
            <TextInput
              accessibilityLabel="补充说明"
              editable={!submitting}
              multiline
              onChangeText={(value) => {
                setAnswer(value);
                setFailure(null);
              }}
              placeholder="也可以输入自己的说明"
              placeholderTextColor={colors.textTertiary}
              style={styles.input}
              value={answer}
            />
            <AppButton
              disabled={!canSubmit}
              label={submitting ? '正在提交…' : '发送补充'}
              onPress={() => void submit()}
              style={styles.submit}
            />
          </View>
        </>
      ) : (
        <View style={styles.stateWrap}>
          <StatePanel
            actionLabel="继续和 AI 对话"
            icon="checkmark-circle-outline"
            message="需要你处理的 Capture 问题已经全部完成。"
            onAction={() => router.replace('/ai')}
            title="暂时没有待答"
          />
        </View>
      )}
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
  headerCopy: {
    minWidth: 0,
    marginLeft: 10,
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
  content: {
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 22,
  },
  summaryRow: {
    minHeight: 46,
    paddingHorizontal: 12,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.primarySoft,
  },
  summaryText: {
    minWidth: 0,
    flex: 1,
    color: colors.primaryStrong,
    fontFamily,
    ...typography.meta,
    fontWeight: '600',
  },
  questionBlock: {
    paddingVertical: 24,
  },
  questionLabel: {
    color: colors.warning,
    fontFamily,
    ...typography.meta,
    fontWeight: '700',
  },
  question: {
    marginTop: 8,
    color: colors.text,
    fontFamily,
    fontSize: 20,
    lineHeight: 30,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  quickAnswers: {
    gap: 8,
  },
  quickAnswer: {
    minHeight: 48,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  quickAnswerText: {
    color: colors.text,
    fontFamily,
    ...typography.body,
  },
  composer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  input: {
    minHeight: 54,
    maxHeight: 116,
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderRadius: radius.md,
    color: colors.text,
    fontFamily,
    ...typography.body,
    backgroundColor: colors.surfaceSubtle,
    textAlignVertical: 'top',
  },
  submit: {
    marginTop: 10,
  },
  failure: {
    marginTop: 14,
    color: colors.danger,
    fontFamily,
    ...typography.meta,
  },
  loading: {
    minHeight: 300,
    padding: 24,
    gap: 12,
  },
  skeleton: {
    height: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  skeletonShort: {
    width: '34%',
  },
  skeletonWide: {
    width: '92%',
  },
  skeletonMedium: {
    width: '68%',
  },
  stateWrap: {
    minHeight: 300,
    padding: 16,
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.66,
  },
});
