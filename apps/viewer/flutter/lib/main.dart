import 'package:flutter/widgets.dart';

import 'app/viewer_app.dart';
import 'app/window/window_persistence.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await setupWindowPersistence();
  runApp(const ViewerApp());
}
