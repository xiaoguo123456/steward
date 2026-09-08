import assert from 'node:assert/strict';
import test from 'node:test';
import { trackerPresets, trackerPresetDraft } from './tracker-presets.ts';
import { CreateTrackerBody } from '../../../../../packages/api-client/src/generated/trackers/trackers.zod.ts';

test('四个打卡模板均符合正式创建契约，默认每天但不写入实际记录', () => {
  assert.deepEqual(trackerPresets.map((item) => item.name), ['体重', '饮水', '睡眠', '阅读']);
  for (const preset of trackerPresets) {
    const draft = CreateTrackerBody.parse(trackerPresetDraft(preset.id));
    assert.equal(draft.schedule.frequency, 'daily');
    assert.equal(draft.fields.length, 1);
    assert.equal(draft.fields[0].required, true);
    assert.ok(draft.fields[0].unit);
  }
  assert.equal(trackerPresetDraft('unknown'), undefined);
});

test('编辑一份模板不会污染下一次新建或其他用户', () => {
  const first = trackerPresetDraft('weight');
  first.fields[0].label = '修改后的名字';
  first.schedule.frequency = 'weekly';
  assert.equal(trackerPresetDraft('weight').fields[0].label, '体重');
  assert.equal(trackerPresetDraft('weight').schedule.frequency, 'daily');
});
