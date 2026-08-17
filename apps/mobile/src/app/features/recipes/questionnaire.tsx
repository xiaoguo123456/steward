import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { NavHeader } from '@/components/ui/nav-header';
import {
  InlineNotice,
  RecipePrimaryButton,
} from '@/features/recipes/components/recipe-ui';
import { useRecipePrototype } from '@/features/recipes/recipe-context';
import { goalLabels, type RecipeGoal, type RecipeProfile } from '@/features/recipes/model';
import { recipeColors } from '@/features/recipes/theme';
import { colors, fontFamily, radius } from '@/theme/tokens';

const goalOptions: {
  id: RecipeGoal;
  icon: React.ComponentProps<typeof AppIcon>['name'];
  description: string;
}[] = [
  { id: 'balanced', icon: 'leaf-outline', description: '规律搭配，保持食物多样' },
  { id: 'fat-loss', icon: 'trending-down-outline', description: '适度能量缺口，优先饱腹感' },
  { id: 'muscle-gain', icon: 'barbell-outline', description: '增加优质蛋白和训练日能量' },
  { id: 'steady-sugar', icon: 'pulse-outline', description: '少添加糖，优先全谷物和膳食纤维' },
];

const allergyOptions = ['乳制品', '蛋类', '花生', '坚果', '鱼类', '甲壳类', '大豆', '麸质'];
const restrictionOptions = ['不吃猪肉', '不吃牛肉', '素食', '清真饮食'];
const tasteOptions = ['清淡', '家常', '微辣', '鲜香', '酸甜'];
const equipmentOptions = ['炒锅', '电饭煲', '烤箱', '空气炸锅', '破壁机'];

function ToggleChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        selected && styles.chipSelected,
        pressed && styles.pressed,
      ]}
    >
      {selected ? <AppIcon color={colors.primaryStrong} name="checkmark" size={15} /> : null}
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

function Field({
  label,
  value,
  unit,
  onChangeText,
}: {
  label: string;
  value: string;
  unit: string;
  onChangeText: (value: string) => void;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.fieldInputRow}>
        <TextInput
          accessibilityLabel={label}
          keyboardType="number-pad"
          maxLength={3}
          onChangeText={onChangeText}
          placeholder="--"
          placeholderTextColor={recipeColors.faint}
          style={styles.fieldInput}
          value={value}
        />
        <Text style={styles.fieldUnit}>{unit}</Text>
      </View>
    </View>
  );
}

function SectionIntro({ title, copy }: { title: string; copy: string }) {
  return (
    <View style={styles.sectionIntro}>
      <Text accessibilityRole="header" style={styles.stepTitle}>
        {title}
      </Text>
      <Text style={styles.stepCopy}>{copy}</Text>
    </View>
  );
}

function GoalStep({
  draft,
  setDraft,
}: {
  draft: RecipeProfile;
  setDraft: React.Dispatch<React.SetStateAction<RecipeProfile>>;
}) {
  return (
    <>
      <SectionIntro copy="先确定菜单优化方向，之后可以随时更改。" title="你希望饮食更接近哪种状态？" />
      <View style={styles.choiceList}>
        {goalOptions.map((option) => {
          const selected = draft.goal === option.id;
          return (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              key={option.id}
              onPress={() => setDraft((current) => ({ ...current, goal: option.id }))}
              style={({ pressed }) => [
                styles.choiceRow,
                pressed && styles.pressed,
              ]}
            >
              <View style={[styles.choiceIcon, selected && styles.choiceIconSelected]}>
                <AppIcon
                  color={colors.primaryStrong}
                  name={option.icon}
                  size={21}
                />
              </View>
              <View style={styles.choiceCopy}>
                <Text style={styles.choiceTitle}>{goalLabels[option.id]}</Text>
                <Text style={styles.choiceMeta}>{option.description}</Text>
              </View>
              <View style={[styles.radio, selected && styles.radioSelected]}>
                {selected ? <View style={styles.radioDot} /> : null}
              </View>
            </Pressable>
          );
        })}
      </View>
      <InlineNotice icon="information-circle-outline" tone="neutral">
        “健康控糖”仅用于一般健康饮食推荐，不提供疾病诊断或治疗方案。
      </InlineNotice>
    </>
  );
}

function BodyStep({
  draft,
  setDraft,
}: {
  draft: RecipeProfile;
  setDraft: React.Dispatch<React.SetStateAction<RecipeProfile>>;
}) {
  return (
    <>
      <SectionIntro copy="这些数据只用于估算适合你的计划范围，可以稍后修改。" title="了解你的身体与活动情况" />

      <Text style={styles.groupLabel}>性别</Text>
      <View style={styles.segment}>
        {(
          [
            ['female', '女性'],
            ['male', '男性'],
          ] as const
        ).map(([id, label]) => {
          const selected = draft.sex === id;
          return (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              key={id}
              onPress={() => setDraft((current) => ({ ...current, sex: id }))}
              style={[styles.segmentItem, selected && styles.segmentItemSelected]}
            >
              <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.fieldGrid}>
        <Field
          label="年龄"
          onChangeText={(age) => setDraft((current) => ({ ...current, age }))}
          unit="岁"
          value={draft.age}
        />
        <Field
          label="身高"
          onChangeText={(height) => setDraft((current) => ({ ...current, height }))}
          unit="cm"
          value={draft.height}
        />
        <Field
          label="当前体重"
          onChangeText={(weight) => setDraft((current) => ({ ...current, weight }))}
          unit="kg"
          value={draft.weight}
        />
        <Field
          label="目标体重"
          onChangeText={(targetWeight) => setDraft((current) => ({ ...current, targetWeight }))}
          unit="kg"
          value={draft.targetWeight}
        />
      </View>

      <Text style={styles.groupLabel}>日常活动水平</Text>
      <View style={styles.compactChoiceList}>
        {(
          [
            ['light', '较少活动', '久坐为主，偶尔散步'],
            ['moderate', '适度活动', '每周运动 2—4 次'],
            ['active', '经常活动', '多数天都会运动'],
          ] as const
        ).map(([id, title, meta]) => {
          const selected = draft.activity === id;
          return (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              key={id}
              onPress={() => setDraft((current) => ({ ...current, activity: id }))}
              style={({ pressed }) => [styles.compactChoice, pressed && styles.pressed]}
            >
              <View style={styles.compactCopy}>
                <Text style={styles.compactTitle}>{title}</Text>
                <Text style={styles.compactMeta}>{meta}</Text>
              </View>
              <AppIcon
                color={selected ? colors.primaryStrong : recipeColors.faint}
                name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                size={22}
              />
            </Pressable>
          );
        })}
      </View>
    </>
  );
}

function RestrictionsStep({
  draft,
  setDraft,
}: {
  draft: RecipeProfile;
  setDraft: React.Dispatch<React.SetStateAction<RecipeProfile>>;
}) {
  const toggle = (field: 'allergies' | 'dietaryRestrictions', value: string) => {
    setDraft((current) => {
      const selected = current[field].includes(value);
      return {
        ...current,
        [field]: selected
          ? current[field].filter((item) => item !== value)
          : [...current[field], value],
      };
    });
  };

  return (
    <>
      <SectionIntro copy="过敏和明确禁忌会在推荐前强制排除，请认真核对。" title="有哪些食物需要避开？" />

      <View style={styles.alertLabelRow}>
        <AppIcon color={recipeColors.orange} name="shield-checkmark-outline" size={18} />
        <Text style={styles.groupLabelInline}>过敏原</Text>
      </View>
      <View style={styles.chipGroup}>
        {allergyOptions.map((item) => (
          <ToggleChip
            key={item}
            label={item}
            onPress={() => toggle('allergies', item)}
            selected={draft.allergies.includes(item)}
          />
        ))}
      </View>

      <Text style={styles.groupLabel}>饮食限制</Text>
      <View style={styles.chipGroup}>
        {restrictionOptions.map((item) => (
          <ToggleChip
            key={item}
            label={item}
            onPress={() => toggle('dietaryRestrictions', item)}
            selected={draft.dietaryRestrictions.includes(item)}
          />
        ))}
      </View>

      <View style={styles.medicalRow}>
        <View style={styles.medicalCopy}>
          <Text style={styles.medicalTitle}>已确诊糖尿病或正在使用降糖药物</Text>
          <Text style={styles.medicalMeta}>开启后不自动生成治疗型菜单</Text>
        </View>
        <Switch
          accessibilityLabel="已确诊糖尿病或正在使用降糖药物"
          onValueChange={(diagnosedDiabetes) =>
            setDraft((current) => ({ ...current, diagnosedDiabetes }))
          }
          thumbColor={colors.background}
          trackColor={{ false: '#C7D0CB', true: colors.primary }}
          value={draft.diagnosedDiabetes}
        />
      </View>

      {draft.diagnosedDiabetes ? (
        <InlineNotice icon="medical-outline" tone="warning">
          我们仍可提供普通菜谱浏览，但个体化饮食请结合医生或注册营养师建议。
        </InlineNotice>
      ) : null}
    </>
  );
}

function CookingStep({
  draft,
  setDraft,
}: {
  draft: RecipeProfile;
  setDraft: React.Dispatch<React.SetStateAction<RecipeProfile>>;
}) {
  const toggle = (field: 'tastes' | 'equipment', value: string) => {
    setDraft((current) => {
      const selected = current[field].includes(value);
      return {
        ...current,
        [field]: selected
          ? current[field].filter((item) => item !== value)
          : [...current[field], value],
      };
    });
  };

  return (
    <>
      <SectionIntro copy="让推荐更贴近日常条件，而不是只在图片里好看。" title="平时怎样做饭？" />

      <Text style={styles.groupLabel}>通常为几个人准备</Text>
      <View style={styles.stepper}>
        <Pressable
          accessibilityLabel="减少用餐人数"
          accessibilityRole="button"
          disabled={draft.people <= 1}
          onPress={() => setDraft((current) => ({ ...current, people: Math.max(1, current.people - 1) }))}
          style={({ pressed }) => [styles.stepperButton, pressed && styles.pressed]}
        >
          <AppIcon color={draft.people <= 1 ? recipeColors.faint : recipeColors.ink} name="remove" size={21} />
        </Pressable>
        <Text style={styles.stepperValue}>{draft.people} 人</Text>
        <Pressable
          accessibilityLabel="增加用餐人数"
          accessibilityRole="button"
          disabled={draft.people >= 6}
          onPress={() => setDraft((current) => ({ ...current, people: Math.min(6, current.people + 1) }))}
          style={({ pressed }) => [styles.stepperButton, pressed && styles.pressed]}
        >
          <AppIcon color={draft.people >= 6 ? recipeColors.faint : recipeColors.ink} name="add" size={21} />
        </Pressable>
      </View>

      <Text style={styles.groupLabel}>一餐最多愿意花多久</Text>
      <View style={styles.chipGroup}>
        {[20, 30, 40, 60].map((minutes) => (
          <ToggleChip
            key={minutes}
            label={`${minutes} 分钟`}
            onPress={() => setDraft((current) => ({ ...current, maxCookingMinutes: minutes }))}
            selected={draft.maxCookingMinutes === minutes}
          />
        ))}
      </View>

      <Text style={styles.groupLabel}>每餐预算</Text>
      <View style={styles.segment}>
        {(
          [
            ['economy', '实惠'],
            ['standard', '适中'],
            ['flexible', '灵活'],
          ] as const
        ).map(([id, label]) => {
          const selected = draft.budget === id;
          return (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              key={id}
              onPress={() => setDraft((current) => ({ ...current, budget: id }))}
              style={[styles.segmentItem, selected && styles.segmentItemSelected]}
            >
              <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.groupLabel}>喜欢的口味</Text>
      <View style={styles.chipGroup}>
        {tasteOptions.map((item) => (
          <ToggleChip
            key={item}
            label={item}
            onPress={() => toggle('tastes', item)}
            selected={draft.tastes.includes(item)}
          />
        ))}
      </View>

      <Text style={styles.groupLabel}>家中常用厨具</Text>
      <View style={styles.chipGroup}>
        {equipmentOptions.map((item) => (
          <ToggleChip
            key={item}
            label={item}
            onPress={() => toggle('equipment', item)}
            selected={draft.equipment.includes(item)}
          />
        ))}
      </View>
    </>
  );
}

export default function RecipeQuestionnaireScreen() {
  const router = useRouter();
  const { profile, setProfile } = useRecipePrototype();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<RecipeProfile>(profile);

  const save = () => {
    setProfile(draft);
    router.back();
  };

  return (
    <AppScreen backgroundColor={recipeColors.background} includeBottomInset>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.screen}
      >
        <NavHeader title="饮食档案" />
        <View style={styles.progressHeader}>
          <Text style={styles.progressText}>第 {step + 1} 步，共 4 步</Text>
          <Text style={styles.progressHint}>{Math.round(((step + 1) / 4) * 100)}%</Text>
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${((step + 1) / 4) * 100}%` }]} />
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {step === 0 ? <GoalStep draft={draft} setDraft={setDraft} /> : null}
          {step === 1 ? <BodyStep draft={draft} setDraft={setDraft} /> : null}
          {step === 2 ? <RestrictionsStep draft={draft} setDraft={setDraft} /> : null}
          {step === 3 ? <CookingStep draft={draft} setDraft={setDraft} /> : null}
        </ScrollView>

        <View style={styles.footer}>
          {step > 0 ? (
            <RecipePrimaryButton
              label="上一步"
              onPress={() => setStep((current) => current - 1)}
              style={styles.footerSecondary}
              tone="secondary"
            />
          ) : null}
          <RecipePrimaryButton
            icon={step === 3 ? 'checkmark-circle-outline' : 'arrow-forward'}
            label={step === 3 ? '保存饮食档案' : '下一步'}
            onPress={() => (step === 3 ? save() : setStep((current) => current + 1))}
            style={styles.footerPrimary}
          />
        </View>
      </KeyboardAvoidingView>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  progressHeader: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 7,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  progressText: {
    color: recipeColors.muted,
    fontFamily,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '600',
  },
  progressHint: {
    color: colors.primaryStrong,
    fontFamily,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  progressTrack: {
    height: 3,
    marginHorizontal: 16,
    overflow: 'hidden',
    borderRadius: radius.pill,
    backgroundColor: recipeColors.line,
  },
  progressFill: {
    height: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryStrong,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 22,
    paddingBottom: 120,
  },
  sectionIntro: {
    marginBottom: 20,
  },
  stepTitle: {
    color: recipeColors.ink,
    fontFamily,
    fontSize: 24,
    lineHeight: 32,
    fontWeight: '700',
    letterSpacing: -0.35,
  },
  stepCopy: {
    marginTop: 7,
    color: recipeColors.muted,
    fontFamily,
    fontSize: 13,
    lineHeight: 20,
  },
  choiceList: {
    marginBottom: 18,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: recipeColors.line,
  },
  choiceRow: {
    minHeight: 78,
    paddingHorizontal: 4,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: recipeColors.line,
  },
  choiceIcon: {
    width: 42,
    height: 42,
    marginRight: 12,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: recipeColors.surfaceMuted,
  },
  choiceIconSelected: {
    backgroundColor: colors.primarySoft,
  },
  choiceCopy: {
    flex: 1,
    minWidth: 0,
  },
  choiceTitle: {
    color: recipeColors.ink,
    fontFamily,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '700',
  },
  choiceMeta: {
    marginTop: 2,
    color: recipeColors.muted,
    fontFamily,
    fontSize: 11,
    lineHeight: 17,
  },
  radio: {
    width: 22,
    height: 22,
    marginLeft: 10,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: recipeColors.faint,
  },
  radioSelected: {
    borderColor: colors.primaryStrong,
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryStrong,
  },
  groupLabel: {
    marginTop: 22,
    marginBottom: 10,
    color: recipeColors.ink,
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '700',
  },
  segment: {
    minHeight: 48,
    padding: 3,
    flexDirection: 'row',
    borderRadius: radius.md,
    backgroundColor: recipeColors.surfaceMuted,
  },
  segmentItem: {
    flex: 1,
    minHeight: 42,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentItemSelected: {
    backgroundColor: colors.background,
  },
  segmentText: {
    color: recipeColors.muted,
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
  },
  segmentTextSelected: {
    color: recipeColors.ink,
    fontWeight: '700',
  },
  fieldGrid: {
    marginTop: 18,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 12,
  },
  field: {
    width: '48.3%',
    minHeight: 82,
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: recipeColors.surfaceMuted,
  },
  fieldLabel: {
    color: recipeColors.muted,
    fontFamily,
    fontSize: 10,
    lineHeight: 15,
    fontWeight: '600',
  },
  fieldInputRow: {
    marginTop: 3,
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  fieldInput: {
    flex: 1,
    minWidth: 0,
    height: 42,
    paddingVertical: 0,
    color: recipeColors.ink,
    fontFamily,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  fieldUnit: {
    color: recipeColors.muted,
    fontFamily,
    fontSize: 11,
    lineHeight: 17,
  },
  compactChoiceList: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: recipeColors.line,
  },
  compactChoice: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: recipeColors.line,
  },
  compactCopy: {
    flex: 1,
  },
  compactTitle: {
    color: recipeColors.ink,
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  compactMeta: {
    marginTop: 2,
    color: recipeColors.muted,
    fontFamily,
    fontSize: 11,
    lineHeight: 16,
  },
  alertLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  groupLabelInline: {
    color: recipeColors.ink,
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '700',
  },
  chipGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9,
  },
  chip: {
    minHeight: 40,
    paddingHorizontal: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: radius.pill,
    backgroundColor: recipeColors.surfaceMuted,
  },
  chipSelected: {
    backgroundColor: colors.primarySoft,
  },
  chipText: {
    color: recipeColors.muted,
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
  },
  chipTextSelected: {
    color: colors.primaryStrong,
  },
  medicalRow: {
    minHeight: 76,
    marginTop: 26,
    marginBottom: 12,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: radius.lg,
    backgroundColor: recipeColors.surfaceMuted,
  },
  medicalCopy: {
    flex: 1,
    minWidth: 0,
  },
  medicalTitle: {
    color: recipeColors.ink,
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '700',
  },
  medicalMeta: {
    marginTop: 3,
    color: recipeColors.muted,
    fontFamily,
    fontSize: 10,
    lineHeight: 15,
  },
  stepper: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: radius.md,
    backgroundColor: recipeColors.surfaceMuted,
  },
  stepperButton: {
    width: 54,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperValue: {
    color: recipeColors.ink,
    fontFamily,
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
    flexDirection: 'row',
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: recipeColors.line,
    backgroundColor: recipeColors.background,
  },
  footerSecondary: {
    flex: 0.8,
  },
  footerPrimary: {
    flex: 1.4,
  },
  pressed: {
    opacity: 0.56,
  },
});
