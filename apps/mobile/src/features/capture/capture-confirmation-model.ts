import type {
  CaptureCandidate,
  CaptureCandidateType,
  CaptureDraftPayload,
  RecordValue,
} from '@steward/api-client';

type DraftObject = Record<string, unknown>;

export function cloneCapturePayload(payload: CaptureDraftPayload): CaptureDraftPayload {
  const next = JSON.parse(JSON.stringify(payload)) as CaptureDraftPayload;
  // 精确截止时刻已经包含日期；模型若同时给出两者，提交前保留更精确的 due_at。
  if (next.task?.due_at && next.task.due_date) {
    next.task.due_date = null;
  }
  return next;
}

export function initialCandidateSelection(candidates: CaptureCandidate[]): Record<string, boolean> {
  return Object.fromEntries(candidates.map((candidate) => [candidate.id, candidate.selected]));
}

export function updateCandidateField(
  payload: CaptureDraftPayload,
  candidateType: CaptureCandidateType,
  field: string,
  value: unknown,
): CaptureDraftPayload {
  const next = cloneCapturePayload(payload);
  const object = draftObject(next, candidateType);
  if (!object) return next;
  writePath(object, field, value === '' ? null : value);
  if (candidateType === 'task' && field === 'due_at' && hasMeaningfulValue(value)) {
    writePath(object, 'due_date', null);
  }
  if (candidateType === 'task' && field === 'due_date' && hasMeaningfulValue(value)) {
    writePath(object, 'due_at', null);
  }
  return next;
}

export function updateRecordCandidateValue(
  payload: CaptureDraftPayload,
  key: string,
  value: string,
  valueType?: 'number' | 'text',
): CaptureDraftPayload {
  const next = cloneCapturePayload(payload);
  if (!next.record) return next;
  let found = false;
  next.record.values = (next.record.values ?? []).map((item) => {
    if (item.key !== key) return item;
    found = true;
    const numeric = valueType === 'number'
      || (valueType === undefined && item.number_value !== undefined && item.number_value !== null);
    if (numeric) {
      const numberValue = value.trim() ? Number(value) : Number.NaN;
      return {
        key,
        ...(Number.isFinite(numberValue) ? { number_value: numberValue } : {}),
      };
    }
    return { key, ...(value.trim() ? { text_value: value } : {}) };
  });
  if (!found) {
    if (valueType === 'number') {
      const numberValue = value.trim() ? Number(value) : Number.NaN;
      next.record.values.push({
        key,
        ...(Number.isFinite(numberValue) ? { number_value: numberValue } : {}),
      });
    } else {
      next.record.values.push({ key, ...(value.trim() ? { text_value: value } : {}) });
    }
  }
  return next;
}

export function applyConflictChoice(
  payload: CaptureDraftPayload,
  candidateType: CaptureCandidateType,
  field: string,
  value: string,
): { changed: boolean; payload: CaptureDraftPayload } {
  if (candidateType === 'record' && payload.record) {
    const recordKey = field === 'amount' ? 'amount' : field;
    const existing = (payload.record.values ?? []).find((item) => item.key === recordKey);
    if (existing) {
      return { changed: true, payload: updateRecordCandidateValue(payload, recordKey, value) };
    }
  }

  const object = draftObject(payload, candidateType);
  if (!object) return { changed: false, payload };
  const candidates = conflictFieldCandidates(candidateType, field);
  const target = candidates.find((candidate) => candidate in object || candidate === field);
  if (!target) return { changed: false, payload };
  return {
    changed: true,
    payload: updateCandidateField(payload, candidateType, target, coerceConflictValue(target, value)),
  };
}

/** 返回仍然缺失或格式无效的字段；确认按钮只依赖这份确定性结果。 */
export function unresolvedCandidateFields(
  candidate: CaptureCandidate,
  payload: CaptureDraftPayload,
): string[] {
  const required = new Set(candidate.missing_fields ?? []);
  for (const field of structuralRequiredFields(candidate.candidate_type, payload)) {
    required.add(field);
  }
  return [...required].filter(
    (field) => !hasCandidateFieldValue(candidate.candidate_type, payload, field),
  );
}

function structuralRequiredFields(
  candidateType: CaptureCandidateType,
  payload: CaptureDraftPayload,
): string[] {
  switch (candidateType) {
    case 'task':
      return ['title'];
    case 'event':
      return ['title', payload.event?.all_day ? 'start_date' : 'start_at'];
    case 'project':
      return payload.project?.project_kind === 'trip'
        ? ['title', 'destination', 'start_date', 'target_date']
        : ['title'];
    case 'note':
      return ['content'];
    case 'tracker':
      return ['name', 'fields'];
    case 'record':
      return [
        'tracker_ref',
        'timestamp',
        'values',
        ...(payload.record?.values ?? [])
          .filter((value) => !hasRecordValue(value))
          .map((value) => value.key),
      ];
  }
}

function hasCandidateFieldValue(
  candidateType: CaptureCandidateType,
  payload: CaptureDraftPayload,
  field: string,
): boolean {
  if (candidateType === 'record' && payload.record) {
    const recordKey = field === 'amount' ? 'amount' : field;
    const recordValue = (payload.record.values ?? []).find((item) => item.key === recordKey);
    if (recordValue) return hasRecordValue(recordValue);
  }

  const object = draftObject(payload, candidateType);
  if (!object) return false;
  const fields = conflictFieldCandidates(candidateType, field);
  return fields.some((candidate) => {
    const value = readPath(object, candidate);
    if (candidate.endsWith('_date')) {
      return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
    }
    if (candidate.endsWith('_at') || candidate === 'timestamp') {
      return typeof value === 'string' && Number.isFinite(Date.parse(value));
    }
    return hasMeaningfulValue(value);
  });
}

function hasRecordValue(value: RecordValue): boolean {
  if (value.number_value !== undefined && value.number_value !== null) {
    return Number.isFinite(value.number_value) && value.number_value > 0;
  }
  return Boolean(value.text_value?.trim());
}

function readPath(object: DraftObject, field: string): unknown {
  let current: unknown = object;
  for (const segment of field.split('.')) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as DraftObject)[segment];
  }
  return current;
}

function writePath(object: DraftObject, field: string, value: unknown): void {
  const segments = field.split('.');
  let current = object;
  for (const segment of segments.slice(0, -1)) {
    const existing = current[segment];
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
      current[segment] = {};
    }
    current = current[segment] as DraftObject;
  }
  current[segments[segments.length - 1] ?? field] = value;
}

function hasMeaningfulValue(value: unknown): boolean {
  if (typeof value === 'string') {
    return Boolean(value.trim());
  }
  if (typeof value === 'number') return Number.isFinite(value) && value > 0;
  if (typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.length > 0;
  return value !== null && value !== undefined;
}

function draftObject(
  payload: CaptureDraftPayload,
  candidateType: CaptureCandidateType,
): DraftObject | null {
  return (payload[candidateType] as DraftObject | undefined) ?? null;
}

function conflictFieldCandidates(candidateType: CaptureCandidateType, field: string): string[] {
  if (field === 'date') {
    if (candidateType === 'task') return ['due_date', 'due_at'];
    if (candidateType === 'event') return ['start_date', 'start_at'];
    if (candidateType === 'project') return ['start_date', 'target_date'];
  }
  if (field === 'time') {
    if (candidateType === 'task') return ['due_at', 'scheduled_start_at'];
    if (candidateType === 'event') return ['start_at', 'end_at'];
  }
  return allowedConflictFields[candidateType].includes(field) ? [field] : [];
}

const allowedConflictFields: Record<CaptureCandidateType, string[]> = {
  task: ['title', 'description', 'due_date', 'due_at', 'scheduled_start_at', 'list_id'],
  event: [
    'title',
    'all_day',
    'start_date',
    'end_date',
    'start_at',
    'end_at',
    'location',
    'note',
    'itinerary_details.kind',
    'itinerary_details.booking_status',
    'itinerary_details.transport_mode',
    'itinerary_details.origin',
    'itinerary_details.destination',
    'itinerary_details.service_number',
    'itinerary_details.seat',
  ],
  project: [
    'title',
    'description',
    'destination',
    'start_date',
    'target_date',
    'status',
  ],
  note: ['title', 'content'],
  tracker: ['name', 'description', 'tracker_kind'],
  record: ['tracker_ref', 'timestamp', 'values', 'note'],
};

function coerceConflictValue(field: string, value: string): string | number | boolean {
  if (field === 'all_day') return value === 'true';
  if (/minutes$/.test(field)) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : value;
  }
  return value;
}
