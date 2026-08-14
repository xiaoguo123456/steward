import { Tabs, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppIcon } from '@/components/ui/icon';
import { colors, fontFamily, radius, shadow } from '@/theme/tokens';

type TabIconProps = {
  focused: boolean;
  active: React.ComponentProps<typeof AppIcon>['name'];
  inactive: React.ComponentProps<typeof AppIcon>['name'];
};

function TabIcon({ focused, active, inactive }: TabIconProps) {
  return (
    <AppIcon
      color={focused ? colors.primary : colors.textTertiary}
      name={focused ? active : inactive}
      size={21}
    />
  );
}

function CaptureTabButton() {
  const router = useRouter();

  return (
    <View pointerEvents="box-none" style={styles.captureSlot}>
      <Pressable
        accessibilityLabel="新建任务"
        accessibilityRole="button"
        onPress={() => router.push('/tasks/new')}
        style={({ pressed }) => [styles.captureButton, pressed && styles.capturePressed]}
      >
        <AppIcon color={colors.background} name="add" size={31} />
      </Pressable>
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      backBehavior="history"
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.background },
        tabBarActiveTintColor: colors.primary,
        tabBarButton: (props) => {
          const {
            android_ripple: androidRipple,
            children,
            hoverEffect,
            pressOpacity,
            ref: buttonRef,
            style,
            ...pressableProps
          } = props;

          void androidRipple;
          void hoverEffect;
          void pressOpacity;
          void buttonRef;

          return (
            <Pressable
              {...pressableProps}
              android_ripple={{ color: 'transparent' }}
              style={({ pressed }) => [style, pressed && styles.tabPressed]}
            >
              {children}
            </Pressable>
          );
        },
        tabBarInactiveTintColor: colors.textTertiary,
        tabBarLabelStyle: styles.tabLabel,
        tabBarItemStyle: styles.tabItem,
        tabBarStyle: styles.tabBar,
      }}
    >
      <Tabs.Screen
        name="today"
        options={{
          title: '今日',
          tabBarIcon: ({ focused }) => (
            <TabIcon active="checkmark-circle" focused={focused} inactive="checkmark-circle-outline" />
          ),
        }}
      />
      <Tabs.Screen
        name="calendar"
        options={{
          title: '日历',
          tabBarIcon: ({ focused }) => (
            <TabIcon active="calendar" focused={focused} inactive="calendar-outline" />
          ),
        }}
      />
      <Tabs.Screen
        name="create"
        options={{
          title: '',
          tabBarButton: () => <CaptureTabButton />,
          tabBarLabel: () => <Text style={styles.captureLabel}>新增</Text>,
        }}
      />
      <Tabs.Screen
        name="lists"
        options={{
          title: '清单',
          tabBarIcon: ({ focused }) => (
            <TabIcon active="list" focused={focused} inactive="list-outline" />
          ),
        }}
      />
      <Tabs.Screen
        name="notes"
        options={{
          title: '笔记',
          tabBarIcon: ({ focused }) => (
            <TabIcon active="document-text" focused={focused} inactive="document-text-outline" />
          ),
        }}
      />
      <Tabs.Screen name="me" options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    height: 78,
    paddingTop: 7,
    paddingBottom: 10,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  tabItem: {
    paddingTop: 2,
  },
  tabPressed: {
    opacity: 0.58,
  },
  tabLabel: {
    marginTop: 2,
    fontFamily,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '500',
  },
  captureSlot: {
    flex: 1,
    alignItems: 'center',
  },
  captureButton: {
    position: 'absolute',
    top: -27,
    width: 58,
    height: 58,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderWidth: 4,
    borderColor: colors.background,
    ...shadow,
  },
  capturePressed: {
    transform: [{ scale: 0.95 }],
    opacity: 0.9,
  },
  captureLabel: {
    color: 'transparent',
    fontSize: 11,
    lineHeight: 15,
  },
});
