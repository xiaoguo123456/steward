import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getPlanTransientViewResetVersion,
  requestPlanTransientViewReset,
  resolvePlanTransientView,
  subscribePlanTransientViewReset,
} from './plan-tab-navigation.ts';

test('离开计划一级页时发布一次临时视图重置信号', () => {
  const initialVersion = getPlanTransientViewResetVersion();
  let notificationCount = 0;
  const unsubscribe = subscribePlanTransientViewReset(() => {
    notificationCount += 1;
  });

  requestPlanTransientViewReset();

  assert.equal(getPlanTransientViewResetVersion(), initialVersion + 1);
  assert.equal(notificationCount, 1);

  unsubscribe();
  requestPlanTransientViewReset();
  assert.equal(notificationCount, 1);
});

test('只让旧版本的计划临时视图失效', () => {
  const view = { type: 'scope', key: 'unscheduled' };

  assert.equal(resolvePlanTransientView(view, 3, 3), view);
  assert.equal(resolvePlanTransientView(view, 3, 4), null);
});
