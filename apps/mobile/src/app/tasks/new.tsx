import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { AppScreen } from '@/components/ui/app-screen';
import { colors, fontFamily, radius } from '@/theme/tokens';

type EditableRowProps = {
  label: string;
  value: string;
  onPress?: () => void;
};

function EditableRow({ label, value, onPress }: EditableRowProps) {
  return (
    <Pressable disabled={!onPress} onPress={onPress} style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </Pressable>
  );
}

export default function NewTaskScreen() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState('无');
  const [list, setList] = useState('收集箱');
  const [tag, setTag] = useState('无');
  const [note, setNote] = useState('');

  const cycle = (current: string, values: string[], setter: (value: string) => void) => {
    const index = values.indexOf(current);
    setter(values[(index + 1) % values.length]);
  };

  return (
    <AppScreen includeBottomInset>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Pressable hitSlop={10} onPress={() => router.back()} style={styles.headerSide}>
            <Text style={styles.cancel}>取消</Text>
          </Pressable>
          <Text style={styles.headerTitle}>新建任务</Text>
          <Pressable
            hitSlop={10}
            onPress={() => router.replace('/today')}
            style={[styles.headerSide, styles.headerRight]}
          >
            <Text style={styles.save}>保存</Text>
          </Pressable>
        </View>

        <TextInput
          multiline
          onChangeText={setTitle}
          placeholder="准备做点什么？"
          placeholderTextColor="#C7CCC9"
          style={styles.titleInput}
          value={title}
        />

        <View style={styles.card}>
          <EditableRow label="日期时间" value="今天 10:00" />
          <EditableRow
            label="优先级"
            onPress={() => cycle(priority, ['无', '高', '中', '低'], setPriority)}
            value={priority}
          />
          <EditableRow
            label="所属清单"
            onPress={() => cycle(list, ['收集箱', '工作', '购物清单'], setList)}
            value={list}
          />
          <EditableRow
            label="标签"
            onPress={() => cycle(tag, ['无', '工作', '重要', '灵感'], setTag)}
            value={tag}
          />
          <View style={styles.noteRow}>
            <Text style={styles.rowLabel}>备注</Text>
            <TextInput
              multiline
              onChangeText={setNote}
              placeholder="无"
              placeholderTextColor={colors.textSecondary}
              style={styles.noteInput}
              value={note}
            />
          </View>
        </View>
      </ScrollView>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingBottom: 26,
  },
  header: {
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerSide: {
    width: 64,
    height: 44,
    justifyContent: 'center',
  },
  headerRight: {
    alignItems: 'flex-end',
  },
  cancel: {
    color: colors.textSecondary,
    fontFamily,
    fontSize: 15,
  },
  headerTitle: {
    color: colors.text,
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
  },
  save: {
    color: colors.primary,
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
  },
  titleInput: {
    minHeight: 68,
    paddingTop: 6,
    paddingBottom: 14,
    color: colors.text,
    fontFamily,
    fontSize: 23,
    lineHeight: 31,
    fontWeight: '500',
  },
  card: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
  },
  row: {
    minHeight: 51,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowLabel: {
    color: colors.text,
    fontFamily,
    fontSize: 15,
    lineHeight: 22,
  },
  rowValue: {
    color: colors.textSecondary,
    fontFamily,
    fontSize: 14,
    lineHeight: 21,
  },
  noteRow: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingTop: 15,
  },
  noteInput: {
    width: '65%',
    minHeight: 42,
    padding: 0,
    color: colors.textSecondary,
    fontFamily,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'right',
  },
});
