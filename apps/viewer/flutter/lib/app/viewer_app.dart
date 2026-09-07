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
    const backgroundColor = ViewerPalette.pageBackground;
    const surfaceColor = ViewerPalette.surface;
    const primaryColor = ViewerPalette.accentStrong;
    const secondaryColor = ViewerPalette.accent;

    return MaterialApp(
      title: 'Note Harbor',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: const ColorScheme.light(
          primary: primaryColor,
          secondary: secondaryColor,
          surface: surfaceColor,
        ),
        scaffoldBackgroundColor: backgroundColor,
        useMaterial3: true,
        textTheme: ThemeData.light().textTheme.copyWith(
              headlineSmall: ThemeData.light().textTheme.headlineSmall?.copyWith(
                    fontWeight: FontWeight.w800,
                    color: ViewerPalette.text,
                  ),
              headlineMedium: ThemeData.light().textTheme.headlineMedium?.copyWith(
                    fontWeight: FontWeight.w800,
                    color: ViewerPalette.text,
                  ),
              titleLarge: ThemeData.light().textTheme.titleLarge?.copyWith(
                    fontWeight: FontWeight.w700,
                    color: ViewerPalette.text,
                  ),
              bodyMedium: ThemeData.light().textTheme.bodyMedium?.copyWith(
                    color: ViewerPalette.text,
                  ),
              labelLarge: ThemeData.light().textTheme.labelLarge?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
            ),
      ),
      home: AnimatedBuilder(
        animation: _controller,
        builder: (context, _) {
          final dataset = _controller.dataset;

          if (dataset == null || dataset.collections.isEmpty) {
            return ImportDatasetScreen(controller: _controller);
          }

          return NotesTableScreen(controller: _controller);
        },
      ),
    );
  }
}
