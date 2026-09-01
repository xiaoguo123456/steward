// 向指定测试账号写入一组可重复执行的正式心情日历验收数据。
//
// 脚本只调用生成的 API Client，并把合成日记排除出 AI 回望与往日回忆。
// 它不会直连数据库，也不会打印手机号、Token 或私人正文。
import {
  configureApiClient,
  createMoodJournalEntry,
  getMoodJournalCalendar,
  listMoodJournalEntries,
  login,
  newIdempotencyKey,
  requestPhoneCode,
} from '../packages/api-client/src/index.ts';

const timezone = 'Asia/Shanghai';
const baseUrl = (process.env.STEWARD_MOOD_SEED_API_URL
  ?? 'https://test-steward.qhzhiyin.com').replace(/\/+$/, '');
const phone = (process.env.STEWARD_MOOD_SEED_PHONE ?? '').trim();
const code = (process.env.STEWARD_DEV_SMS_CODE ?? '').trim();

assertTestTarget(baseUrl);
if (!/^1[3-9][0-9]{9}$/.test(phone)) {
  throw new Error('必须通过 STEWARD_MOOD_SEED_PHONE 指定已有测试账号');
}
if (!/^[0-9]{6}$/.test(code)) {
  throw new Error('必须通过 STEWARD_DEV_SMS_CODE 指定测试环境固定验证码');
}

let accessToken = null;
configureApiClient({
  baseUrl,
  getAccessToken: async () => accessToken,
  refreshTokens: async () => false,
});

await requestPhoneCode({ phone, purpose: 'login' });
const session = await login({ phone, code, timezone });
accessToken = session.data.tokens.access_token;

const specs = buildSpecs(new Date());
const from = specs.map((spec) => spec.date).sort()[0];
const to = specs.map((spec) => spec.date).sort().at(-1);
const existing = await listMoodJournalEntries({
  from,
  to,
  q: '日历验收数据',
  limit: 100,
});
const existingKeys = new Set(existing.data.map(entryKey));
let created = 0;
let skipped = 0;

for (const [index, spec] of specs.entries()) {
  const key = `${spec.title}|${spec.date}`;
  if (existingKeys.has(key)) {
    skipped += 1;
    continue;
  }

  await createMoodJournalEntry({
    title: spec.title,
    content: {
      format: 'blocks_v1',
      version: 1,
      blocks: [{
        id: `blk_seed_${spec.date.replaceAll('-', '')}_${index}`,
        type: 'paragraph',
        runs: [{ text: spec.content }],
      }],
    },
    occurred_at: `${spec.date}T${spec.time}:00+08:00`,
    mood_level: spec.mood,
    energy_level: spec.energy,
    emotion_words: spec.emotions,
    context_words: spec.contexts,
    exclude_from_ai: true,
    include_in_memories: false,
  }, { headers: { 'Idempotency-Key': newIdempotencyKey() } });
  created += 1;
}

const verified = await listMoodJournalEntries({
  from,
  to,
  q: '日历验收数据',
  limit: 100,
});
const verifiedKeys = new Set(verified.data.map(entryKey));
for (const spec of specs) {
  if (!verifiedKeys.has(`${spec.title}|${spec.date}`)) {
    throw new Error(`日期 ${spec.date} 的验收日记未能从正式列表接口读回`);
  }
}

const calendar = await getMoodJournalCalendar({ from, to });
const actualCounts = new Map(calendar.data.map((day) => [day.date, day.count]));
const expectedCounts = specs.reduce((counts, spec) => {
  counts.set(spec.date, (counts.get(spec.date) ?? 0) + 1);
  return counts;
}, new Map());
for (const [date, count] of expectedCounts) {
  if ((actualCounts.get(date) ?? 0) < count) {
    throw new Error(`日期 ${date} 的正式月历篇数少于验收数据`);
  }
}

console.log(
  `心情日历验收数据已写入：新增 ${created} 篇，已存在 ${skipped} 篇；`
  + `正式列表与 ${expectedCounts.size} 个日期的月历篇数校验通过`,
);

function buildSpecs(now) {
  const today = dateInTimezone(now, timezone);
  const templates = [
    [0, '08:10', '晨间散步', '测试日记：早上出门走了一小段，空气很清爽。', 'good', 'medium', ['轻松'], ['散步']],
    [0, '21:40', '晚间收尾', '测试日记：把今天的事情慢慢收好，准备早点休息。', 'neutral', 'low', ['平静'], ['独处']],
    [-1, '18:20', '下班路上', '测试日记：傍晚的风很舒服，回家的脚步也慢了下来。', 'good', 'medium', ['放松'], ['通勤']],
    [-3, '09:30', '周末早餐', '测试日记：认真吃了一顿早餐，给自己留了不赶时间的上午。', 'very_good', 'high', ['满足'], ['居家']],
    [-3, '22:05', '雨声', '测试日记：窗外下了会儿雨，房间里显得格外安静。', 'neutral', 'low', ['安静'], ['天气']],
    [-6, '16:45', '完成一件事', '测试日记：搁置了几天的小事终于做完，心里轻了一点。', 'good', 'medium', ['踏实'], ['工作']],
    [-9, '12:15', '午间片刻', '测试日记：午饭后晒了几分钟太阳，重新有了一点精神。', 'good', 'medium', ['舒展'], ['休息']],
    [-13, '20:30', '和朋友聊天', '测试日记：聊了些近况，也听到了一些新的想法。', 'very_good', 'medium', ['温暖'], ['朋友']],
    [-18, '19:10', '有点疲惫', '测试日记：今天有些忙，先允许自己什么都不安排。', 'low', 'low', ['疲惫'], ['工作']],
    [-24, '07:50', '早起', '测试日记：比平时早醒了一会儿，安静地看完了天亮。', 'neutral', 'medium', ['安定'], ['清晨']],
    [-28, '17:35', '公园长椅', '测试日记：在公园坐了一会儿，只听树叶和远处的声音。', 'good', 'medium', ['松弛'], ['户外']],
  ];

  return templates.map(([offset, time, label, content, mood, energy, emotions, contexts]) => ({
    date: shiftDateKey(today, offset),
    time,
    title: `日历验收数据 · ${label}`,
    content,
    mood,
    energy,
    emotions,
    contexts,
  }));
}

function entryKey(entry) {
  return `${entry.title}|${dateInTimezone(new Date(entry.occurred_at), timezone)}`;
}

function shiftDateKey(dateKey, offset) {
  const anchor = new Date(`${dateKey}T12:00:00+08:00`);
  anchor.setUTCDate(anchor.getUTCDate() + offset);
  return dateInTimezone(anchor, timezone);
}

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
    throw new Error('seed-test-mood-journal 只允许写入 https://test-steward.qhzhiyin.com');
  }
}
