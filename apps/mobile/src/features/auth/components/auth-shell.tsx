import type { ComponentProps, PropsWithChildren, ReactNode } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { colors, fontFamily, radius } from '@/theme/tokens';

type AuthShellProps = PropsWithChildren<{
  heading: string;
  subtitle: string;
  compactLogo?: boolean;
}>;

export function AuthShell({ children, heading, subtitle, compactLogo = false }: AuthShellProps) {
  return (
    <AppScreen includeBottomInset>
      <ScrollView
        bounces={false}
        contentContainerStyle={[styles.content, compactLogo && styles.compactContent]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.brand}>
          <View style={styles.logo}>
            <AppIcon color={colors.background} name="checkmark" size={43} />
          </View>
          <Text style={styles.brandName}>清单</Text>
        </View>
        <View style={styles.copy}>
          <Text style={styles.heading}>{heading}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
        {children}
      </ScrollView>
    </AppScreen>
  );
}

type AuthInputProps = ComponentProps<typeof TextInput> & {
  containerStyle?: StyleProp<ViewStyle>;
  icon: ComponentProps<typeof AppIcon>['name'];
  trailing?: ReactNode;
};

export function AuthInput({ containerStyle, icon, trailing, style, ...props }: AuthInputProps) {
  return (
    <View style={[styles.inputShell, containerStyle]}>
      <AppIcon color={colors.textTertiary} name={icon} size={19} />
      <TextInput
        autoCapitalize="none"
        placeholderTextColor={colors.textTertiary}
        style={[styles.input, style]}
        {...props}
      />
      {trailing}
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: Platform.select({ web: 54, default: 24 }),
    paddingBottom: 30,
  },
  compactContent: {
    paddingTop: Platform.select({ web: 46, default: 54 }),
  },
  brand: {
    alignItems: 'center',
  },
  logo: {
    width: 80,
    height: 80,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  brandName: {
    marginTop: 14,
    color: colors.text,
    fontFamily,
    fontSize: 24,
    lineHeight: 32,
    fontWeight: '700',
  },
  copy: {
    marginTop: 22,
    marginBottom: 20,
    alignItems: 'center',
  },
  heading: {
    color: colors.text,
    fontFamily,
    fontSize: 28,
    lineHeight: 38,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  subtitle: {
    marginTop: 8,
    color: colors.textSecondary,
    fontFamily,
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
  },
  inputShell: {
    height: 54,
    marginBottom: 16,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  input: {
    flex: 1,
    height: 54,
    paddingVertical: 0,
    color: colors.text,
    fontFamily,
    fontSize: 15,
    lineHeight: 21,
  },
});
