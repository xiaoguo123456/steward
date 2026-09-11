import { isDeepStrictEqual } from 'node:util';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const RUNTIME_PREFIXES = ['apps/mobile/src/', 'packages/api-client/src/'];
const CONTENT_ASSET_PREFIX = 'apps/mobile/assets/updates/';
const NON_RUNTIME_PREFIXES = [
  '.github/',
  'apps/backend/',
  'docs/',
  'infra/',
  'packages/contracts/',
  'tools/',
];

// 此脚本和测试只在 CI 执行，不进入应用运行时。
const GATE_FILES = ['apps/mobile/scripts/check-ota-safe-changes.mjs', 'apps/mobile/scripts/check-ota-safe-changes.test.mjs'];

/** 仅允许已核实的项目别名纠正；其余配置必须逐字段完全一致。 */
export function isProjectSlugCorrection(before, after) {
  if (before?.expo?.slug !== 'ai-steward' || after?.expo?.slug !== 'steward') return false;
  const corrected = structuredClone(before);
  corrected.expo.slug = 'steward';
  return isDeepStrictEqual(corrected, after);
}

export function classifyOtaChanges(files, readConfig) {
  const included = [];
  const blocked = [];

  for (const file of files) {
    if (GATE_FILES.includes(file)) continue;
    if (file === 'apps/mobile/app.json' && readConfig) {
      if (isProjectSlugCorrection(readConfig('base'), readConfig('update'))) continue;
    }
    if (RUNTIME_PREFIXES.some((prefix) => file.startsWith(prefix))) {
      included.push(file);
      continue;
    }
    if (file.startsWith(CONTENT_ASSET_PREFIX)) {
      included.push(file);
      continue;
    }
    if (
      NON_RUNTIME_PREFIXES.some((prefix) => file.startsWith(prefix)) ||
      file.endsWith('.md')
    ) {
      continue;
    }
    blocked.push(file);
  }

  return { included, blocked };
}

export function changedFiles(baseSha, updateSha) {
  return execFileSync('git', ['diff', '--name-only', `${baseSha}...${updateSha}`], {
    encoding: 'utf8',
  })
    .split('\n')
    .map((file) => file.trim())
    .filter(Boolean);
}

function main() {
  const [baseSha, updateSha] = process.argv.slice(2);
  if (!baseSha || !updateSha) {
    console.error('用法：node check-ota-safe-changes.mjs <原生包提交> <更新提交>');
    process.exit(2);
  }

  const files = changedFiles(baseSha, updateSha);
  const result = classifyOtaChanges(files, (revision) => JSON.parse(execFileSync(
    'git', ['show', `${revision === 'base' ? baseSha : updateSha}:apps/mobile/app.json`],
    { encoding: 'utf8' },
  )));

  if (result.blocked.length > 0) {
    console.error('以下文件可能改变原生运行时或构建配置，禁止通过 OTA 发布：');
    for (const file of result.blocked) console.error(`- ${file}`);
    console.error('请提升 App 版本并重新构建原生安装包。');
    process.exit(1);
  }
  if (result.included.length === 0) {
    console.error('两个提交之间没有需要发布的移动端 JavaScript 或 OTA 资源变化。');
    process.exit(1);
  }

  console.log('OTA 安全检查通过，本次会发布：');
  for (const file of result.included) console.log(`- ${file}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
