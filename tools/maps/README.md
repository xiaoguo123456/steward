# 地图资源发布

跑步地图使用 MapLibre Native 直接读取版本化 PMTiles，不部署瓦片服务。测试和生产共用一份只读地图：

```text
OSS: steward/maps/protomaps/<数据日期>/
CDN: https://img.qhzhiyin.com/steward/maps/protomaps/<数据日期>/
```

当前范围为中国，最高 `z15`。地图对象、样式、字体和图标使用不可变缓存；升级数据时新建日期目录，不覆盖旧版。

当前发布：`20260823`，App 使用 `https://img.qhzhiyin.com/steward/maps/protomaps/20260823/style-light-zh-hans.json`。

## 发布

1. 从 Protomaps daily build 按中国边界提取 PMTiles。
2. 下载 `@protomaps/basemaps@5.7.2` 和 `protomaps/basemaps-assets`。
3. 生成中文样式与运行资源：

```bash
node tools/maps/prepare_release.mjs \
  --release 20260823 \
  --output-dir .local/maps/20260823 \
  --assets-dir /path/to/basemaps-assets \
  --assets-revision <commit> \
  --basemaps-module /path/to/@protomaps/basemaps/dist/esm/index.js
```

4. 校验 PMTiles 后断点上传：

```bash
pmtiles verify /path/to/china-z15.pmtiles
python3 tools/maps/publish_oss.py \
  --release 20260823 \
  --release-dir .local/maps/20260823 \
  --pmtiles /path/to/china-z15.pmtiles

python3 tools/maps/verify_oss.py \
  --release 20260823 \
  --pmtiles /path/to/china-z15.pmtiles
```

CDN 必须开启 Range 回源，允许 `GET`、`HEAD`、`OPTIONS`，暴露 `ETag`、`Content-Range`、`Accept-Ranges` 和 `Content-Length`。`steward/maps/` 只放公开底图，用户轨迹不能放入该前缀。

App 地图界面必须显示 `© OpenStreetMap contributors` 署名。
