import assert from 'node:assert/strict';
import test from 'node:test';

import { groupImportantDates } from './important-date-list.ts';

test('已过期条目不会进入即将到来或更多重要日', () => {
  const groups = groupImportantDates([
    { id: 'expired', daysUntil: -8 },
    { id: 'next', daysUntil: 0 },
    { id: 'later', daysUntil: 20 },
    { id: 'older-expired', daysUntil: -62 },
  ]);

  assert.equal(groups.nextItem?.id, 'next');
  assert.deepEqual(groups.laterItems.map((item) => item.id), ['later']);
  assert.deepEqual(groups.expiredItems.map((item) => item.id), [
    'expired',
    'older-expired',
  ]);
});

test('只有已过期条目时不伪造即将到来的主卡片', () => {
  const groups = groupImportantDates([
    { id: 'expired', daysUntil: -1 },
  ]);

  assert.equal(groups.nextItem, undefined);
  assert.deepEqual(groups.laterItems, []);
  assert.deepEqual(groups.expiredItems, [{ id: 'expired', daysUntil: -1 }]);
});
