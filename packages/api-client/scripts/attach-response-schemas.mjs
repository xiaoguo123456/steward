import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const generatedRoot = new URL('../src/generated/', import.meta.url);
const entries = await readdir(generatedRoot, { withFileTypes: true });

for (const entry of entries) {
  if (!entry.isDirectory() || entry.name === 'model') continue;

  const sourcePath = join(generatedRoot.pathname, entry.name, `${entry.name}.ts`);
  const schemaPath = join(generatedRoot.pathname, entry.name, `${entry.name}.zod.ts`);
  let source;
  let schemas;
  try {
    [source, schemas] = await Promise.all([
      readFile(sourcePath, 'utf8'),
      readFile(schemaPath, 'utf8'),
    ]);
  } catch {
    continue;
  }

  // 脚本既会被完整 generate 调用，也可能被开发者单独执行。
  // 已经接过响应 Schema 时只规范文件尾，避免重复插入 import 和校验器参数。
  if (source.includes(`import * as StewardResponseSchemas from './${entry.name}.zod';`)) {
    await writeFile(schemaPath, `${schemas.trimEnd()}\n`);
    continue;
  }

  const lines = source.split('\n');
  const output = [];
  let operation = null;
  let validating = false;
  let imported = false;
  let expectedValidators = 0;
  let attachedValidators = 0;

  for (const line of lines) {
    const declaration = line.match(/^export const ([A-Za-z0-9_]+) = async\b/);
    if (declaration) {
      operation = declaration[1];
      validating = false;
    }

    if (!imported && line.startsWith('import ')) {
      output.push(`import * as StewardResponseSchemas from './${entry.name}.zod';`);
      imported = true;
    }

    if (operation && line.includes('return stewardFetch<')) {
      const schemaName = `${operation[0].toUpperCase()}${operation.slice(1)}Response`;
      validating = operation !== 'streamTurn'
        && schemas.includes(`export const ${schemaName} =`);
      if (validating) expectedValidators += 1;
    }

    if (operation && line === ');}') {
      if (validating) {
        const schemaName = `${operation[0].toUpperCase()}${operation.slice(1)}Response`;
        output.push(`, StewardResponseSchemas.${schemaName}`);
        attachedValidators += 1;
      }
      output.push(line);
      operation = null;
      validating = false;
      continue;
    }

    output.push(line);
  }

  if (attachedValidators !== expectedValidators) {
    throw new Error(
      `${entry.name} 响应校验器接线不完整：应接 ${expectedValidators} 个，实际 ${attachedValidators} 个。`,
    );
  }

  await writeFile(sourcePath, output.join('\n'));
  // Orval 在只有一个 operation 的分组中可能输出额外的文件尾空行。
  // 统一收敛为一个换行，避免新分组首次生成时触发 Git 空白门禁。
  await writeFile(schemaPath, `${schemas.trimEnd()}\n`);
}
