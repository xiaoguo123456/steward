#!/usr/bin/env bash
# 发布前核验 Expo 更新证书用途，避免产出无法验签的原生安装包。
set -euo pipefail
certificate="${1:?请提供更新签名证书路径}"
if ! openssl x509 -in "$certificate" -noout -ext keyUsage 2>/dev/null | grep -q 'Digital Signature'; then
  echo 'OTA 证书缺少 Key Usage: Digital Signature；必须修正证书并重新构建原生包。' >&2
  exit 1
fi
if ! openssl x509 -in "$certificate" -noout -ext extendedKeyUsage 2>/dev/null | grep -q 'Code Signing'; then
  echo 'OTA 证书缺少 Extended Key Usage: Code Signing；必须修正证书并重新构建原生包。' >&2
  exit 1
fi
openssl x509 -in "$certificate" -noout -checkend 0 >/dev/null
openssl verify -CAfile "$certificate" "$certificate" >/dev/null
echo 'OTA 证书用途、有效期与自签信任检查通过。'
