import 'package:flutter/material.dart';

import '../features/table/notes_table_screen.dart';

class ViewerApp extends StatelessWidget {
  const ViewerApp({super.key});

  @override
  Widget build(BuildContext context) {
    const seedColor = Color(0xFF2F5D50);

    return MaterialApp(
      title: 'Note Harbor Viewer',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: seedColor),
        scaffoldBackgroundColor: const Color(0xFFF2EEE6),
        useMaterial3: true,
        textTheme: ThemeData.light().textTheme.apply(
              bodyColor: const Color(0xFF202223),
              displayColor: const Color(0xFF202223),
            ),
      ),
      home: const NotesTableScreen(),
    );
  }
}
