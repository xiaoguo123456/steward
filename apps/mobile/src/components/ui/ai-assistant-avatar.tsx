import { Image, StyleSheet } from 'react-native';

type AiAssistantAvatarProps = {
  size?: number;
};

export function AiAssistantAvatar({ size = 32 }: AiAssistantAvatarProps) {
  return (
    <Image
      accessibilityIgnoresInvertColors
      accessible={false}
      resizeMode="contain"
      source={require('../../../assets/images/ai/assistant-pages.png')}
      style={[styles.image, { width: size, height: size }]}
    />
  );
}

const styles = StyleSheet.create({
  image: {
    flexShrink: 0,
  },
});
