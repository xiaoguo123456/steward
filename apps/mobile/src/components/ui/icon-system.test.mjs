import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const sourceRoot = join(mobileRoot, 'src');
const iconAdapter = join(sourceRoot, 'components/ui/icon.tsx');

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

test('Feature 只能通过公共适配层使用 Hugeicons', () => {
  const violations = sourceFiles(sourceRoot)
    .filter((path) => path !== iconAdapter)
    .filter((path) => /from ['"](?:@hugeicons\/|@expo\/vector-icons)/.test(readFileSync(path, 'utf8')))
    .map((path) => path.slice(mobileRoot.length + 1));

  assert.deepEqual(violations, []);
});

test('移动端图标层只保留 Hugeicons 直接依赖', () => {
  const packageJson = JSON.parse(readFileSync(join(mobileRoot, 'package.json'), 'utf8'));

  assert.equal(packageJson.dependencies['@expo/vector-icons'], undefined);
  assert.equal(packageJson.dependencies['expo-symbols'], undefined);
  assert.ok(packageJson.dependencies['@hugeicons/core-free-icons']);
  assert.ok(packageJson.dependencies['@hugeicons/react-native']);
  assert.ok(packageJson.dependencies['react-native-svg']);
});

test('Web 图标不把布尔 accessible 属性透传给 SVG DOM', () => {
  const source = readFileSync(iconAdapter, 'utf8');

  assert.match(source, /accessible=\{Platform\.OS === 'web' \? undefined : false\}/);
  assert.doesNotMatch(source, /accessible=\{false\}/);
});
