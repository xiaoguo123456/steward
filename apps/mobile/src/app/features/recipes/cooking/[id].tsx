import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { NavHeader } from '@/components/ui/nav-header';
import {
  RecipePrimaryButton,
  RecipeStepImage,
} from '@/features/recipes/components/recipe-ui';
import { recipeColors } from '@/features/recipes/theme';
import { useRecipePrototype } from '@/features/recipes/recipe-context';
import { useClientReady } from '@/hooks/use-client-ready';
import { colors, fontFamily, radius } from '@/theme/tokens';

function formatTimer(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function StepTimer({ minutes }: { minutes: number }) {
  const [remainingSeconds, setRemainingSeconds] = useState(minutes * 60);
  const [timerRunning, setTimerRunning] = useState(false);

  useEffect(() => {
    if (!timerRunning) return;
    const timerId = setInterval(() => {
      setRemainingSeconds((current) => {
        if (current <= 1) {
          setTimerRunning(false);
          return 0;
        }
        return current - 1;
      });
    }, 1000);
    return () => clearInterval(timerId);
  }, [timerRunning]);

  return (
    <View style={styles.timerBlock}>
      <View>
        <Text style={styles.blockLabel}>步骤计时</Text>
        <Text style={styles.timerValue}>{formatTimer(remainingSeconds)}</Text>
      </View>
      <View style={styles.timerActions}>
        <Pressable
          accessibilityLabel={timerRunning ? '暂停计时' : '开始计时'}
          accessibilityRole="button"
          onPress={() => setTimerRunning((current) => !current)}
          style={({ pressed }) => [styles.timerButton, pressed && styles.pressed]}
        >
          <AppIcon
            color={colors.background}
            name={timerRunning ? 'pause' : 'play'}
            size={21}
          />
        </Pressable>
        <Pressable
          accessibilityLabel="重置计时"
          accessibilityRole="button"
          onPress={() => {
            setRemainingSeconds(minutes * 60);
            setTimerRunning(false);
          }}
          style={({ pressed }) => [styles.resetButton, pressed && styles.pressed]}
        >
          <AppIcon color={recipeColors.ink} name="refresh" size={19} />
        </Pressable>
      </View>
    </View>
  );
}

export default function CookingModeScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const recipeId = Array.isArray(params.id) ? params.id[0] : params.id;
  const clientReady = useClientReady();
  const { markCooked, getRecipe } = useRecipePrototype();
  const recipe = clientReady && recipeId ? getRecipe(recipeId) : undefined;
  const [stepIndex, setStepIndex] = useState(0);

  const step = recipe?.steps[stepIndex];

  if (!clientReady) {
    return (
      <AppScreen backgroundColor={recipeColors.background} includeBottomInset>
        <NavHeader title="烹饪模式" />
        <View style={styles.loadingContent}>
          <View style={styles.loadingImage} />
          <View style={styles.loadingKicker} />
          <View style={styles.loadingTitle} />
          <View style={styles.loadingLine} />
          <View style={[styles.loadingLine, styles.loadingLineShort]} />
        </View>
      </AppScreen>
    );
  }

  if (!recipe || !step) {
    return (
      <AppScreen backgroundColor={recipeColors.background} includeBottomInset>
        <NavHeader title="烹饪模式" />
        <View style={styles.missing}>
          <Text style={styles.missingTitle}>无法打开这个烹饪步骤</Text>
          <RecipePrimaryButton label="返回" onPress={() => router.back()} style={styles.missingButton} />
        </View>
      </AppScreen>
    );
  }

  const isFirst = stepIndex === 0;
  const isLast = stepIndex === recipe.steps.length - 1;

  const next = () => {
    if (isLast) {
      markCooked(recipe.id);
      router.back();
      return;
    }
    setStepIndex((current) => current + 1);
  };

  return (
    <AppScreen backgroundColor={recipeColors.background} includeBottomInset>
      <NavHeader
        right={<Text style={styles.headerProgress}>{stepIndex + 1} / {recipe.steps.length}</Text>}
        title="烹饪模式"
      />

      <View style={styles.progressBars}>
        {recipe.steps.map((item, index) => (
          <View
            key={`${item.title}-${index}`}
            style={[
              styles.progressBar,
              index <= stepIndex && styles.progressBarActive,
            ]}
          />
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <RecipeStepImage
          fallbackToRecipe
          recipe={recipe}
          stepIndex={stepIndex}
          style={styles.stepImage}
        />

        <View style={styles.stepHeading}>
          <Text style={styles.stepCount}>第 {stepIndex + 1} 步</Text>
          <Text accessibilityRole="header" style={styles.stepTitle}>
            {step.title}
          </Text>
          <Text style={styles.stepDescription}>{step.description}</Text>
        </View>

        {step.ingredients && step.ingredients.length > 0 ? (
          <View style={styles.ingredientsBlock}>
            <Text style={styles.blockLabel}>这一步需要</Text>
            <View style={styles.ingredients}>
              {step.ingredients.map((ingredient) => (
                <View key={ingredient} style={styles.ingredientChip}>
                  <Text style={styles.ingredientText}>{ingredient}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {step.timerMinutes ? (
          <StepTimer key={`${recipe.id}-${stepIndex}`} minutes={step.timerMinutes} />
        ) : null}

        <View style={styles.tipRow}>
          <AppIcon color={colors.primaryStrong} name="bulb-outline" size={18} />
          <Text style={styles.tipText}>先准备好这一步需要的食材，再开始操作会更从容。</Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <RecipePrimaryButton
          disabled={isFirst}
          icon="arrow-back"
          label="上一步"
          onPress={() => setStepIndex((current) => Math.max(0, current - 1))}
          style={styles.footerSecondary}
          tone="secondary"
        />
        <RecipePrimaryButton
          icon={isLast ? 'checkmark-circle-outline' : 'arrow-forward'}
          label={isLast ? '完成烹饪' : '下一步'}
          onPress={next}
          style={styles.footerPrimary}
        />
      </View>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  headerProgress: {
    color: recipeColors.muted,
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  progressBars: {
    paddingHorizontal: 16,
    flexDirection: 'row',
    gap: 5,
  },
  progressBar: {
    flex: 1,
    height: 3,
    borderRadius: radius.pill,
    backgroundColor: recipeColors.line,
  },
  progressBarActive: {
    backgroundColor: colors.primary,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 124,
  },
  stepImage: {
    width: '100%',
    height: 210,
    borderRadius: radius.lg,
  },
  stepHeading: {
    paddingTop: 24,
  },
  stepCount: {
    color: recipeColors.orange,
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
  },
  stepTitle: {
    marginTop: 6,
    color: recipeColors.ink,
    fontFamily,
    fontSize: 28,
    lineHeight: 36,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  stepDescription: {
    marginTop: 12,
    color: recipeColors.ink,
    fontFamily,
    fontSize: 17,
    lineHeight: 28,
    fontWeight: '500',
  },
  ingredientsBlock: {
    marginTop: 28,
  },
  blockLabel: {
    color: recipeColors.muted,
    fontFamily,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
  },
  ingredients: {
    marginTop: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  ingredientChip: {
    minHeight: 38,
    paddingHorizontal: 13,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: recipeColors.surfaceMuted,
  },
  ingredientText: {
    color: recipeColors.ink,
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
  },
  timerBlock: {
    minHeight: 104,
    marginTop: 28,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: radius.lg,
    backgroundColor: recipeColors.surfaceMuted,
  },
  timerValue: {
    marginTop: 4,
    color: recipeColors.ink,
    fontFamily,
    fontSize: 31,
    lineHeight: 38,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.6,
  },
  timerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  timerButton: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  resetButton: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  tipRow: {
    minHeight: 52,
    marginTop: 24,
    paddingHorizontal: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: recipeColors.line,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: recipeColors.line,
  },
  tipText: {
    flex: 1,
    color: recipeColors.muted,
    fontFamily,
    fontSize: 11,
    lineHeight: 17,
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
    flex: 0.9,
  },
  footerPrimary: {
    flex: 1.1,
  },
  missing: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  missingTitle: {
    color: recipeColors.ink,
    fontFamily,
    fontSize: 16,
    lineHeight: 23,
    fontWeight: '700',
  },
  missingButton: {
    minWidth: 130,
    marginTop: 16,
  },
  loadingContent: {
    paddingHorizontal: 16,
    paddingTop: 18,
  },
  loadingImage: {
    width: '100%',
    height: 210,
    borderRadius: radius.lg,
    backgroundColor: recipeColors.surfaceMuted,
  },
  loadingKicker: {
    width: 52,
    height: 14,
    marginTop: 26,
    borderRadius: radius.sm,
    backgroundColor: recipeColors.surfaceMuted,
  },
  loadingTitle: {
    width: '62%',
    height: 34,
    marginTop: 10,
    borderRadius: radius.sm,
    backgroundColor: recipeColors.surfaceMuted,
  },
  loadingLine: {
    width: '100%',
    height: 16,
    marginTop: 18,
    borderRadius: radius.sm,
    backgroundColor: recipeColors.surfaceMuted,
  },
  loadingLineShort: {
    width: '78%',
    marginTop: 9,
  },
  pressed: {
    opacity: 0.56,
  },
});
