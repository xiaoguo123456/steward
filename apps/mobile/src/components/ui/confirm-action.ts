import { Alert, Platform } from 'react-native';

type ConfirmActionOptions = {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
};

/**
 * 统一原生与 Web 的确认交互。
 * React Native Web 的 Alert 不支持多按钮回调，不能直接用于删除等确认流程。
 */
export function confirmAction({
  title,
  message,
  confirmLabel,
  cancelLabel = '取消',
  destructive = false,
}: ConfirmActionOptions): Promise<boolean> {
  if (Platform.OS === 'web') {
    return Promise.resolve(globalThis.confirm?.(`${title}\n\n${message}`) ?? false);
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: cancelLabel, style: 'cancel', onPress: () => resolve(false) },
      {
        text: confirmLabel,
        style: destructive ? 'destructive' : 'default',
        onPress: () => resolve(true),
      },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}
