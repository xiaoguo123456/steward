#!/usr/bin/env node

import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) {
      throw new Error("参数必须使用 --名称 值 的形式");
    }
    values.set(key.slice(2), value);
  }
  return values;
}

function requireArg(args, name) {
  const value = args.get(name);
  if (!value) {
    throw new Error(`缺少 --${name}`);
  }
  return value;
}

const args = parseArgs(process.argv.slice(2));
const release = requireArg(args, "release");
const outputDir = path.resolve(requireArg(args, "output-dir"));
const assetsDir = path.resolve(requireArg(args, "assets-dir"));
const modulePath = path.resolve(requireArg(args, "basemaps-module"));
const cdnBase = (args.get("cdn-base") ?? "https://img.qhzhiyin.com").replace(/\/$/, "");
const objectPrefix = `steward/maps/protomaps/${release}`;
const publicBase = `${cdnBase}/${objectPrefix}`;

const basemaps = await import(pathToFileURL(modulePath).href);
const style = {
  version: 8,
  name: `Steward 中国地图 ${release}`,
  metadata: {
    "steward:release": release,
    "steward:data-source": "Protomaps daily build / OpenStreetMap",
    "steward:language": "zh-Hans",
  },
  sources: {
    protomaps: {
      type: "vector",
      attribution:
        '<a href="https://github.com/protomaps/basemaps">Protomaps</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
      url: `pmtiles://${publicBase}/china-z15.pmtiles`,
    },
  },
  sprite: `${publicBase}/assets/sprites/v4/light`,
  glyphs: `${publicBase}/assets/fonts/{fontstack}/{range}.pbf`,
  layers: basemaps.layers("protomaps", basemaps.namedFlavor("light"), { lang: "zh-Hans" }),
};

await mkdir(outputDir, { recursive: true });
await cp(path.join(assetsDir, "fonts"), path.join(outputDir, "assets", "fonts"), {
  recursive: true,
});
await mkdir(path.join(outputDir, "assets", "sprites", "v4"), { recursive: true });
for (const filename of ["light.json", "light.png", "light@2x.json", "light@2x.png"]) {
  await cp(
    path.join(assetsDir, "sprites", "v4", filename),
    path.join(outputDir, "assets", "sprites", "v4", filename),
  );
}

const assetsRevision = args.get("assets-revision") ?? "unknown";
const notice = [
  "Steward 地图静态资源说明",
  "",
  `发布版本：${release}`,
  "地图数据：Protomaps daily build，数据来源 OpenStreetMap（ODbL）",
  "地图样式：@protomaps/basemaps 5.7.2（BSD-3-Clause）",
  `字体与图标：protomaps/basemaps-assets ${assetsRevision}`,
  "字体许可：SIL Open Font License；图标许可见 Protomaps basemaps-assets 仓库。",
  "",
  "地图界面必须显示 © OpenStreetMap contributors 署名。",
  "",
].join("\n");

await writeFile(path.join(outputDir, "style-light-zh-hans.json"), `${JSON.stringify(style, null, 2)}\n`);
await writeFile(path.join(outputDir, "NOTICE.txt"), notice);

const fontLicense = await readFile(path.join(assetsDir, "fonts", "OFL.txt"));
await mkdir(path.join(outputDir, "licenses"), { recursive: true });
await writeFile(path.join(outputDir, "licenses", "fonts-OFL.txt"), fontLicense);

const manifest = {
  release,
  objectPrefix,
  styleUrl: `${publicBase}/style-light-zh-hans.json`,
  pmtilesUrl: `${publicBase}/china-z15.pmtiles`,
  maxZoom: 15,
  basemapsVersion: "5.7.2",
  basemapsAssetsRevision: assetsRevision,
};
await writeFile(path.join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`已生成 ${outputDir}`);
console.log(`样式地址 ${manifest.styleUrl}`);
