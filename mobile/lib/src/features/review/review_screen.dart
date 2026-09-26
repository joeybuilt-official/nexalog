import "package:flutter/material.dart";
import "package:flutter_riverpod/flutter_riverpod.dart";

import "review_providers.dart";

/// Spaced-review session (web parity §P7). One card at a time; 4 grade buttons.
class ReviewScreen extends ConsumerStatefulWidget {
  const ReviewScreen({super.key});

  @override
  ConsumerState<ReviewScreen> createState() => _ReviewScreenState();
}

class _ReviewScreenState extends ConsumerState<ReviewScreen> {
  int _idx = 0;
  bool _grading = false;

  Future<void> _grade(ReviewItem item, int grade) async {
    if (_grading) return;
    setState(() => _grading = true);
    try {
      await ref.read(reviewRepoProvider).grade(item.captureId, grade);
    } finally {
      if (mounted) setState(() { _grading = false; _idx++; });
    }
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<List<ReviewItem>> items = ref.watch(reviewProvider);
    return Scaffold(
      appBar: AppBar(title: const Text("Spaced Review")),
      body: items.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (Object e, _) => Center(child: Text("Error: $e")),
        data: (List<ReviewItem> list) {
          if (list.isEmpty || _idx >= list.length) {
            return const Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  Icon(Icons.check_circle_outline, size: 56, color: Colors.green),
                  SizedBox(height: 16),
                  Text("All caught up!", style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
                  SizedBox(height: 8),
                  Text("No items due for review.", style: TextStyle(color: Colors.grey)),
                ],
              ),
            );
          }
          final ReviewItem item = list[_idx];
          return Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  "${_idx + 1} / ${list.length}",
                  style: Theme.of(context).textTheme.labelSmall,
                ),
                const SizedBox(height: 12),
                ReviewCard(item: item, onGrade: (int g) => _grade(item, g), disabled: _grading),
              ],
            ),
          );
        },
      ),
    );
  }
}

class ReviewCard extends StatelessWidget {
  const ReviewCard({required this.item, required this.onGrade, this.disabled = false, super.key});

  final ReviewItem item;
  final ValueChanged<int> onGrade;
  final bool disabled;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Wrap(
              spacing: 6,
              runSpacing: 4,
              children: <Widget>[
                if (item.isNew) _Badge("New", Colors.blue.shade100, Colors.blue.shade700),
                if (item.kind != null) _Badge(item.kind!, null, null),
                if (item.themeLabel != null) _Badge(item.themeLabel!, null, null),
              ],
            ),
            const SizedBox(height: 10),
            Text(item.title, style: Theme.of(context).textTheme.titleMedium, maxLines: 2, overflow: TextOverflow.ellipsis),
            if (item.host != null)
              Text(item.host!, style: Theme.of(context).textTheme.labelSmall),
            if (item.summary != null && item.summary!.trim().isNotEmpty) ...<Widget>[
              const SizedBox(height: 8),
              Text(item.summary!, maxLines: 3, overflow: TextOverflow.ellipsis),
            ],
            const SizedBox(height: 16),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: <Widget>[
                FilledButton(
                  onPressed: disabled ? null : () => onGrade(0),
                  style: FilledButton.styleFrom(backgroundColor: Colors.red.shade400),
                  child: const Text("Again"),
                ),
                OutlinedButton(onPressed: disabled ? null : () => onGrade(1), child: const Text("Hard")),
                OutlinedButton(onPressed: disabled ? null : () => onGrade(3), child: const Text("Good")),
                FilledButton(onPressed: disabled ? null : () => onGrade(5), child: const Text("Easy")),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _Badge extends StatelessWidget {
  const _Badge(this.label, this.bg, this.fg);
  final String label;
  final Color? bg;
  final Color? fg;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: bg ?? Theme.of(context).colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Text(
        label,
        style: Theme.of(context).textTheme.labelSmall?.copyWith(color: fg),
      ),
    );
  }
}
