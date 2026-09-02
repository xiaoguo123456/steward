#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "用法：$0 <test|production> <输出 APK 路径>" >&2
  exit 2
fi

variant="$1"
output_apk="$2"

case "$variant" in
  test|production) ;;
  *)
    echo "构建环境只允许 test 或 production" >&2
    exit 2
    ;;
esac

: "${EXPO_PUBLIC_API_URL:?缺少 EXPO_PUBLIC_API_URL}"
: "${STEWARD_ANDROID_VERSION_CODE:?缺少 STEWARD_ANDROID_VERSION_CODE}"
: "${ANDROID_KEYSTORE_PATH:?缺少 ANDROID_KEYSTORE_PATH}"
: "${ANDROID_KEYSTORE_PASSWORD:?缺少 ANDROID_KEYSTORE_PASSWORD}"
: "${ANDROID_KEY_ALIAS:?缺少 ANDROID_KEY_ALIAS}"
: "${ANDROID_KEY_PASSWORD:?缺少 ANDROID_KEY_PASSWORD}"

case "$EXPO_PUBLIC_API_URL" in
  https://*) ;;
  *)
    echo "EXPO_PUBLIC_API_URL 必须使用 HTTPS" >&2
    exit 2
    ;;
esac

if [ ! -f "$ANDROID_KEYSTORE_PATH" ]; then
  echo "签名文件不存在：$ANDROID_KEYSTORE_PATH" >&2
  exit 2
fi

script_dir="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
repo_root="$(CDPATH='' cd -- "$script_dir/.." && pwd)"
mobile_dir="$repo_root/apps/mobile"

h5_release_mode="staging"
if [ "$variant" = "production" ]; then
  h5_release_mode="production"
fi
node "$mobile_dir/scripts/check-public-h5.mjs" --mode="$h5_release_mode"

case "$output_apk" in
  /*) ;;
  *) output_apk="$repo_root/$output_apk" ;;
esac

android_sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [ -z "$android_sdk" ]; then
  echo "缺少 ANDROID_HOME 或 ANDROID_SDK_ROOT" >&2
  exit 2
fi

build_tools_version="${ANDROID_BUILD_TOOLS_VERSION:-36.0.0}"
zipalign="$android_sdk/build-tools/$build_tools_version/zipalign"
apksigner="$android_sdk/build-tools/$build_tools_version/apksigner"
if [ ! -x "$zipalign" ] || [ ! -x "$apksigner" ]; then
  echo "缺少 Android Build Tools $build_tools_version" >&2
  exit 2
fi

export APP_VARIANT="$variant"
export EXPO_NO_GIT_STATUS=1
export NODE_ENV=production

pnpm --filter mobile exec expo prebuild --platform android --clean --no-install

build_gradle="$mobile_dir/android/app/build.gradle"
perl -0pi -e 's/^\s*signingConfig signingConfigs\.debug\s*$//mg' "$build_gradle"

(
  cd "$mobile_dir/android"
  gradle_max_workers="${GRADLE_MAX_WORKERS:-2}"
  gradle_jvm_args="${GRADLE_JVM_ARGS:--Xmx4g -XX:MaxMetaspaceSize=2g -XX:+UseParallelGC -Dfile.encoding=UTF-8}"
  ./gradlew :app:assembleRelease \
    -PreactNativeArchitectures=arm64-v8a,armeabi-v7a \
    --max-workers="$gradle_max_workers" \
    "-Dorg.gradle.jvmargs=$gradle_jvm_args" \
    --no-daemon
)

unsigned_apk="$mobile_dir/android/app/build/outputs/apk/release/app-release-unsigned.apk"
if [ ! -f "$unsigned_apk" ]; then
  echo "未找到未签名 APK：$unsigned_apk" >&2
  exit 1
fi

build_tmp="$(mktemp -d)"
trap 'rm -rf "$build_tmp"' EXIT
aligned_apk="$build_tmp/steward-aligned.apk"

mkdir -p "$(dirname -- "$output_apk")"
"$zipalign" -f -p 4 "$unsigned_apk" "$aligned_apk"
"$apksigner" sign \
  --ks "$ANDROID_KEYSTORE_PATH" \
  --ks-key-alias "$ANDROID_KEY_ALIAS" \
  --ks-pass env:ANDROID_KEYSTORE_PASSWORD \
  --key-pass env:ANDROID_KEY_PASSWORD \
  --out "$output_apk" \
  "$aligned_apk"
"$apksigner" verify --verbose --print-certs "$output_apk"

output_dir="$(dirname -- "$output_apk")"
output_name="$(basename -- "$output_apk")"
if command -v sha256sum >/dev/null 2>&1; then
  (cd "$output_dir" && sha256sum "$output_name" > "$output_name.sha256")
else
  (cd "$output_dir" && shasum -a 256 "$output_name" > "$output_name.sha256")
fi

echo "APK 已生成：$output_apk"
