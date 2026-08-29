import type { ComponentProps } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppIcon } from '@/components/ui/icon';
import { StatePanel } from '@/components/ui/state-panel';
import { colors, fontFamily, radius } from '@/theme/tokens';
import {
  HOME_FEATURE_PREVIEWS,
  HOME_TOP_TABS,
  type HomeTopTabId,
  type PlannedHomeTopTabId,
} from './home-top-navigation';

const previewIcons: Record<
  PlannedHomeTopTabId,
  ComponentProps<typeof AppIcon>['name']
> = {
  music: 'radio',
  footprints: 'map-outline',
  mood: 'leaf-outline',
};

export function HomeTopTabs({
  value,
  onChange,
}: {
  value: HomeTopTabId;
  onChange: (value: HomeTopTabId) => void;
}) {
  return (
    <View accessibilityRole="tablist" style={styles.shell}>
      <ScrollView
        contentContainerStyle={styles.rail}
        horizontal
        showsHorizontalScrollIndicator={false}
      >
        {HOME_TOP_TABS.map((tab) => {
          const selected = value === tab.id;
          return (
            <Pressable
              accessibilityLabel={`${tab.label}首页分区`}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              aria-selected={selected}
              key={tab.id}
              onPress={() => onChange(tab.id)}
              style={({ pressed }) => [styles.tab, pressed && styles.tabPressed]}
            >
              <Text style={[styles.label, selected && styles.labelSelected]}>{tab.label}</Text>
              <View style={[styles.indicator, selected && styles.indicatorSelected]} />
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

export function HomeFeaturePreview({ tab }: { tab: PlannedHomeTopTabId }) {
  const preview = HOME_FEATURE_PREVIEWS[tab];

  return (
    <View style={styles.preview}>
      <StatePanel
        icon={previewIcons[tab]}
        message={preview.message}
        title={preview.title}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    marginHorizontal: -16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  rail: {
    minWidth: '100%',
    paddingHorizontal: 8,
  },
  tab: {
    minWidth: 64,
    minHeight: 48,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabPressed: {
    opacity: 0.56,
  },
  label: {
    color: colors.textSecondary,
    fontFamily,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '500',
  },
  labelSelected: {
    color: colors.primaryStrong,
    fontWeight: '700',
  },
  indicator: {
    position: 'absolute',
    right: 14,
    bottom: 0,
    left: 14,
    height: 2,
    borderRadius: radius.pill,
    backgroundColor: 'transparent',
  },
  indicatorSelected: {
    backgroundColor: colors.primary,
  },
  preview: {
    paddingTop: 24,
  },
});
