import { StyleSheet, View, type ViewStyle } from 'react-native';

// Pure React Native glyphs approximating the Material icons Flutter uses
// (search_rounded, close_rounded, file_upload_outlined, image_outlined).
// No new native dependencies; sized and colored by props.

interface IconProps {
  size?: number;
  color: string;
}

function barThickness(size: number): number {
  return Math.max(1.5, size * 0.11);
}

function barStyle(
  left: number,
  top: number,
  width: number,
  thickness: number,
  color: string,
  rotate?: string,
): ViewStyle {
  return {
    position: 'absolute',
    left,
    top,
    width,
    height: thickness,
    borderRadius: thickness / 2,
    backgroundColor: color,
    ...(rotate == null ? null : { transform: [{ rotate } as const] }),
  };
}

export function SearchIcon({ size = 18, color }: IconProps) {
  const thickness = barThickness(size);
  const ringSize = size * 0.58;
  const ringOffset = size * 0.08;
  const ring: ViewStyle = {
    position: 'absolute',
    left: ringOffset,
    top: ringOffset,
    width: ringSize,
    height: ringSize,
    borderRadius: ringSize / 2,
    borderWidth: thickness,
    borderColor: color,
  };
  const handleOffset = ringOffset + ringSize * 0.78;
  const handle = barStyle(
    handleOffset,
    handleOffset,
    size * 0.34,
    thickness,
    color,
    '45deg',
  );

  return (
    <View
      testID="icon-search"
      accessibilityLabel="Search"
      style={{ width: size, height: size }}>
      <View style={ring} />
      <View style={handle} />
    </View>
  );
}

export function CloseIcon({ size = 18, color }: IconProps) {
  const thickness = barThickness(size);
  const barLength = size * 0.66;
  const centered = (size - barLength) / 2;
  const middle = (size - thickness) / 2;
  const first = barStyle(centered, middle, barLength, thickness, color, '45deg');
  const second = barStyle(
    centered,
    middle,
    barLength,
    thickness,
    color,
    '-45deg',
  );

  return (
    <View
      testID="icon-close"
      accessibilityLabel="Close"
      style={{ width: size, height: size }}>
      <View style={first} />
      <View style={second} />
    </View>
  );
}

export function UploadIcon({ size = 20, color }: IconProps) {
  const thickness = barThickness(size);
  const centerX = size / 2;
  // Arrow tip; the two head arms meet here. Each arm is a horizontal bar
  // rotated about its own center, so the centers sit one half-arm diagonally
  // down-left/down-right of the tip (RN rotates clockwise).
  const tipY = size * 0.1;
  const armLength = size * 0.34;
  const armOffset = armLength * 0.3536;
  const armTop = tipY + armOffset - thickness / 2;
  const shaft = barStyle(
    centerX - thickness / 2,
    tipY,
    thickness,
    size * 0.44,
    color,
  );
  const leftHead = barStyle(
    centerX - armOffset - armLength / 2,
    armTop,
    armLength,
    thickness,
    color,
    '-45deg',
  );
  const rightHead = barStyle(
    centerX + armOffset - armLength / 2,
    armTop,
    armLength,
    thickness,
    color,
    '45deg',
  );
  const trayWidth = size * 0.72;
  const tray = barStyle(
    (size - trayWidth) / 2,
    size - thickness - size * 0.08,
    trayWidth,
    thickness,
    color,
  );

  return (
    <View
      testID="icon-upload"
      accessibilityLabel="Upload"
      style={{ width: size, height: size }}>
      <View style={shaft} />
      <View style={leftHead} />
      <View style={rightHead} />
      <View style={tray} />
    </View>
  );
}

export function ImageIcon({ size = 22, color }: IconProps) {
  const frameBorder = Math.max(1.5, size * 0.07);
  const dotSize = size * 0.2;
  const dot: ViewStyle = {
    position: 'absolute',
    left: size * 0.14,
    top: size * 0.1,
    width: dotSize,
    height: dotSize,
    borderRadius: dotSize / 2,
    backgroundColor: color,
  };
  const mountainWidth = size * 0.62;
  const mountain: ViewStyle = {
    position: 'absolute',
    left: (size - mountainWidth) / 2 - frameBorder,
    bottom: -frameBorder,
    width: 0,
    height: 0,
    backgroundColor: 'transparent',
    borderStyle: 'solid',
    borderLeftWidth: mountainWidth / 2,
    borderRightWidth: mountainWidth / 2,
    borderBottomWidth: size * 0.34,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: color,
  };

  return (
    <View
      testID="icon-image"
      accessibilityLabel="Image"
      style={{ width: size, height: size * 0.78 }}>
      <View
        style={[styles.imageFrame, { borderColor: color, borderWidth: frameBorder }]}>
        <View style={dot} />
        <View style={mountain} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  imageFrame: {
    flex: 1,
    borderRadius: 2,
    overflow: 'hidden',
  },
});
