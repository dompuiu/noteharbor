import 'package:flutter/material.dart';

import '../data/dataset_controller.dart';
import '../features/import/import_dataset_screen.dart';
import '../features/table/notes_table_screen.dart';

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
    const backgroundColor = Color(0xFFF0E3D1);
    const surfaceColor = Color(0xFFFFFAF2);
    const primaryColor = Color(0xFF6F421F);
    const secondaryColor = Color(0xFFA37037);

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
                    color: const Color(0xFF241912),
                  ),
              headlineMedium: ThemeData.light().textTheme.headlineMedium?.copyWith(
                    fontWeight: FontWeight.w800,
                    color: const Color(0xFF241912),
                  ),
              titleLarge: ThemeData.light().textTheme.titleLarge?.copyWith(
                    fontWeight: FontWeight.w700,
                    color: const Color(0xFF241912),
                  ),
              bodyMedium: ThemeData.light().textTheme.bodyMedium?.copyWith(
                    color: const Color(0xFF241912),
                  ),
              labelLarge: ThemeData.light().textTheme.labelLarge?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
            ),
      ),
      home: AnimatedBuilder(
        animation: _controller,
        builder: (context, _) {
          if (_controller.dataset == null) {
            return ImportDatasetScreen(controller: _controller);
          }

          return NotesTableScreen(controller: _controller);
        },
      ),
    );
  }
}
