import 'package:flutter/material.dart';

import '../data/dataset_controller.dart';
import '../features/import/import_dataset_screen.dart';
import '../features/table/notes_table_screen.dart';
import 'viewer_palette.dart';

class ViewerApp extends StatefulWidget {
  const ViewerApp({super.key});

  @override
  State<ViewerApp> createState() => _ViewerAppState();
}

class _ViewerAppState extends State<ViewerApp> {
  late final DatasetController _controller;

  @override
  void initState() {
    super.initState();
    _controller = DatasetController()..load();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    const primaryColor = ViewerPalette.accentStrong;
    const secondaryColor = ViewerPalette.accent;

    final baseText = ThemeData.light().textTheme;
    final textTheme = baseText.copyWith(
      headlineSmall: baseText.headlineSmall?.copyWith(
        fontFamily: 'Inter',
        fontWeight: FontWeight.w800,
        letterSpacing: -0.4,
        height: 1.1,
        color: ViewerPalette.text,
      ),
      headlineMedium: baseText.headlineMedium?.copyWith(
        fontFamily: 'Inter',
        fontWeight: FontWeight.w800,
        letterSpacing: -0.5,
        height: 1.05,
        color: ViewerPalette.text,
      ),
      titleLarge: baseText.titleLarge?.copyWith(
        fontFamily: 'Inter',
        fontWeight: FontWeight.w700,
        letterSpacing: -0.2,
        color: ViewerPalette.text,
      ),
      titleMedium: baseText.titleMedium?.copyWith(
        fontFamily: 'Inter',
        fontWeight: FontWeight.w700,
        color: ViewerPalette.text,
      ),
      bodyLarge: baseText.bodyLarge?.copyWith(
        fontFamily: 'Inter',
        color: ViewerPalette.text,
        height: 1.45,
      ),
      bodyMedium: baseText.bodyMedium?.copyWith(
        fontFamily: 'Inter',
        color: ViewerPalette.text,
        height: 1.45,
      ),
      labelLarge: baseText.labelLarge?.copyWith(
        fontFamily: 'Inter',
        fontWeight: FontWeight.w700,
        letterSpacing: 0.2,
      ),
      labelMedium: baseText.labelMedium?.copyWith(
        fontFamily: 'Inter',
        fontWeight: FontWeight.w700,
        letterSpacing: 0.4,
      ),
    );

    final scheme = const ColorScheme.light(
      primary: primaryColor,
      onPrimary: ViewerPalette.surface,
      secondary: secondaryColor,
      onSecondary: ViewerPalette.surface,
      surface: ViewerPalette.surface,
      onSurface: ViewerPalette.text,
      surfaceContainerHighest: ViewerPalette.surfaceContainer,
      outline: ViewerPalette.borderControl,
      outlineVariant: ViewerPalette.border,
      error: ViewerPalette.danger,
      onError: ViewerPalette.onDanger,
    );

    return MaterialApp(
      title: 'Note Harbor',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: scheme,
        scaffoldBackgroundColor: ViewerPalette.pageBackground,
        useMaterial3: true,
        fontFamily: 'Inter',
        textTheme: textTheme,
        appBarTheme: AppBarTheme(
          backgroundColor: ViewerPalette.pageBackground,
          foregroundColor: ViewerPalette.text,
          elevation: 0,
          scrolledUnderElevation: 0,
          titleTextStyle: textTheme.titleLarge?.copyWith(
            fontWeight: FontWeight.w800,
            fontSize: 20,
          ),
        ),
        filledButtonTheme: FilledButtonThemeData(
          style: FilledButton.styleFrom(
            backgroundColor: primaryColor,
            foregroundColor: ViewerPalette.surface,
            textStyle: const TextStyle(
              fontFamily: 'Inter',
              fontWeight: FontWeight.w700,
            ),
            shape: RoundedRectangleBorder(
              borderRadius:
                  BorderRadius.circular(ViewerPalette.radiusLg),
            ),
            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
          ),
        ),
        outlinedButtonTheme: OutlinedButtonThemeData(
          style: OutlinedButton.styleFrom(
            foregroundColor: primaryColor,
            side: const BorderSide(color: ViewerPalette.borderControl),
            textStyle: const TextStyle(
              fontFamily: 'Inter',
              fontWeight: FontWeight.w700,
            ),
            shape: RoundedRectangleBorder(
              borderRadius:
                  BorderRadius.circular(ViewerPalette.radiusLg),
            ),
            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
          ),
        ),
        textButtonTheme: TextButtonThemeData(
          style: TextButton.styleFrom(
            foregroundColor: ViewerPalette.accentStrong,
            textStyle: const TextStyle(
              fontFamily: 'Inter',
              fontWeight: FontWeight.w700,
            ),
            shape: RoundedRectangleBorder(
              borderRadius:
                  BorderRadius.circular(ViewerPalette.radiusMd),
            ),
          ),
        ),
        inputDecorationTheme: InputDecorationTheme(
          filled: true,
          fillColor: ViewerPalette.surface,
          hintStyle: const TextStyle(color: ViewerPalette.textFaint),
          prefixIconColor: ViewerPalette.textMuted,
          suffixIconColor: ViewerPalette.textMuted,
          contentPadding:
              const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          border: OutlineInputBorder(
            borderRadius:
                BorderRadius.circular(ViewerPalette.radiusLg),
            borderSide: const BorderSide(color: ViewerPalette.border),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius:
                BorderRadius.circular(ViewerPalette.radiusLg),
            borderSide: const BorderSide(color: ViewerPalette.border),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius:
                BorderRadius.circular(ViewerPalette.radiusLg),
            borderSide: const BorderSide(
              color: ViewerPalette.accent,
              width: 1.5,
            ),
          ),
        ),
        dividerTheme: const DividerThemeData(
          color: ViewerPalette.borderSoft,
          thickness: 1,
          space: 1,
        ),
        dialogTheme: DialogThemeData(
          backgroundColor: ViewerPalette.surface,
          shape: RoundedRectangleBorder(
            borderRadius:
                BorderRadius.circular(ViewerPalette.radiusXl),
            side: const BorderSide(color: ViewerPalette.border),
          ),
        ),
        scrollbarTheme: ScrollbarThemeData(
          thumbColor: WidgetStateProperty.resolveWith((states) {
            if (states.contains(WidgetState.hovered)) {
              return ViewerPalette.textMuted;
            }
            return ViewerPalette.textFaint;
          }),
          trackColor: WidgetStateProperty.all(Colors.transparent),
          thickness: WidgetStateProperty.all(8),
          radius: const Radius.circular(8),
          minThumbLength: 48,
        ),
        tooltipTheme: TooltipThemeData(
          decoration: BoxDecoration(
            color: ViewerPalette.text,
            borderRadius:
                BorderRadius.circular(ViewerPalette.radiusSm),
          ),
          textStyle: const TextStyle(
            fontFamily: 'Inter',
            color: ViewerPalette.surface,
            fontSize: 12,
            fontWeight: FontWeight.w600,
          ),
        ),
        pageTransitionsTheme: const PageTransitionsTheme(
          builders: {
            TargetPlatform.android: FadeForwardsPageTransitionsBuilder(),
            TargetPlatform.iOS: FadeForwardsPageTransitionsBuilder(),
            TargetPlatform.macOS: FadeForwardsPageTransitionsBuilder(),
            TargetPlatform.windows: FadeForwardsPageTransitionsBuilder(),
            TargetPlatform.linux: FadeForwardsPageTransitionsBuilder(),
          },
        ),
      ),
      home: AnimatedBuilder(
        animation: _controller,
        builder: (context, _) {
          final dataset = _controller.dataset;
          final reduceMotion =
              MediaQuery.disableAnimationsOf(context);
          final Widget child;
          if (dataset == null || dataset.collections.isEmpty) {
            child = ImportDatasetScreen(
              controller: _controller,
              key: const ValueKey('import'),
            );
          } else {
            child = NotesTableScreen(
              controller: _controller,
              key: const ValueKey('table'),
            );
          }
          return AnimatedSwitcher(
            duration: reduceMotion
                ? Duration.zero
                : const Duration(milliseconds: 220),
            switchInCurve: Curves.easeOut,
            switchOutCurve: Curves.easeIn,
            transitionBuilder: (widget, animation) => FadeTransition(
              opacity: animation,
              child: widget,
            ),
            child: child,
          );
        },
      ),
    );
  }
}
