import { useLocalSearchParams } from 'expo-router';
import { useState, type ComponentProps } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { AppScreen } from '@/components/ui/app-screen';
import { FlatListGroup, FlatListRow } from '@/components/ui/flat-list';
import { AppIcon } from '@/components/ui/icon';
import { NavHeader } from '@/components/ui/nav-header';
import { colors, fontFamily, typography } from '@/theme/tokens';

type SettingRow = {
  id: string;
  title: string;
  subtitle?: string;
  icon: ComponentProps<typeof AppIcon>['name'];
  value?: string;
  toggle?: boolean;
};

type SectionConfig = {
  title: string;
  summary: string;
  groups: { title: string; rows: SettingRow[] }[];
};

const sectionConfigs: Record<string, SectionConfig> = {
  habits: {
    title: '使用习惯',
    summary: '这些设置会影响默认时间与智能安排建议。',
    groups: [
      {
        title: '时间偏好',
        rows: [
          { id: 'work-hours', title: '工作时间', subtitle: '工作日', icon: 'time-outline', value: '09:00—18:00' },
          { id: 'weekend', title: '周末工作', icon: 'calendar-outline', toggle: true },
          { id: 'duration', title: '默认任务耗时', icon: 'hourglass-outline', value: '30 分钟' },
          { id: 'reminder', title: '默认日程提醒', icon: 'notifications-outline', value: '提前 10 分钟' },
        ],
      },
    ],
  },
  notifications: {
    title: '通知设置',
    summary: '系统通知关闭后，提醒仍会保留在产品内。',
    groups: [
      {
        title: '提醒类型',
        rows: [
          { id: 'task-notify', title: '任务提醒', icon: 'checkmark-circle-outline', toggle: true },
          { id: 'event-notify', title: '日程提醒', icon: 'calendar-outline', toggle: true },
          { id: 'review-notify', title: '每周回顾', icon: 'bar-chart-outline', toggle: true },
          { id: 'product-notify', title: '处理结果与待确认', icon: 'sparkles-outline', toggle: true },
        ],
      },
    ],
  },
  data: {
    title: '隐私与数据',
    summary: '管理原始输入、自动删除方式和个人数据副本。',
    groups: [
      {
        title: '原始内容',
        rows: [
          { id: 'captures', title: '原始输入', subtitle: '文字、语音、图片与处理状态', icon: 'folder-open-outline', value: '查看' },
          { id: 'audio-delete', title: '确认后删除原始录音', icon: 'mic-outline', toggle: true },
          { id: 'image-delete', title: '确认后删除原始图片', icon: 'images-outline', toggle: true },
          { id: 'deleted', title: '最近删除', subtitle: '内容保留 30 天', icon: 'trash-outline', value: '3 项' },
        ],
      },
      {
        title: '数据副本',
        rows: [
          { id: 'export', title: '导出个人数据', subtitle: '结构化数据、转写与 OCR', icon: 'download-outline', value: '申请' },
        ],
      },
    ],
  },
  account: {
    title: '账号与安全',
    summary: '查看登录信息与当前设备会话。',
    groups: [
      {
        title: '账号',
        rows: [
          { id: 'phone', title: '手机号', icon: 'phone-portrait-outline', value: '138****5270' },
          { id: 'devices', title: '登录设备', subtitle: '当前 1 台设备', icon: 'phone-portrait-outline', value: '查看' },
          { id: 'logout', title: '退出登录', icon: 'log-out-outline', value: '退出' },
        ],
      },
    ],
  },
};

const initiallyEnabled = new Set([
  'weekend',
  'task-notify',
  'event-notify',
  'review-notify',
  'product-notify',
]);

export default function SettingsDetailScreen() {
  const params = useLocalSearchParams<{ section?: string }>();
  const section = typeof params.section === 'string' ? params.section : 'habits';
  const config = sectionConfigs[section] ?? sectionConfigs.habits;
  const [enabled, setEnabled] = useState(initiallyEnabled);

  const toggle = (id: string) => {
    setEnabled((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <AppScreen includeBottomInset>
      <NavHeader title={config.title} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.summary}>{config.summary}</Text>
        {config.groups.map((group) => (
          <View key={group.title} style={styles.group}>
            <Text accessibilityRole="header" style={styles.groupTitle}>{group.title}</Text>
            <FlatListGroup>
              {group.rows.map((row, index) => (
                <FlatListRow
                  icon={row.icon}
                  key={row.id}
                  showChevron={false}
                  showDivider={index < group.rows.length - 1}
                  subtitle={row.subtitle}
                  title={row.title}
                  trailing={row.toggle ? (
                    <Switch
                      accessibilityLabel={`${row.title}开关`}
                      onValueChange={() => toggle(row.id)}
                      thumbColor={colors.background}
                      trackColor={{ false: colors.borderStrong, true: colors.primary }}
                      value={enabled.has(row.id)}
                    />
                  ) : row.value ? (
                    <Text style={styles.value}>{row.value}</Text>
                  ) : null}
                />
              ))}
            </FlatListGroup>
          </View>
        ))}
      </ScrollView>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 28,
  },
  summary: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  group: {
    marginTop: 24,
  },
  groupTitle: {
    marginBottom: 10,
    color: colors.text,
    fontFamily,
    ...typography.section,
  },
  value: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
});
