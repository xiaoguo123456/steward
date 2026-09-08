import { readdir, readFile, writeFile } from 'node:fs/promises';

// 统一生成文件结尾，避免 Orval 的额外空行造成 Git 格式检查失败。
const root = new URL('../src/generated/', import.meta.url);
for (const file of await readdir(root, { recursive: true })) {
  if (!file.endsWith('.zod.ts')) continue;
  const url = new URL(file, root);
  const source = await readFile(url, 'utf8');
  await writeFile(url, `${source.trimEnd()}\n`);
}
