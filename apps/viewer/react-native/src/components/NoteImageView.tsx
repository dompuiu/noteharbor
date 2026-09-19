import { useState } from 'react';
import { Image, StyleSheet, Text, View, type ImageRequireSource } from 'react-native';
import { viewerDark, viewerLight } from '../theme/viewerTheme';

export function NoteImageView({
  uri,
  fallbackSource = null,
  width,
  height,
  label,
  tone = 'light',
}: {
  uri: string | null;
  fallbackSource?: ImageRequireSource | null;
  width: number;
  height: number;
  label?: string;
  tone?: 'light' | 'dark';
}) {
  const [failed, setFailed] = useState(false);
  const tokens = tone === 'dark' ? viewerDark : viewerLight;

  if (!uri || failed) {
    if (fallbackSource) {
      return (
        <Image
          source={fallbackSource}
          style={{ width, height }}
          resizeMode="contain"
          accessibilityLabel={label ?? 'Note image'}
        />
      );
    }

    return (
      <View
        style={[
          styles.placeholder,
          {
            width,
            height,
            backgroundColor: tokens.tagBackground,
            borderColor: tokens.tagBorder,
          },
        ]}>
        <Text style={[styles.placeholderText, { color: tokens.tagText }]}>
          No image
        </Text>
      </View>
    );
  }

  return (
    <Image
      source={{ uri }}
      style={{ width, height }}
      resizeMode="contain"
      accessibilityLabel={label ?? 'Note image'}
      onError={() => setFailed(true)}
    />
  );
}

const styles = StyleSheet.create({
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 8,
  },
  placeholderText: {
    fontSize: 12,
    fontWeight: '600',
  },
});
