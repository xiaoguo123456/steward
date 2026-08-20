#!/usr/bin/env python3
"""把菜谱分成「在一餐里扮演什么角色」，并标出不该进周菜单的条目。

周菜单是按食物类别组的（早餐主食+蛋白，午晚主食+荤+素），不是按固定道数，
所以每道菜要先知道自己是哪一类。

**主要判据是来源自带的分类标签，不是关键词猜。** 懒饭的数据里带了
25171 条标签（`主食`、`炒饭`、`鸡肉`、`根茎果实蔬菜`、`甜品`……），
质量比从菜名和食材里猜高得多。第一版用关键词，实测把
「剁椒芦笋炒鸡蛋」当成了刀工教程（「剁」字误伤）、
把「懒人电饭锅蛋糕」判成了荤菜（食材里有蛋）。

营养只在没有标签时兜底，以及用来区分「主食够不够单独成一餐」。

自检：
    python3 tools/recipe-import/classify.py
"""

from __future__ import annotations

import re

# ---- 角色 ----

# 单品成餐：本身就把主食和蛋白都包了，一碗牛肉面就是一顿饭。
# 再给它配一荤一素就成了三道菜的午饭，没人这么吃。
ONE_DISH = "one_dish"
# 纯主食：白粥、馒头这类，要配菜。
STAPLE = "staple"
# 荤菜。
PROTEIN = "protein"
# 素菜。
VEGETABLE = "vegetable"

# ---- 不进周菜单的原因 ----
#
# 这些**只影响周菜单生成，不影响浏览与搜索**。标记而不是删除：
# 判定标准是我们定的，删了就没法回头复核误伤。

# 不是一道菜：刀工与预处理教程。
NOT_A_DISH = "not_a_dish"
# 甜品与饮品：是正经菜谱，但不该拿来配三餐。
DESSERT_OR_DRINK = "dessert_or_drink"
# 营养估算离谱：孜香酸辣拌饺每份 10992 kcal，显然是食材份量抄错了。
IMPLAUSIBLE = "implausible_nutrition"

# ---- 标签集合 ----

STAPLE_TAGS = {
    "主食", "饭", "炒饭", "焖饭", "面", "炒面", "汤面", "拌面", "焖面", "方便面",
    "粥", "包子", "馒头", "饺子", "馄饨", "年糕", "面包", "饼", "披萨", "三明治",
}

PROTEIN_TAGS = {
    "鸡肉", "鸡胸", "鸡腿", "鸡翅", "鸡爪", "猪肉", "五花肉", "里脊", "排骨",
    "猪蹄", "猪肝", "牛肉", "肥牛", "牛腩", "牛排", "羊肉", "羊排", "羊腿",
    "鸭肉", "鸭腿", "鱼", "虾", "螃蟹", "贝类", "海鲜水产", "鸡蛋", "鸭蛋",
    "皮蛋", "蛋类", "肉末", "腊肠", "速冻丸滑",
    # 豆制品是植物蛋白，在中餐里承担的正是荤菜的位置。
    "豆制品", "豆腐", "嫩豆腐", "日本豆腐", "千张",
}

VEGETABLE_TAGS = {
    "素菜", "蔬菜", "叶类蔬菜", "根茎果实蔬菜", "菌菇类", "沙拉",
}

# 甜品饮品。**不含「下午茶」与「小吃」**：那两个标签下咸口的东西也不少
# （煎饼、烤串），一并排掉会误伤 1487 条。
DESSERT_TAGS = {
    "甜品", "免烤甜品", "甜品饮品", "饮品", "蛋糕", "饼干", "冰淇淋", "奶茶",
    "果汁", "水果茶", "派", "巧克力", "酒", "酸奶", "抹茶", "奶油", "奶酪",
}

# 甜品的菜名信号。
#
# 来源标签漏了不少：「果冻布丁」只标了 下午茶、「花生酱香蕉折叠饼」只标了
# 下午茶+平底锅，光看标签它们会掉进素菜，午餐的素菜那一格就成了布丁。
#
# **只写不会有歧义的词**：不能用「酥」（酥肉是荤菜）、
# 也不能用「糖」（糖醋排骨是荤菜）。
DESSERT_TITLE = re.compile(
    r"(布丁|慕斯|蛋挞|司康|曲奇|马芬|泡芙|雪媚娘|舒芙蕾|提拉米苏|铜锣烧|"
    r"大福|麻薯|果冻|奶冻|冰棒|冰棍|奶昔|圣代|班戬|可丽饼|华夫|甜甜圈|"
    r"糖炒栗子|棉花糖|牛轧糖|雪花酥|拿铁|美式咖啡|气泡水)"
)

# 教程类。
TECHNIQUE_TAGS = {"烹饪基础"}

# 教程类标题。
#
# **不能简单地匹配「剁」开头**：「剁椒芦笋炒鸡蛋」「剁椒瓦块鱼」都是正经菜，
# 剁椒是配料名不是动词。第一版就是这么误伤的。
NOT_DISH_TITLE = re.compile(r"^(切|如何|怎么样?|处理)(?!.*(炒|烧|蒸|煮|炖|拌|焖))")

# 可信热量区间（每份）。
#
# 下限取 40 而不是 80：黑胡椒口蘑 79 kcal、山药芙蓉汤 43 kcal 都是正经的
# 清淡菜，按 80 切会把它们当成坏数据排掉。真正的坏数据在 10 kcal 那一档。
# 上限 2500 只拦明显抄错的（每份上万卡），份量偏大的交给热量目标去避开。
MIN_CALORIES = 40
MAX_CALORIES = 2500

# 兜底判据（没有可用标签时才走）。
STAPLE_CARB_SHARE = 0.45
PROTEIN_MIN_G = 12.0
PROTEIN_INGREDIENT = re.compile(
    r"(猪|牛|羊|鸡|鸭|鹅|鱼|虾|蟹|蛤|贝|蚝|鱿|肉|排骨|培根|香肠|火腿|蛋|豆腐|豆干|腐竹|千张)"
)
STAPLE_INGREDIENT = re.compile(
    r"(大米|米饭|糯米|小米|面粉|面条|馒头|吐司|面包|年糕|燕麦|意面|米粉|挂面|乌冬)"
)
# 菜名里的主食信号。
#
# 来源标签覆盖不全：「香菇土豆肉末盖饭」「酸汤土豆粉」「饺子皮葱油饼」
# 都没有主食标签，只按标签走会被判成荤菜，主食那一格就没菜可选了。
#
# 这里**逐个写全称而不是用单字**：早期版本拿「米」「饼」当关键词，
# 「米椒」「饼干模具」全都误伤。宁可漏几个也不误判。
STAPLE_TITLE = re.compile(
    r"(盖饭|拌饭|炒饭|焖饭|蛋包饭|饭团|米饭|烩饭|手抓饭|"
    r"拌面|炒面|汤面|焖面|凉面|担担面|面条|挂面|乌冬|意面|"
    r"米线|米粉|河粉|粉丝|土豆粉|酸辣粉|螺蛳粉|"
    r"粥|馒头|包子|饺子|馄饨|云吞|年糕|"
    r"三明治|汉堡|披萨|吐司|烧饼|葱油饼|手抓饼|煎饼|馅饼|卷饼|烙饼)"
)

# 主食要够这两条才算能单独撑起一餐。
ONE_DISH_PROTEIN_SHARE = 0.15
ONE_DISH_MIN_CALORIES = 350


def excluded_reason(title: str, tags: list[str], calories: float) -> str | None:
    """返回不进周菜单的原因；None 表示这条能用。"""
    tagset = set(tags or [])
    if tagset & TECHNIQUE_TAGS or NOT_DISH_TITLE.match(title or ""):
        return NOT_A_DISH
    if tagset & DESSERT_TAGS or DESSERT_TITLE.search(title or ""):
        return DESSERT_OR_DRINK
    if not calories or calories < MIN_CALORIES or calories > MAX_CALORIES:
        return IMPLAUSIBLE
    return None


def classify(title: str, tags: list[str], ingredient_names: list[str],
             calories: float, protein_g: float, carbs_g: float) -> str:
    """判断这道菜在一餐里扮演什么角色。"""
    tagset = set(tags or [])
    kcal = max(calories or 0, 1)
    protein_share = (protein_g or 0) * 4 / kcal

    # 主食优先判断：「鸡肉炒饭」同时带 鸡肉 与 炒饭 两个标签，它是主食不是荤菜。
    if (tagset & STAPLE_TAGS
            or STAPLE_TITLE.search(title or "")
            or _staple_fallback(tagset, ingredient_names, carbs_g, kcal)):
        if protein_share >= ONE_DISH_PROTEIN_SHARE and (calories or 0) >= ONE_DISH_MIN_CALORIES:
            return ONE_DISH
        return STAPLE
    if tagset & PROTEIN_TAGS:
        return PROTEIN
    if tagset & VEGETABLE_TAGS:
        return VEGETABLE
    return _nutrition_fallback(title, ingredient_names, protein_g or 0)


def _staple_fallback(tagset: set[str], ingredient_names: list[str],
                     carbs_g: float, kcal: float) -> bool:
    """没有主食标签时，靠碳水占比加食材兜底。

    两条都要：只看碳水占比会把土豆炖牛肉判成主食，
    只看食材会把用玉米淀粉勾芡的菜判成主食。
    """
    if tagset & (PROTEIN_TAGS | VEGETABLE_TAGS):
        return False
    if (carbs_g or 0) * 4 / kcal < STAPLE_CARB_SHARE:
        return False
    return any(STAPLE_INGREDIENT.search(n or "") for n in ingredient_names)


def _nutrition_fallback(title: str, ingredient_names: list[str], protein_g: float) -> str:
    """一个可用标签都没有时的兜底。

    蛋白**绝对量与主料两条都要**：低热量蔬菜的蛋白供能占比天然就高
    （清炒豌豆尖 98 kcal / 9g，占比 37%，比不少荤菜还高），
    而实测「明显是荤菜」与「明显是素菜」的克数分布重叠严重
    （荤 p25=14.9，素 p75=13.7），单看任何一边都切不开。
    """
    if protein_g < PROTEIN_MIN_G:
        return VEGETABLE
    if PROTEIN_INGREDIENT.search(title or ""):
        return PROTEIN
    if any(PROTEIN_INGREDIENT.search(n or "") for n in ingredient_names):
        return PROTEIN
    return VEGETABLE


# ---- 自检 ----
# 每条都对应库里实际存在的菜。改规则前先跑这个。

CASES = [
    # (标题, 标签, 食材, 热量, 蛋白, 碳水, 期望角色)
    ("鸡腿炸酱面", ["拌面", "鸡腿"], ["面条", "鸡腿"], 629, 35, 80, ONE_DISH),
    ("韩式虾仁拌饭", ["饭", "虾"], ["米饭", "虾仁"], 553, 22, 70, ONE_DISH),
    # 带主食标签但份量与蛋白都撑不起一餐，要配菜。
    ("日式酱油烤饭团", ["饭"], ["米饭", "酱油"], 97, 3, 19, STAPLE),
    ("白粥", ["粥"], ["大米", "清水"], 180, 4, 39, STAPLE),
    ("尖椒炒肉丝", ["猪肉", "下饭菜"], ["猪里脊", "尖椒"], 173, 26, 6, PROTEIN),
    ("葱烤鲫鱼", ["鱼"], ["鲫鱼", "小葱"], 136, 11, 9, PROTEIN),
    ("麻婆豆腐", ["豆腐"], ["嫩豆腐", "牛肉末"], 240, 18, 12, PROTEIN),
    ("清炒豌豆尖", ["叶类蔬菜"], ["豌豆尖", "蒜"], 98, 9, 8, VEGETABLE),
    ("菊花杏鲍菇", ["菌菇类"], ["杏鲍菇", "玉米淀粉"], 302, 5, 40, VEGETABLE),
    # 同时带荤与主食标签：它是一碗饭，不是一道荤菜。
    ("流心蛋包饭", ["饭", "鸡蛋"], ["米饭", "鸡蛋"], 642, 36, 48, ONE_DISH),
    # 来源标签没给主食标记，靠菜名认出来。这三条都是实际误判过的。
    ("香菇土豆肉末盖饭", ["下饭菜", "午餐"], ["米饭", "肉末"], 259, 12, 35, STAPLE),
    # 641 kcal 但只有 16g 蛋白（供能占比 10%），撑不起一整餐，要配个荤菜。
    # 份量大不等于能单独成餐——这条最初写成 ONE_DISH，是我预期错了。
    ("酸汤土豆粉", ["宵夜", "酸辣"], ["土豆粉", "醋"], 641, 16, 90, STAPLE),
    ("饺子皮葱油饼", ["小吃", "早餐"], ["饺子皮", "小葱"], 130, 6, 18, STAPLE),
    # 没有任何可用标签，走兜底。
    ("神秘家常菜", ["家常菜"], ["五花肉", "青椒"], 300, 20, 10, PROTEIN),
    ("神秘小炒", ["家常菜"], ["西葫芦", "蒜"], 120, 4, 12, VEGETABLE),
]

EXCLUDE_CASES = [
    # (标题, 标签, 热量, 期望)
    ("切青椒丝", [], 6, NOT_A_DISH),
    ("如何处理鲈鱼", [], 200, NOT_A_DISH),
    # 「剁椒」是配料不是动词，这些都是正经菜。第一版在这里误伤了 3 条。
    ("剁椒芦笋炒鸡蛋", ["鸡蛋"], 132, None),
    ("剁椒瓦块鱼", ["鱼"], 152, None),
    ("懒人电饭锅蛋糕", ["蛋糕", "甜品"], 659, DESSERT_OR_DRINK),
    ("西瓜莫吉托", ["饮品"], 218, DESSERT_OR_DRINK),
    ("旺仔牛奶冰棍", ["冰淇淋"], 277, DESSERT_OR_DRINK),
    # 这两条没有甜品标签，只能靠菜名认。
    ("巧做果冻布丁", ["下午茶", "微波炉"], 116, DESSERT_OR_DRINK),
    ("电饭煲糖炒栗子", ["小吃", "电饭锅"], 1050, DESSERT_OR_DRINK),
    # 名字里有「酥」「糖」但是荤菜，不能误伤。
    ("小酥肉", ["猪肉"], 420, None),
    ("糖醋排骨", ["排骨"], 380, None),
    ("孜香酸辣拌饺", ["饺子"], 10992, IMPLAUSIBLE),
    ("海苔虾饼", ["虾"], 9, IMPLAUSIBLE),
    # 清淡菜的热量本来就低，不能按 80 一刀切。
    ("黑胡椒口蘑", ["菌菇类"], 79, None),
    ("山药芙蓉汤", ["汤"], 43, None),
    ("尖椒炒肉丝", ["猪肉"], 173, None),
]


def _self_check() -> int:
    failed = 0
    for title, tags, ings, cal, protein, carbs, want in CASES:
        got = classify(title, tags, ings, cal, protein, carbs)
        if got != want:
            print(f"  角色错：{title} 期望 {want}，实际 {got}")
            failed += 1
    for title, tags, cal, want in EXCLUDE_CASES:
        got = excluded_reason(title, tags, cal)
        if got != want:
            print(f"  排除错：{title} 期望 {want}，实际 {got}")
            failed += 1
    total = len(CASES) + len(EXCLUDE_CASES)
    print(f"自检 {total} 条，失败 {failed} 项")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(_self_check())
