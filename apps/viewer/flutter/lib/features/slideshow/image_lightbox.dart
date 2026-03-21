import 'package:flutter/material.dart';

import '../../models/note_image.dart';
import '../../models/note_record.dart';

class ImageSequenceItem {
  const ImageSequenceItem({
    required this.note,
    required this.image,
  });

  final NoteRecord note;
  final NoteImage image;

  String get label => '${note.title} - ${image.displayLabel}';
}

class ImageLightbox extends StatefulWidget {
  const ImageLightbox({
    required this.items,
    required this.initialIndex,
    super.key,
  });

  final List<ImageSequenceItem> items;
  final int initialIndex;

  @override
  State<ImageLightbox> createState() => _ImageLightboxState();
}

class _ImageLightboxState extends State<ImageLightbox> {
  late final PageController _controller;
  late int _currentIndex;

  @override
  void initState() {
    super.initState();
    _currentIndex = widget.initialIndex;
    _controller = PageController(initialPage: widget.initialIndex);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _jump(int nextIndex) {
    _controller.animateToPage(
      nextIndex,
      duration: const Duration(milliseconds: 220),
      curve: Curves.easeOut,
    );
  }

  @override
  Widget build(BuildContext context) {
    final item = widget.items[_currentIndex];

    return Scaffold(
      backgroundColor: const Color(0xFF121514),
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 8),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Image Viewer',
                          style: Theme.of(context).textTheme.labelLarge?.copyWith(
                                color: const Color(0xFFA3C6B2),
                                letterSpacing: 1.1,
                              ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          item.label,
                          style: Theme.of(context).textTheme.titleLarge?.copyWith(
                                color: Colors.white,
                                fontWeight: FontWeight.w700,
                              ),
                        ),
                      ],
                    ),
                  ),
                  Text(
                    '${_currentIndex + 1} / ${widget.items.length}',
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(color: Colors.white70),
                  ),
                  const SizedBox(width: 16),
                  FilledButton.tonal(
                    onPressed: () => Navigator.of(context).pop(),
                    child: const Text('Close'),
                  ),
                ],
              ),
            ),
            Expanded(
              child: Row(
                children: [
                  _ArrowButton(
                    icon: Icons.arrow_back_rounded,
                    onPressed: widget.items.length > 1
                        ? () => _jump((_currentIndex - 1 + widget.items.length) % widget.items.length)
                        : null,
                  ),
                  Expanded(
                    child: PageView.builder(
                      controller: _controller,
                      itemCount: widget.items.length,
                      onPageChanged: (value) => setState(() => _currentIndex = value),
                      itemBuilder: (context, index) {
                        final imageItem = widget.items[index];
                        return Padding(
                          padding: const EdgeInsets.all(24),
                          child: DecoratedBox(
                            decoration: BoxDecoration(
                              color: const Color(0xFF1D2320),
                              borderRadius: BorderRadius.circular(28),
                              border: Border.all(color: const Color(0xFF32443D)),
                            ),
                            child: ClipRRect(
                              borderRadius: BorderRadius.circular(28),
                              child: InteractiveViewer(
                                minScale: 0.7,
                                maxScale: 4,
                                child: Center(
                                  child: Image.asset(
                                    imageItem.image.assetPath,
                                    fit: BoxFit.contain,
                                    errorBuilder: (context, error, stackTrace) {
                                      return const Padding(
                                        padding: EdgeInsets.all(32),
                                        child: Text(
                                          'This image asset is missing from the bundled dataset.',
                                          style: TextStyle(color: Colors.white70),
                                          textAlign: TextAlign.center,
                                        ),
                                      );
                                    },
                                  ),
                                ),
                              ),
                            ),
                          ),
                        );
                      },
                    ),
                  ),
                  _ArrowButton(
                    icon: Icons.arrow_forward_rounded,
                    onPressed: widget.items.length > 1
                        ? () => _jump((_currentIndex + 1) % widget.items.length)
                        : null,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ArrowButton extends StatelessWidget {
  const _ArrowButton({
    required this.icon,
    required this.onPressed,
  });

  final IconData icon;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12),
      child: IconButton.filledTonal(
        onPressed: onPressed,
        icon: Icon(icon),
        iconSize: 30,
        style: IconButton.styleFrom(
          backgroundColor: const Color(0xFF24302B),
          foregroundColor: Colors.white,
          disabledBackgroundColor: const Color(0xFF1A1E1C),
          disabledForegroundColor: Colors.white24,
          minimumSize: const Size(56, 56),
        ),
      ),
    );
  }
}
