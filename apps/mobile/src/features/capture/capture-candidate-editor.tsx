import {
  useGetTracker,
  useListTaskLists,
  useListTrackers,
  type CaptureCandidate,
  type CaptureDraftPayload,
  type TrackerField,
} from '@steward/api-client';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors, fontFamily, radius, typography } from '@/theme/tokens';
import { TrackerSchedulePicker } from '@/features/trackers/tracker-schedule-picker';
import { updateCandidateField, updateRecordCandidateValue } from './capture-confirmation-model';

export function CaptureCandidateEditor({
  candidate,
  pendingTrackers = {},
  onChange,
  payload,
}: {
  candidate: CaptureCandidate;
  pendingTrackers?: Record<string, NonNullable<CaptureDraftPayload['tracker']>>;
  onChange: (payload: CaptureDraftPayload) => void;
  payload: CaptureDraftPayload;
}) {
  const taskLists = useListTaskLists({ list_kind: 'tasks' }, {
    query: { enabled: candidate.candidate_type === 'task' },
  });
  const setField = (field: string, value: unknown) => {
    onChange(updateCandidateField(payload, candidate.candidate_type, field, value));
  };

  if (candidate.candidate_type === 'task' && payload.task) {
    const availableLists = (taskLists.data?.data ?? []).filter((list) => !list.archived_at);
    const listMatched = availableLists.some((list) => list.id === payload.task?.list_id);
    return (
      <View style={styles.editor}>
        <EditorField label="标题" onChangeText={(value) => setField('title', value)} value={payload.task.title} />
        <EditorField
          label="说明"
          multiline
          onChangeText={(value) => setField('description', value)}
          value={payload.task.description ?? ''}
        />
        <EditorField
          label="截止日期"
          onChangeText={(value) => setField('due_date', value)}
          placeholder="YYYY-MM-DD（可选）"
          value={payload.task.due_date ?? ''}
        />
        {(payload.task.due_at || candidate.missing_fields?.includes('due_at')) ? (
          <EditorField
            label="精确截止时间"
            onChangeText={(value) => setField('due_at', value)}
            placeholder="ISO 时间，例如 2026-09-02T15:00:00+08:00"
            value={payload.task.due_at ?? ''}
          />
        ) : null}
        {availableLists.length > 0 ? (
          <>
            <ChoiceField
              label="所属清单"
              onSelect={(value) => setField('list_id', value)}
              options={availableLists.map((list) => ({ label: list.name, value: list.id }))}
              value={payload.task.list_id ?? ''}
            />
            {payload.task.list_id && !listMatched ? (
              <Text style={styles.blockedCopy}>AI 没有匹配到有效清单，请重新选择。</Text>
            ) : null}
          </>
        ) : null}
      </View>
    );
  }

  if (candidate.candidate_type === 'event' && payload.event) {
    const itinerary = payload.event.itinerary_details;
    return (
      <View style={styles.editor}>
        <EditorField label="标题" onChangeText={(value) => setField('title', value)} value={payload.event.title} />
        <View>
          <Text style={styles.label}>时间类型</Text>
          <View accessibilityRole="radiogroup" style={styles.choiceRow}>
            {[true, false].map((allDay) => {
              const selected = payload.event?.all_day === allDay;
              return (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  key={String(allDay)}
                  onPress={() => setField('all_day', allDay)}
                  style={({ pressed }) => [
                    styles.choice,
                    selected && styles.choiceSelected,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>
                    {allDay ? '全天' : '具体时间'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
        {payload.event.all_day ? (
          <>
            <EditorField
              label="开始日期"
              onChangeText={(value) => setField('start_date', value)}
              placeholder="YYYY-MM-DD"
              value={payload.event.start_date ?? ''}
            />
            <EditorField
              label="结束日期"
              onChangeText={(value) => setField('end_date', value)}
              placeholder="YYYY-MM-DD（可选）"
              value={payload.event.end_date ?? ''}
            />
          </>
        ) : (
          <>
            <EditorField
              label="开始时间"
              onChangeText={(value) => setField('start_at', value)}
              placeholder="ISO 时间"
              value={payload.event.start_at ?? ''}
            />
            <EditorField
              label="结束时间"
              onChangeText={(value) => setField('end_at', value)}
              placeholder="ISO 时间（可选）"
              value={payload.event.end_at ?? ''}
            />
          </>
        )}
        <EditorField
          label="地点"
          onChangeText={(value) => setField('location', value)}
          value={payload.event.location ?? ''}
        />
        {itinerary ? (
          <>
            <ChoiceField
              label="安排类型"
              onSelect={(value) => setField('itinerary_details.kind', value)}
              options={[
                { label: '交通', value: 'transport' },
                { label: '住宿', value: 'lodging' },
                { label: '活动', value: 'activity' },
              ]}
              value={itinerary.kind}
            />
            <ChoiceField
              label="预订状态"
              onSelect={(value) => setField('itinerary_details.booking_status', value)}
              options={[
                { label: '计划中', value: 'planned' },
                { label: '已确认', value: 'confirmed' },
                { label: '已出票', value: 'ticketed' },
              ]}
              value={itinerary.booking_status}
            />
            {itinerary.kind === 'transport' ? (
              <>
                <ChoiceField
                  label="交通方式"
                  onSelect={(value) => setField('itinerary_details.transport_mode', value)}
                  options={[
                    { label: '飞机', value: 'flight' },
                    { label: '火车', value: 'train' },
                    { label: '大巴', value: 'coach' },
                    { label: '轮船', value: 'ship' },
                    { label: '自驾', value: 'self_drive' },
                    { label: '其他', value: 'other' },
                  ]}
                  value={itinerary.transport_mode ?? ''}
                />
                <EditorField
                  label="出发地"
                  onChangeText={(value) => setField('itinerary_details.origin', value)}
                  value={itinerary.origin ?? ''}
                />
                <EditorField
                  label="到达地"
                  onChangeText={(value) => setField('itinerary_details.destination', value)}
                  value={itinerary.destination ?? ''}
                />
                <EditorField
                  label="航班号或车次"
                  onChangeText={(value) => setField('itinerary_details.service_number', value)}
                  value={itinerary.service_number ?? ''}
                />
                <EditorField
                  label="座位或舱位"
                  onChangeText={(value) => setField('itinerary_details.seat', value)}
                  value={itinerary.seat ?? ''}
                />
              </>
            ) : null}
          </>
        ) : null}
        <EditorField
          label="备注"
          multiline
          onChangeText={(value) => setField('note', value)}
          value={payload.event.note ?? ''}
        />
      </View>
    );
  }

  if (candidate.candidate_type === 'project' && payload.project) {
    const trip = payload.project.project_kind === 'trip';
    return (
      <View style={styles.editor}>
        <EditorField label={trip ? '行程名称' : '项目名称'} onChangeText={(value) => setField('title', value)} value={payload.project.title} />
        {trip ? (
          <>
            <EditorField label="目的地" onChangeText={(value) => setField('destination', value)} value={payload.project.destination ?? ''} />
            <EditorField label="开始日期" onChangeText={(value) => setField('start_date', value)} placeholder="YYYY-MM-DD" value={payload.project.start_date ?? ''} />
            <EditorField label="结束日期" onChangeText={(value) => setField('target_date', value)} placeholder="YYYY-MM-DD" value={payload.project.target_date ?? ''} />
          </>
        ) : null}
        <EditorField label="说明" multiline onChangeText={(value) => setField('description', value)} value={payload.project.description ?? ''} />
      </View>
    );
  }

  if (candidate.candidate_type === 'note' && payload.note) {
    return (
      <View style={styles.editor}>
        <EditorField label="标题" onChangeText={(value) => setField('title', value)} value={payload.note.title ?? ''} />
        <EditorField label="正文" multiline onChangeText={(value) => setField('content', value)} value={payload.note.content} />
      </View>
    );
  }

  if (candidate.candidate_type === 'tracker' && payload.tracker) {
    return (
      <View style={styles.editor}>
        <Text style={styles.label}>打卡频率</Text>
        <TrackerSchedulePicker value={payload.tracker.schedule ?? null} onChange={(value) => setField('schedule', value ?? undefined)} />
        <EditorField label="打卡名称" onChangeText={(value) => setField('name', value)} value={payload.tracker.name} />
        <EditorField label="说明" multiline onChangeText={(value) => setField('description', value)} value={payload.tracker.description ?? ''} />
        {(payload.tracker.fields?.length ?? 0) === 0 ? (
          <Text style={styles.blockedCopy}>字段结构还没有生成，需返回补充说明后重新整理。</Text>
        ) : (
          <Text style={styles.helper}>将创建 {payload.tracker.fields.length} 个记录字段。</Text>
        )}
      </View>
    );
  }

  if (candidate.candidate_type === 'record' && payload.record) {
    return <RecordCandidateEditor onChange={onChange} payload={payload} pendingTrackers={pendingTrackers} />;
  }

  return <Text style={styles.blockedCopy}>这项候选的结构不完整，请返回重新整理。</Text>;
}

function ChoiceField({
  label,
  onSelect,
  options,
  value,
}: {
  label: string;
  onSelect: (value: string) => void;
  options: { label: string; value: string }[];
  value: string;
}) {
  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <View accessibilityRole="radiogroup" style={styles.choiceRowWrap}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              key={option.value}
              onPress={() => onSelect(option.value)}
              style={({ pressed }) => [
                styles.choice,
                selected && styles.choiceSelected,
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function RecordCandidateEditor({
  pendingTrackers,
  onChange,
  payload,
}: {
  onChange: (payload: CaptureDraftPayload) => void;
  payload: CaptureDraftPayload;
  pendingTrackers: Record<string, NonNullable<CaptureDraftPayload['tracker']>>;
}) {
  const record = payload.record;
  const trackerId = record?.tracker_ref ?? '';
  const pendingTracker = pendingTrackers[trackerId];
  const trackers = useListTrackers({ status: 'active' }, { query: { enabled: !trackerId } });
  const tracker = useGetTracker(trackerId, { query: { enabled: Boolean(trackerId) && !pendingTracker } });
  if (!record) return null;

  const setField = (field: string, value: unknown) => {
    onChange(updateCandidateField(payload, 'record', field, value));
  };
  const trackerFields = pendingTracker?.fields ?? tracker.data?.data.fields ?? [];
  const displayFields = trackerFields.length > 0
    ? trackerFields
    : record.values.map<TrackerField>((item) => ({
        key: item.key,
        label: recordFieldLabel(item.key),
        required: true,
        type: item.number_value !== undefined && item.number_value !== null ? 'number' : 'text',
      }));

  return (
    <View style={styles.editor}>
      {!trackerId ? (
        <View>
          <Text style={styles.label}>记录到</Text>
          {trackers.isPending ? (
            <Text style={styles.helper}>正在读取可用记录项…</Text>
          ) : trackers.isError ? (
            <Pressable accessibilityRole="button" onPress={() => void trackers.refetch()}>
              <Text style={styles.blockedCopy}>记录项加载失败，点此重试。</Text>
            </Pressable>
          ) : (
            <View accessibilityRole="radiogroup" style={styles.trackerChoices}>
              {(trackers.data?.data ?? []).map((item) => (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ checked: false }}
                  key={item.id}
                  onPress={() => {
                    const next = updateCandidateField(payload, 'record', 'tracker_ref', item.id);
                    if (next.record) {
                      next.record.values = item.fields
                        .filter((field) => field.required)
                        .map((field) => ({ key: field.key }));
                    }
                    onChange(next);
                  }}
                  style={({ pressed }) => [styles.trackerChoice, pressed && styles.pressed]}
                >
                  <Text style={styles.trackerChoiceText}>{item.name}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      ) : (
        <View style={styles.trackerSummary}>
          <Text style={styles.trackerSummaryLabel}>记录到</Text>
          <Text style={styles.trackerSummaryValue}>{pendingTracker?.name ?? tracker.data?.data.name ?? '正在读取记录项…'}</Text>
        </View>
      )}
      <EditorField
        label="发生时间"
        onChangeText={(value) => setField('timestamp', value)}
        placeholder="ISO 时间"
        value={record.timestamp}
      />
      {!pendingTracker && tracker.isError ? (
        <Pressable accessibilityRole="button" onPress={() => void tracker.refetch()}>
          <Text style={styles.blockedCopy}>字段结构加载失败，点此重试。</Text>
        </Pressable>
      ) : null}
      {displayFields.map((field) => {
        const item = record.values.find((value) => value.key === field.key);
        const numeric = field.type !== 'text';
        if (tracker.data?.data.builtin_key === 'ledger' && field.key === 'direction') {
          return (
            <ChoiceField
              key={field.key}
              label="收支类型"
              onSelect={(value) => onChange(updateRecordCandidateValue(
                payload,
                field.key,
                value,
                'text',
              ))}
              options={[
                { label: '支出', value: 'expense' },
                { label: '收入', value: 'income' },
              ]}
              value={item?.text_value ?? ''}
            />
          );
        }
        if (tracker.data?.data.builtin_key === 'ledger' && field.key === 'category') {
          return (
            <ChoiceField
              key={field.key}
              label="分类"
              onSelect={(value) => onChange(updateRecordCandidateValue(
                payload,
                field.key,
                value,
                'text',
              ))}
              options={['餐饮', '交通', '购物', '居住', '工资', '奖金', '退款', '其他']
                .map((label) => ({ label, value: label }))}
              value={item?.text_value ?? ''}
            />
          );
        }
        return (
          <EditorField
            keyboardType={numeric ? 'decimal-pad' : 'default'}
            key={field.key}
            label={`${field.label}${field.unit ? `（${field.unit}）` : ''}${field.required ? '' : '（选填）'}`}
            onChangeText={(value) => onChange(updateRecordCandidateValue(
              payload,
              field.key,
              value,
              numeric ? 'number' : 'text',
            ))}
            value={item?.number_value !== undefined && item.number_value !== null
              ? String(item.number_value)
              : item?.text_value ?? ''}
          />
        );
      })}
      <EditorField
        label="补充说明"
        multiline
        onChangeText={(value) => setField('note', value)}
        value={record.note ?? ''}
      />
    </View>
  );
}

function EditorField({
  keyboardType = 'default',
  label,
  multiline = false,
  onChangeText,
  placeholder,
  value,
}: {
  keyboardType?: 'default' | 'decimal-pad';
  label: string;
  multiline?: boolean;
  onChangeText: (value: string) => void;
  placeholder?: string;
  value: string;
}) {
  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        keyboardType={keyboardType}
        multiline={multiline}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textTertiary}
        style={[styles.input, multiline && styles.inputMultiline]}
        value={value}
      />
    </View>
  );
}

function recordFieldLabel(key: string): string {
  const labels: Record<string, string> = {
    amount: '金额',
    category: '分类',
    direction: '收支类型',
    merchant: '商家或备注',
    payment_method: '支付方式',
  };
  return labels[key] ?? key;
}

const styles = StyleSheet.create({
  editor: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    gap: 12,
  },
  label: {
    marginBottom: 6,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
    fontWeight: '600',
  },
  input: {
    minHeight: 46,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    color: colors.text,
    fontFamily,
    ...typography.body,
    backgroundColor: colors.background,
  },
  inputMultiline: {
    minHeight: 88,
    textAlignVertical: 'top',
  },
  choiceRow: {
    flexDirection: 'row',
    gap: 8,
  },
  choiceRowWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  choice: {
    minHeight: 42,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  choiceSelected: {
    backgroundColor: colors.primarySoft,
  },
  choiceText: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
    fontWeight: '600',
  },
  choiceTextSelected: {
    color: colors.primaryStrong,
  },
  trackerChoices: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  trackerChoice: {
    minHeight: 42,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
  },
  trackerChoiceText: {
    color: colors.primaryStrong,
    fontFamily,
    ...typography.meta,
    fontWeight: '600',
  },
  trackerSummary: {
    minHeight: 44,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSubtle,
  },
  trackerSummaryLabel: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  trackerSummaryValue: {
    color: colors.text,
    fontFamily,
    ...typography.meta,
    fontWeight: '600',
  },
  helper: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  blockedCopy: {
    color: colors.warning,
    fontFamily,
    ...typography.meta,
  },
  pressed: {
    opacity: 0.7,
  },
});
