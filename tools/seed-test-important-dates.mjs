// 向指定测试账号写入一组当天的重要日验收数据。
//
// 脚本只调用生成的 API Client，不直连数据库，也不打印手机号、验证码或 Token。
// 相同标题的活动重要日会更新到当天，因此可以安全重复执行。
import {
  configureApiClient,
  createEvent,
  getImportantDates,
  listEvents,
  login,
  requestPhoneCode,
  updateEvent,
} from '../packages/api-client/src/index.ts';

const timezone = 'Asia/Shanghai';
const baseUrl = (process.env.STEWARD_IMPORTANT_DATE_SEED_API_URL
  ?? 'https://test-steward.qhzhiyin.com').replace(/\/+$/, '');
const phone = (process.env.STEWARD_IMPORTANT_DATE_SEED_PHONE ?? '').trim();
const verifyHandled = process.env.STEWARD_IMPORTANT_DATE_VERIFY_HANDLED === '1';

assertTestTarget(baseUrl);
if (!/^1[3-9][0-9]{9}$/.test(phone)) {
  throw new Error('必须通过 STEWARD_IMPORTANT_DATE_SEED_PHONE 指定已有测试账号');
}

let accessToken = null;
configureApiClient({
  baseUrl,
  getAccessToken: async () => accessToken,
  refreshTokens: async () => false,
});

const phoneCode = await requestPhoneCode({ phone, purpose: 'login' });
const code = phoneCode.data.dev_code;
if (!code) {
  throw new Error('测试环境未返回开发验证码，拒绝继续写入');
}
const session = await login({ phone, code, timezone });
accessToken = session.data.tokens.access_token;

const today = dateInTimezone(new Date(), timezone);
const reminders = [{ kind: 'absolute_local', local_time: '09:00', days_before: 0 }];
const specs = [
  {
    title: '测试·今天到期',
    important_date_kind: 'expiry',
    recurrence: 'none',
  },
  {
    title: '测试·今天取报告',
    important_date_kind: 'other',
    recurrence: 'none',
  },
  {
    title: '测试·今天生日',
    important_date_kind: 'birthday',
    recurrence: 'yearly',
  },
];

// 验收时如果点过“标记已处理”，再次执行脚本会先恢复这些合成数据，
// 避免测试条目从活动重要日读模型中永久消失。
const todayEvents = await listEvents({
  event_kind: 'important_date',
  from: today,
  to: today,
  limit: 100,
});
const specTitles = new Set(specs.map((spec) => spec.title));
let restored = 0;
for (const event of todayEvents.data) {
  if (!specTitles.has(event.title) || !event.important_date_handled_at) continue;
  await updateEvent(event.id, { important_date_handled: false }, {
    headers: { 'If-Match': String(event.version) },
  });
  restored += 1;
}

const current = await getImportantDates({ limit: 200 });
const byTitle = new Map(current.data.map((entry) => [entry.event.title, entry.event]));
let created = 0;
let updated = 0;
let unchanged = 0;

for (const spec of specs) {
  const existing = byTitle.get(spec.title);
  const request = {
    title: spec.title,
    event_kind: 'important_date',
    important_date_kind: spec.important_date_kind,
    all_day: true,
    start_date: today,
    recurrence: spec.recurrence,
    reminders,
  };

  if (!existing) {
    await createEvent(request);
    created += 1;
    continue;
  }

  if (existing.start_date === today
      && existing.important_date_kind === spec.important_date_kind
      && existing.recurrence === spec.recurrence) {
    unchanged += 1;
    continue;
  }

  await updateEvent(existing.id, request, {
    headers: { 'If-Match': String(existing.version) },
  });
  updated += 1;
}

const verified = await getImportantDates({ limit: 200 });
for (const spec of specs) {
  const entry = verified.data.find((candidate) => candidate.event.title === spec.title);
  if (!entry || entry.days_until !== 0
      || entry.event.important_date_kind !== spec.important_date_kind
      || entry.event.recurrence !== spec.recurrence) {
    throw new Error(`当天重要日验收失败：${spec.title}`);
  }
}

if (verifyHandled) {
  const candidate = verified.data.find((entry) => (
    entry.event.title === '测试·今天取报告'
  ));
  if (!candidate) throw new Error('缺少可验证处理状态的一次性重要日');

  let handledVersion = null;
  try {
    const handled = await updateEvent(
      candidate.event.id,
      { important_date_handled: true },
      { headers: { 'If-Match': String(candidate.event.version) } },
    );
    handledVersion = handled.data.version;
    if (!handled.data.important_date_handled_at) {
      throw new Error('服务端没有持久化重要日已处理状态');
    }

    const afterHandle = await getImportantDates({ limit: 200 });
    if (afterHandle.data.some((entry) => entry.event.id === candidate.event.id)) {
      throw new Error('已处理重要日仍出现在活动重要日读模型');
    }
  } finally {
    if (handledVersion !== null) {
      await updateEvent(
        candidate.event.id,
        { important_date_handled: false },
        { headers: { 'If-Match': String(handledVersion) } },
      );
    }
  }

  const afterRestore = await getImportantDates({ limit: 200 });
  if (!afterRestore.data.some((entry) => entry.event.id === candidate.event.id)) {
    throw new Error('撤销处理后重要日没有恢复到活动读模型');
  }
}

console.log(
  `当天重要日验收数据已写入：新增 ${created} 条，更新 ${updated} 条，`
  + `已是当天 ${unchanged} 条，恢复已处理 ${restored} 条；正式重要日读模型校验通过`
  + (verifyHandled ? '，处理与撤销链路校验通过' : ''),
);

function dateInTimezone(date, targetTimezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: targetTimezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function assertTestTarget(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'test-steward.qhzhiyin.com') {
    throw new Error('seed-test-important-dates 只允许写入 https://test-steward.qhzhiyin.com');
  }
}
