import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';

/// Lets a plain mouse drag drive a scroller. Flutter excludes
/// [PointerDeviceKind.mouse] from drag gestures by default, so a desktop
/// scroller without this can only be panned with a trackpad or the wheel.
class MouseDragScrollBehavior extends MaterialScrollBehavior {
  const MouseDragScrollBehavior();

  @override
  Set<PointerDeviceKind> get dragDevices => {
        ...super.dragDevices,
        PointerDeviceKind.mouse,
      };
}
