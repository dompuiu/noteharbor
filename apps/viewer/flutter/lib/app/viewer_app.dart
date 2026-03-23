import 'package:flutter/material.dart';

import '../features/table/notes_table_screen.dart';

class ViewerApp extends StatelessWidget {
  const ViewerApp({super.key});

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
      home: const NotesTableScreen(),
    );
  }
}
