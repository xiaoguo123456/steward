// 向指定测试账号写入一组可重复执行的正式时光验收数据。
//
// 脚本只调用生成的 API Client：验证码登录、媒体授权、对象存储直传、上传确认和
// 时光发布都经过与 App 相同的正式链路。它不会直连数据库，也不会打印手机号、
// Token 或签名 URL。
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  completeMediaUpload,
  configureApiClient,
  createMemoryMoment,
  createUploadGrants,
  getMemoryMoment,
  listMemoryMoments,
  login,
  newIdempotencyKey,
  requestPhoneCode,
} from '../packages/api-client/src/index.ts';

const baseUrl = (process.env.STEWARD_MEMORY_SEED_API_URL
  ?? 'https://test-steward.qhzhiyin.com').replace(/\/+$/, '');
const phone = (process.env.STEWARD_MEMORY_SEED_PHONE ?? '').trim();
const code = (process.env.STEWARD_DEV_SMS_CODE ?? '').trim();

assertTestTarget(baseUrl);
if (!/^1[3-9][0-9]{9}$/.test(phone)) {
  throw new Error('必须通过 STEWARD_MEMORY_SEED_PHONE 指定已有测试账号');
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

const specs = [
  {
    description: '海边的风比想象中温柔\n沿着海边慢慢走，回来时天刚好暗下来。',
    photos: [
      ['seaside-bike.jpg', '树荫下靠着海岸栏杆的自行车'],
      ['seaside-reading.jpg', '海边窗前摊开的书'],
      ['seaside-evening.jpg', '暮色里的海岸与行人'],
      ['city-night.jpg', '入夜后的海边步道'],
    ],
  },
  {
    description: '久违地坐在一起\n没有特别安排，只是一起吃饭聊天，就已经很开心。',
    photos: [
      ['friends-dinner.jpg', '朋友围坐在桌边一起吃饭'],
      ['city-sunset.jpg', '晚餐前城市上空的落日'],
    ],
  },
  {
    description: '退潮以后\n沿着潮水留下的痕迹走了很久，脚步也慢了下来。',
    photos: [
      ['beach-footprints.jpg', '退潮沙滩上延伸向远处的脚印'],
    ],
  },
];

await requestPhoneCode({ phone, purpose: 'login' });
const session = await login({ phone, code, timezone: 'Asia/Shanghai' });
accessToken = session.data.tokens.access_token;

const existing = await listMemoryMoments({ limit: 100 });
const existingKeys = new Set(existing.data.map((moment) => memoryKey(moment)));
let created = 0;
let skipped = 0;
const newlyCreatedDescriptions = new Set();

for (const spec of specs) {
  if (existingKeys.has(memoryKey(spec))) {
    skipped += 1;
    continue;
  }

  const files = await Promise.all(spec.photos.map(async ([fileName, description]) => {
    const path = resolve('apps/mobile/assets/memories', fileName);
    return { bytes: await readFile(path), description };
  }));
  const grants = await createUploadGrants({
    items: files.map((file) => ({
      kind: 'image',
      content_type: 'image/jpeg',
      byte_size: file.bytes.byteLength,
    })),
  }, { headers: { 'Idempotency-Key': newIdempotencyKey() } });

  const photos = [];
  for (const [index, grant] of grants.data.entries()) {
    const result = await fetch(grant.upload_url, {
      method: grant.method,
      headers: grant.headers,
      body: files[index].bytes,
    });
    if (!result.ok) {
      throw new Error(`第 ${index + 1} 张测试照片上传失败（HTTP ${result.status}）`);
    }
    await completeMediaUpload(
      grant.media_id,
      { byte_size: files[index].bytes.byteLength },
      { headers: { 'Idempotency-Key': newIdempotencyKey() } },
    );
    photos.push({ media_id: grant.media_id, description: files[index].description });
  }

  await createMemoryMoment({
    description: spec.description,
    photos,
  }, { headers: { 'Idempotency-Key': newIdempotencyKey() } });
  created += 1;
  newlyCreatedDescriptions.add(spec.description);
}

const verified = await listMemoryMoments({ limit: 100 });
let verifiedPhotos = 0;
for (const [specIndex, spec] of specs.entries()) {
  const summary = verified.data.find((moment) => memoryKey(moment) === memoryKey(spec));
  if (!summary) {
    throw new Error(`第 ${specIndex + 1} 段测试时光未能从正式列表接口读回`);
  }

  const response = await getMemoryMoment(summary.id);
  const moment = response.data;
  if (moment.description !== spec.description
      || moment.created_by !== 'user'
      || moment.photos.length !== spec.photos.length) {
    throw new Error(`第 ${specIndex + 1} 段测试时光的正式详情与写入内容不一致`);
  }

  if (newlyCreatedDescriptions.has(spec.description)
      && moment.occurred_on !== dateInTimezone(new Date(), 'Asia/Shanghai')) {
    throw new Error(`第 ${specIndex + 1} 段测试时光没有使用账号当地发布日期`);
  }

  for (const [photoIndex, photo] of moment.photos.entries()) {
    const expected = spec.photos[photoIndex];
    if (photo.position !== photoIndex || photo.description !== expected[1]) {
      throw new Error(`第 ${specIndex + 1} 段时光的第 ${photoIndex + 1} 张照片顺序或说明不一致`);
    }
    const readResult = await fetch(photo.read_url, { headers: { Range: 'bytes=0-0' } });
    if (!readResult.ok) {
      throw new Error(`第 ${specIndex + 1} 段时光的第 ${photoIndex + 1} 张照片无法读取（HTTP ${readResult.status}）`);
    }
    await readResult.body?.cancel();
    verifiedPhotos += 1;
  }
}

console.log(
  `时光验收数据已写入：新增 ${created} 段，已存在 ${skipped} 段；`
  + `正式列表、详情与 ${verifiedPhotos} 张私有照片读取均通过`,
);

function memoryKey(moment) {
  return moment.description;
}

function dateInTimezone(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
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
    throw new Error('seed-test-memories 只允许写入 https://test-steward.qhzhiyin.com');
  }
}
