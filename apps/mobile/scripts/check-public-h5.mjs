import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultPublicRoot = path.resolve(scriptDirectory, '../public');
const functionalDeletionRoute = path.resolve(scriptDirectory, '../src/app/account-deletion.tsx');

export const requiredPublicPages = [
  'legal/index.html',
  'legal/privacy/index.html',
  'legal/terms/index.html',
  'legal/personal-information/index.html',
  'legal/third-parties/index.html',
  'legal/account-deletion/index.html',
  'support/index.html',
];

const releaseBlockerPatterns = [
  /data-release-blocker/i,
  /待确认/,
  /禁止生产发布/,
  /测试内容/,
  /<meta\s+name=["']robots["'][^>]*noindex/i,
];

export function validateHtmlSource(relativePath, source, { production = false } = {}) {
  const errors = [];
  const blockers = [];

  const requiredPatterns = [
    [/^<!doctype html>/i, '缺少 HTML5 doctype'],
    [/<html\s+[^>]*lang=["']zh-CN["']/i, '缺少 lang="zh-CN"'],
    [/<meta\s+name=["']viewport["']/i, '缺少移动端 viewport'],
    [/<title>[^<]+<\/title>/i, '缺少页面标题'],
    [/<h1[\s>]/i, '缺少一级标题'],
  ];
  for (const [pattern, message] of requiredPatterns) {
    if (!pattern.test(source)) errors.push(`${relativePath}：${message}`);
  }

  if (/<script[\s>]/i.test(source)) {
    errors.push(`${relativePath}：公开纯内容页不得依赖 JavaScript`);
  }
  if (/SecureStore|localStorage|sessionStorage|\/v1\//i.test(source)) {
    errors.push(`${relativePath}：公开纯内容页不得读取会话或调用用户 API`);
  }
  if (relativePath === 'legal/account-deletion/index.html' && /<form[\s>]/i.test(source)) {
    errors.push(`${relativePath}：公开说明页不得放置申请表单，删除操作只能进入生成 Client 的功能路由`);
  }
  if (source.length < 900) {
    errors.push(`${relativePath}：正文过短，疑似空白或占位壳页`);
  }

  if (production) {
    for (const pattern of releaseBlockerPatterns) {
      if (pattern.test(source)) {
        blockers.push(`${relativePath}：仍含生产阻塞标记 ${pattern}`);
      }
    }
  }

  return { errors, blockers };
}

export async function validatePublicH5({
  publicRoot = defaultPublicRoot,
  production = false,
} = {}) {
  const errors = [];
  const blockers = [];

  try {
    await access(path.join(publicRoot, 'legal/assets/legal.css'));
  } catch {
    errors.push('legal/assets/legal.css：缺少公开页面样式文件');
  }

  for (const relativePath of requiredPublicPages) {
    const absolutePath = path.join(publicRoot, relativePath);
    let source;
    try {
      source = await readFile(absolutePath, 'utf8');
    } catch {
      errors.push(`${relativePath}：缺少固定公开页面`);
      continue;
    }
    const result = validateHtmlSource(relativePath, source, { production });
    errors.push(...result.errors);
    blockers.push(...result.blockers);
  }

  try {
	const route = await readFile(functionalDeletionRoute, 'utf8');
	for (const symbol of [
	  'requestAccountDeletionCode',
	  'reauthenticateAccountDeletion',
	  'requestAccountDeletion',
	  'getAccountDeletionStatus',
	]) {
	  if (!route.includes(symbol)) errors.push(`account-deletion.tsx：缺少正式生成 Client 调用 ${symbol}`);
	}
	if (/fetch\s*\(\s*["'`]\/v1\//.test(route)) {
	  errors.push('account-deletion.tsx：功能型 H5 不得手写 /v1 URL');
	}
  } catch {
	errors.push('account-deletion.tsx：缺少功能型账号删除 H5 路由');
  }

  return { errors, blockers };
}

async function main() {
  const modeArgument = process.argv.find((argument) => argument.startsWith('--mode='));
  const mode = modeArgument?.slice('--mode='.length) || 'staging';
  if (mode !== 'staging' && mode !== 'production') {
    throw new Error(`H5 校验模式只允许 staging 或 production，当前为 ${mode}`);
  }

  const result = await validatePublicH5({ production: mode === 'production' });
  const failures = [...result.errors, ...result.blockers];
  if (failures.length > 0) {
    console.error(`公开 H5 ${mode} 校验失败：`);
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log(`公开 H5 ${mode} 校验通过：${requiredPublicPages.length} 个固定页面与账号删除功能路由可读取。`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
