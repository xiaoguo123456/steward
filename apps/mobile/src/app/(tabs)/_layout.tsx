import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { Tabs, useRouter } from 'expo-router';
import type { PropsWithChildren } from 'react';
import { useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { AppIcon } from '@/components/ui/icon';
import { colors, fontFamily, glass, radius } from '@/theme/tokens';

const nativeGlassAvailable = Platform.OS === 'ios' && isGlassEffectAPIAvailable();

type GlassSurfaceProps = PropsWithChildren<{
  reducedTransparency: boolean;
  style: StyleProp<ViewStyle>;
  variant: 'tabBar' | 'capture';
}>;

function GlassSurface({ children, reducedTransparency, style, variant }: GlassSurfaceProps) {
  const fallbackStyle =
    variant === 'tabBar' ? styles.tabBarGlassFallback : styles.captureGlassFallback;
  const opaqueStyle =
    variant === 'tabBar' ? styles.tabBarGlassOpaque : styles.captureGlassOpaque;

  if (nativeGlassAvailable && !reducedTransparency) {
    return (
      <GlassView
        colorScheme="light"
        glassEffectStyle="regular"
        pointerEvents="none"
        style={style}
        tintColor={variant === 'tabBar' ? glass.tabBarTint : glass.captureTint}
      >
        {children}
      </GlassView>
    );
  }

  return (
    <View
      pointerEvents="none"
      style={[style, reducedTransparency ? opaqueStyle : fallbackStyle]}
    >
      {children}
    </View>
  );
}

function useReducedTransparency() {
  const [reducedTransparency, setReducedTransparency] = useState(false);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceTransparencyEnabled().then((enabled) => {
      if (mounted) setReducedTransparency(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener(
      'reduceTransparencyChanged',
      setReducedTransparency,
    );

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return reducedTransparency;
}

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

function CaptureTabButton({ reducedTransparency }: { reducedTransparency: boolean }) {
  const router = useRouter();

  return (
    <View style={styles.captureSlot}>
      <Pressable
        accessibilityLabel="新增并整理"
        accessibilityRole="button"
        onPress={() => router.push('/capture/new')}
        style={({ pressed }) => [styles.captureButton, pressed && styles.capturePressed]}
      >
        <GlassSurface
          reducedTransparency={reducedTransparency}
          style={styles.captureGlass}
          variant="capture"
        >
          <AppIcon color={colors.background} name="add" size={25} />
        </GlassSurface>
      </Pressable>
    </View>
  );
}

function BottomTabGlass({ reducedTransparency }: { reducedTransparency: boolean }) {
  return (
    <GlassSurface
      reducedTransparency={reducedTransparency}
      style={styles.tabBarGlass}
      variant="tabBar"
    />
  );
}

export default function TabsLayout() {
  const reducedTransparency = useReducedTransparency();

  return (
    <Tabs
      backBehavior="history"
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.background },
        tabBarActiveTintColor: colors.primary,
        tabBarBackground: () => (
          <BottomTabGlass reducedTransparency={reducedTransparency} />
        ),
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
          title: '首页',
          tabBarIcon: ({ focused }) => (
            <TabIcon active="home" focused={focused} inactive="home-outline" />
          ),
        }}
      />
      <Tabs.Screen
        name="lists"
        options={{
          title: '计划',
          tabBarIcon: ({ focused }) => (
            <TabIcon active="calendar" focused={focused} inactive="calendar-outline" />
          ),
        }}
      />
      <Tabs.Screen
        name="create"
        options={{
          title: '',
          tabBarButton: () => (
            <CaptureTabButton reducedTransparency={reducedTransparency} />
          ),
          tabBarLabel: () => <Text style={styles.captureLabel}>新增</Text>,
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
      <Tabs.Screen
        name="data"
        options={{
          title: '打卡',
          tabBarIcon: ({ focused }) => (
            <TabIcon
              active="checkmark-circle"
              focused={focused}
              inactive="checkmark-circle-outline"
            />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 0,
    height: 82,
    paddingTop: 6,
    paddingBottom: 16,
    backgroundColor: 'transparent',
    borderTopWidth: 0,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    shadowColor: colors.primaryStrong,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 7,
  },
  tabBarGlass: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    borderWidth: 1,
    borderColor: glass.tabBarBorder,
    overflow: 'hidden',
  },
  tabBarGlassFallback: {
    backgroundColor: glass.tabBarFallback,
  },
  tabBarGlassOpaque: {
    backgroundColor: glass.tabBarOpaque,
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
    pointerEvents: 'box-none',
  },
  captureButton: {
    position: 'absolute',
    top: -20,
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    shadowColor: colors.primaryStrong,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.17,
    shadowRadius: 8,
    elevation: 6,
  },
  captureGlass: {
    width: '100%',
    height: '100%',
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: glass.captureBorder,
    overflow: 'hidden',
  },
  captureGlassFallback: {
    backgroundColor: glass.captureTint,
  },
  captureGlassOpaque: {
    backgroundColor: colors.primary,
  },
  capturePressed: {
    transform: [{ scale: 0.96 }],
    opacity: 0.9,
  },
  captureLabel: {
    color: 'transparent',
    fontSize: 11,
    lineHeight: 15,
  },
});
