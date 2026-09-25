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
  errorLabel = 'No image',
  fit = 'contain',
  radius = 8,
  placeholderIcon = null,
}: {
  uri: string | null;
  fallbackSource?: ImageRequireSource | null;
  width: number;
  height: number;
  label?: string;
  tone?: 'light' | 'dark';
  errorLabel?: string;
  fit?: 'contain' | 'cover';
  radius?: number;
  placeholderIcon?: React.ReactNode | null;
}) {
  const [failed, setFailed] = useState(false);
  const tokens = tone === 'dark' ? viewerDark : viewerLight;

  const renderPlaceholder = (copy: string) => {
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
            borderRadius: radius,
            backgroundColor: tokens.tagBackground,
            borderColor: tokens.tagBorder,
          },
        ]}>
        {placeholderIcon ?? (
          <Text style={[styles.placeholderText, { color: tokens.tagText }]}>
            {copy}
          </Text>
        )}
      </View>
    );
  };

  // Null stays `No image`; load failure shows errorLabel (`Missing image` in
  // the slideshow) unless a bundled fallback asset was provided (ticket 08).
  if (!uri) {
    return renderPlaceholder('No image');
  }

  if (failed) {
    return renderPlaceholder(errorLabel);
  }

  return (
    <Image
      source={{ uri }}
      style={{ width, height, borderRadius: radius }}
      resizeMode={fit}
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
