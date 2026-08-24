# 菜谱导入

把 `菜谱数据/`（4271 条，含 25897 张图，共 11G）导进 steward。
源素材和归档库都不进版本库，见根 `.gitignore`。

## 三步

```bash
# 1. 归档：源 JSON → SQLite。忠实保存源数据形状，不做领域映射。
python3 tools/recipe-import/archive.py

# 2. 图片：本地 → OSS。可断点续传，中断后重跑只补没传的。
python3 tools/recipe-import/upload_images.py
python3 tools/recipe-import/upload_images.py --verify   # 抽查对象确实在

# 3. 映射：SQLite → PG 的 recipes 表。
python3 tools/recipe-import/to_postgres.py --dry-run
python3 tools/recipe-import/to_postgres.py

# 从其他工作树复用现有归档库时显式传入路径。
python3 tools/recipe-import/to_postgres.py \
  --archive-path /path/to/recipes.sqlite3 \
  --env-file /path/to/.env \
  --dry-run
```

## 为什么中间要有 SQLite

映射规则一定会改（过敏原怎么推、耗时取上限还是中位、哪些分类算正餐），
而源素材有 11G 且不在版本库里。有了归档库，规则改了重跑第 3 步就行，
不用再碰那 11G。SQLite 里 `raw` 列存着整份原始 JSON，将来发现漏了字段
也能从那里补。

它同时是**不丢数据的底本**：29M 的归档 + OSS 上的图片，合起来等于完整备份。
原始的 11G 素材已经删掉，所以这个库现在是结构化数据在 PG 之外的唯一副本。

```bash
# 备份归档库到 OSS。它不进版本库、只在一台机器上，所以要单独备。
python3 tools/recipe-import/upload_images.py --backup-archive
```

备份放在 `steward/backups/`（**非公开前缀**）而不是 `steward/recipes/`——
后者在 CDN 上免鉴权，而归档库含全部菜谱数据，不该谁都能下载。
文件名带日期，不覆盖上一次：覆盖式备份在数据出问题时救不了你。

## 几条要留意的规则

**授权已确认，`license` 记「已授权」。** 内容来自懒饭。
`source_name` / `license` / `content_version` 三个 NOT NULL 字段的用意是
逼出「有没有权利展示」这个问题——将来接入别的来源时，这里要填真实结论。

原始链接只留在 SQLite 归档的 `url` 列里，不进 PG：展示层用不到它。

**过敏原是硬过滤，见 `allergens.py`。** 漏标会让对花生过敏的人看到含花生的菜；
而明显误标（土豆被判成大豆）会让用户直接关掉过滤，反而更危险。
所以每条排除项都是实际数据里踩到的坑：土豆/绿豆不是大豆、蟹味菇不是蟹、
打蛋器不是鸡蛋（它确实出现在食材表里）。改规则前先跑 `python3 allergens.py` 自检。

酱油同时含大豆与小麦，而中餐离不开它，所以小麦命中 67%、大豆 59%。
这是事实——对大豆过敏的人确实吃不了那些菜。

**不抽取膳食纤维。** 源数据只提供脂肪，没有膳食纤维；导入脚本既不推测、
也不写入该字段。数据库保留可空字段，供未来确实带有可信纤维数据的来源使用，
当前客户端不展示这一项，菜单生成也不把缺失值当作筛选依据。

**步骤图跟步骤一起入库。** 归档里的 `steps.image` 与已上传的 `images.oss_key`
按菜谱和文件名关联；只有上传成功且权利已确认的步骤图才写入 `steps.image_url`。

**耗时取区间上限。** 「约10-20分钟」记 20：让人以为 10 分钟能做完、
实际要 20 分钟，比反过来更容易把一顿饭搞砸。

**图片存对象键不存 URL。** 桶是私有的，签名地址会过期；键是稳定的，
URL 由服务端按当前分发方式拼。CDN 放开免鉴权就拼域名，没放开就临时签名，
两种都不用改数据。
