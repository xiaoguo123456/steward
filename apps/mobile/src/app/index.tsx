import { Redirect } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useBootState } from '@/api/provider';
import { colors } from '@/theme/tokens';

/**
 * 启动路由。
 *
 * 恢复登录态需要读一次安全存储，在结果出来之前先显示占位，
 * 避免已登录用户看到一闪而过的登录页。
 */
export default function IndexRoute() {
  const boot = useBootState();

  if (boot === 'loading') {
    return (
      <View style={styles.container}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }
  return <Redirect href={boot === 'signed-in' ? '/today' : '/login'} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
});
