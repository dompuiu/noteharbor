import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';

/// Tells a screen reader about something it could not see: an action whose
/// result appears elsewhere, or a status the visual UI carries on its own.
void announce(BuildContext context, String message) {
  SemanticsService.sendAnnouncement(
    View.of(context),
    message,
    Directionality.of(context),
  );
}
