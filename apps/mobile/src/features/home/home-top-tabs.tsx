import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { relationshipColors } from '@/features/relationships/theme';
import { colors, fontFamily, radius } from '@/theme/tokens';
import { HOME_TOP_TABS, type HomeTopTabId } from './home-top-navigation';

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
        style={styles.scroll}
      >
        {HOME_TOP_TABS.map((tab) => {
          const selected = value === tab.id;
          const relationshipsSelected = selected && tab.id === 'relationships';
          const inspirationSelected = selected && tab.id === 'inspiration';
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
              <Text style={[
                styles.label,
                selected && styles.labelSelected,
                relationshipsSelected && styles.labelRelationshipsSelected,
                inspirationSelected && styles.labelInspirationSelected,
              ]}>
                {tab.label}
              </Text>
              <View style={[
                styles.indicator,
                selected && styles.indicatorSelected,
                relationshipsSelected && styles.indicatorRelationshipsSelected,
                inspirationSelected && styles.indicatorInspirationSelected,
              ]} />
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    minHeight: 49,
    marginHorizontal: -16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  rail: {
    minWidth: '100%',
    paddingHorizontal: 8,
  },
  scroll: {
    height: 49,
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
  labelRelationshipsSelected: {
    color: relationshipColors.strong,
  },
  labelInspirationSelected: {
    color: colors.inspiration,
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
  indicatorRelationshipsSelected: {
    backgroundColor: relationshipColors.primary,
  },
  indicatorInspirationSelected: {
    backgroundColor: colors.inspiration,
  },
});
