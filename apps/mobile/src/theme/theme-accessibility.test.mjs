import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const tokenSource = await readFile(new URL('./tokens.ts', import.meta.url), 'utf8');

function colorToken(name) {
  const match = tokenSource.match(new RegExp(`\\b${name}:\\s*'(#[0-9A-Fa-f]{6})'`));
  assert.ok(match, `缺少颜色 Token：${name}`);
  return match[1];
}

function relativeLuminance(hex) {
  const channels = hex
    .slice(1)
    .match(/../g)
    .map((value) => Number.parseInt(value, 16) / 255)
    .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));

  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(foreground, background) {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

test('正文与弱提示文字在常用表面满足 WCAG AA 小字号对比度', () => {
  const surfaces = ['background', 'surface', 'surfaceSubtle'];
  const textColors = ['text', 'textSecondary', 'textTertiary'];

  for (const textColor of textColors) {
    for (const surface of surfaces) {
      const ratio = contrastRatio(colorToken(textColor), colorToken(surface));
      assert.ok(
        ratio >= 4.5,
        `${textColor} 在 ${surface} 上的对比度仅为 ${ratio.toFixed(2)}:1`,
      );
    }
  }
});

test('品牌主色承载白色小字号内容时满足 WCAG AA', () => {
  const ratio = contrastRatio(colorToken('primary'), colorToken('background'));
  assert.ok(ratio >= 4.5, `primary 与白色的对比度仅为 ${ratio.toFixed(2)}:1`);
});
