#!/usr/bin/env bash

set -euo pipefail

if ! command -v magick >/dev/null 2>&1; then
  echo "缺少 ImageMagick，请先安装 magick 后再生成品牌图片。" >&2
  exit 1
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mobile_dir="$(cd "${script_dir}/.." && pwd)"
image_dir="${mobile_dir}/assets/images"
store_dir="${mobile_dir}/assets/store"
icon_composer_dir="${mobile_dir}/assets/expo.icon/Assets"
master_icon="${mobile_dir}/assets/brand/sequence-icon-master.png"
master_foreground="${mobile_dir}/assets/brand/sequence-icon-foreground.png"

mkdir -p "${store_dir}"

for source in "${master_icon}" "${master_foreground}"; do
  if [[ ! -f "${source}" ]]; then
    echo "缺少品牌母版：${source}" >&2
    exit 1
  fi
done

magick "${master_icon}" -resize 1024x1024\! -strip -alpha off \
  -depth 8 -define png:color-type=2 "${image_dir}/icon.png"

magick "${master_foreground}" -trim +repage -resize 620x620 -gravity center -background none \
  -extent 1024x1024 -strip -depth 8 -define png:color-type=6 \
  "${image_dir}/android-icon-foreground.png"

magick -size 1024x1024 radial-gradient:'#FCFCFA-#F3F4F2' -alpha off \
  -depth 8 -define png:color-type=2 \
  "${image_dir}/android-icon-background.png"

magick "${image_dir}/android-icon-foreground.png" \
  -channel A -threshold 8% +channel \
  -channel RGB -fill '#FFFFFF' -colorize 100% +channel \
  -strip -depth 8 -define png:color-type=6 "${image_dir}/android-icon-monochrome.png"

magick "${master_foreground}" -trim +repage -resize 440x440 -gravity center -background none \
  -extent 512x512 -strip \
  -depth 8 -define png:color-type=6 "${image_dir}/splash-icon.png"
magick "${image_dir}/icon.png" -resize 64x64 -alpha off \
  -depth 8 -define png:color-type=2 "${image_dir}/favicon.png"
magick "${image_dir}/icon.png" -resize 512x512 -alpha off \
  -depth 8 -define png:color-type=2 "${store_dir}/google-play-icon.png"
cp "${image_dir}/android-icon-foreground.png" "${icon_composer_dir}/sequence-path.png"

echo "已生成序事 App 图标、Adaptive Icon、单色图标、启动图、favicon 和 Google Play 图标。"
