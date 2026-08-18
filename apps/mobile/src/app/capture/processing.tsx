import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { NavHeader } from '@/components/ui/nav-header';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';

const stages = ['输入已接收', '内容已读取', '正在理解时间与事项', '整理完成'];

export default function CaptureProcessingScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ draft?: string; images?: string; audio?: string }>();
  const [activeStage, setActiveStage] = useState(0);
  const draft = typeof params.draft === 'string' ? params.draft : '这次输入';

  useEffect(() => {
    const timers = [
      setTimeout(() => setActiveStage(1), 500),
      setTimeout(() => setActiveStage(2), 1100),
      setTimeout(() => setActiveStage(3), 1900),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <AppScreen includeBottomInset>
      <NavHeader title="正在整理" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.heroIcon}>
          <AppIcon color={colors.primaryStrong} name="sparkles" size={26} />
        </View>
        <Text accessibilityRole="header" style={styles.title}>
          {activeStage === stages.length - 1 ? '已经整理好了' : '正在理解这次输入'}
        </Text>
        <Text style={styles.subtitle}>
          {activeStage === stages.length - 1
            ? '请查看识别结果，确认后才会保存。'
            : '可以先去处理其他事情，完成后会保留在最近输入中。'}
        </Text>

        <View style={styles.sourcePanel}>
          <Text style={styles.sourceLabel}>你的输入</Text>
          <Text numberOfLines={3} style={styles.sourceText}>{draft}</Text>
          <View style={styles.sourceMeta}>
            {Number(params.images) > 0 ? (
              <Text style={styles.metaText}>{params.images} 张图片</Text>
            ) : null}
            {params.audio ? <Text style={styles.metaText}>语音 {params.audio} 秒</Text> : null}
          </View>
        </View>

        <View style={styles.stageList}>
          {stages.map((stage, index) => {
            const complete = index <= activeStage;
            const current = index === activeStage && activeStage < stages.length - 1;
            return (
              <View key={stage} style={styles.stageRow}>
                <View style={[styles.stageIcon, complete && styles.stageIconComplete]}>
                  <AppIcon
                    color={complete ? colors.background : colors.textTertiary}
                    name={current ? 'ellipsis-horizontal' : complete ? 'checkmark' : 'remove'}
                    size={17}
                  />
                </View>
                <Text style={[styles.stageText, complete && styles.stageTextActive]}>{stage}</Text>
              </View>
            );
          })}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <AppButton
          disabled={activeStage < stages.length - 1}
          label={activeStage < stages.length - 1 ? '正在整理…' : '查看整理结果'}
          onPress={() =>
            router.replace({ pathname: '/capture/confirm', params: { draft } })
          }
        />
      </View>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 20,
    paddingTop: 34,
    paddingBottom: 24,
    alignItems: 'center',
  },
  heroIcon: {
    width: 58,
    height: 58,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
  },
  title: {
    marginTop: 20,
    color: colors.text,
    fontFamily,
    ...typography.detail,
    textAlign: 'center',
  },
  subtitle: {
    maxWidth: 320,
    marginTop: 7,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
    textAlign: 'center',
  },
  sourcePanel: {
    width: '100%',
    marginTop: 32,
    padding: 16,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSubtle,
  },
  sourceLabel: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  sourceText: {
    marginTop: 6,
    color: colors.text,
    fontFamily,
    ...typography.bodyStrong,
  },
  sourceMeta: {
    marginTop: 8,
    flexDirection: 'row',
    gap: 12,
  },
  metaText: {
    color: colors.primaryStrong,
    fontFamily,
    ...typography.meta,
  },
  stageList: {
    width: '100%',
    marginTop: 24,
  },
  stageRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
  },
  stageIcon: {
    width: 30,
    height: 30,
    marginRight: 12,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  stageIconComplete: {
    backgroundColor: colors.primary,
  },
  stageText: {
    color: colors.textTertiary,
    fontFamily,
    ...typography.body,
  },
  stageTextActive: {
    color: colors.text,
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
});
