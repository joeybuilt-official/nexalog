import "package:flutter/material.dart";
import "package:flutter_riverpod/flutter_riverpod.dart";

import "../../theme/knowledge_garden_tokens.dart";
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
    final KnowledgeGardenTokens tokens = KnowledgeGardenTokens.of(context);
    final AsyncValue<List<ReviewItem>> items = ref.watch(reviewProvider);
    return Scaffold(
      appBar: AppBar(title: const Text("Spaced Review")),
      body: items.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (Object e, _) => Center(child: Text("Error: $e")),
        data: (List<ReviewItem> list) {
          if (list.isEmpty || _idx >= list.length) {
            // `--t-person` is the garden's only green, and it belongs to the
            // *person* page type — using it for "done" would be exactly the
            // category error the token system exists to prevent. The web's
            // `text-green-500` here resolves to nothing under its own
            // `--color-*: initial` wall (globals.css defines no success token),
            // so this uses Material's semantic `primary` rather than inventing
            // a garden token. See the PR's honest-limits section.
            return Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  Icon(
                    Icons.check_circle_outline,
                    size: 56,
                    color: Theme.of(context).colorScheme.primary,
                  ),
                  const SizedBox(height: 16),
                  const Text("All caught up!",
                      style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
                  const SizedBox(height: 8),
                  Text("No items due for review.",
                      style: TextStyle(color: tokens.mutedForeground)),
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
    final KnowledgeGardenTokens tokens = KnowledgeGardenTokens.of(context);
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
                // The web marks "New" with `bg-blue-100 text-blue-700` /
                // `dark:bg-blue-900/40 dark:text-blue-300` — classes that
                // resolve to NOTHING under globals.css's own `--color-*: initial`
                // palette wall, because the web defines no "new"/success token.
                // There is therefore no web value to port. Rather than invent a
                // colour, this uses the garden's real accent pair so the badge
                // stays distinct; the gap is recorded in the PR and in
                // docs/claude/platform/mobile/parity.md §4.2.
                if (item.isNew)
                  _Badge("New", tokens.surface2, tokens.accent),
                if (item.kind != null) _Badge(item.kind!, tokens.muted, tokens.mutedForeground),
                if (item.themeLabel != null)
                  _Badge(item.themeLabel!, tokens.muted, tokens.mutedForeground),
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
                  // Destructive — Material's semantic `error`, matching the
                  // web's `variant="destructive"` on the same button. globals.css
                  // defines no destructive token either.
                  style: FilledButton.styleFrom(
                    backgroundColor: Theme.of(context).colorScheme.error,
                    foregroundColor: Theme.of(context).colorScheme.onError,
                  ),
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
