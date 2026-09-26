// SPDX-License-Identifier: MIT
//
// Capture review screen — mobile parity for the web `/inbox` operator surface.
//
// On web the operator sees the worker's `nexalog.proposal` inline on each row
// and decides accept / reject (`app/inbox/review-actions.tsx`). Nothing of that
// existed on mobile: the app had no capture concept at all, so a capture the
// worker escalated to `status: review` could only be resolved from a browser.
// This screen lists exactly those captures and carries the same decision.
//
// House rule mirrored from web: **reject is two-step** — a destructive action
// never fires on a single tap. On web the button arms and the second click
// fires; on mobile the second step is a confirm dialog, which is the platform's
// idiom for the same guarantee (and is what a tap target that cannot hover
// needs anyway).
//
// Accept and reject are BOTH shown on a review row. Accept is the primary
// action (the pages the worker already committed are kept); reject carries the
// destructive treatment.

import "package:flutter/material.dart";
import "package:flutter_riverpod/flutter_riverpod.dart";

import "../../core/providers.dart";
import "capture_review_models.dart";
import "capture_review_repo.dart";

class CaptureReviewScreen extends ConsumerStatefulWidget {
  const CaptureReviewScreen({super.key});

  @override
  ConsumerState<CaptureReviewScreen> createState() => _CaptureReviewScreenState();
}

class _CaptureReviewScreenState extends ConsumerState<CaptureReviewScreen> {
  /// Capture ids with a decision in flight — the row's buttons disable, but the
  /// rest of the list stays usable.
  final Set<String> _pending = <String>{};

  /// Inline per-row failure, keyed by capture id. Never a silent no-op: the row
  /// says what the server said (`.claude/rules/error-handling.md`).
  final Map<String, String> _errors = <String, String>{};

  /// Rows the operator just resolved, so the list can show the outcome before
  /// the refetch lands.
  final Map<String, String> _resolved = <String, String>{};

  Future<void> _decide(CaptureItem item, bool accept) async {
    if (_pending.contains(item.id)) return;
    setState(() {
      _pending.add(item.id);
      _errors.remove(item.id);
    });
    try {
      final CaptureDecision decision = await ref
          .read(captureReviewRepoProvider)
          .decide(captureId: item.id, accept: accept);
      if (!mounted) return;
      setState(() => _resolved[item.id] = decision.status);
      // Refresh the list (and the review count) — the capture is no longer
      // awaiting a decision.
      ref.read(mirrorRevisionProvider.notifier).state++;
      ref.invalidate(reviewCapturesProvider);
    } on CaptureDecisionError catch (e) {
      if (!mounted) return;
      setState(() => _errors[item.id] = e.message);
      if (e.isConflict || e.isNotFound) {
        // The row moved under the operator: refetch so the list shows reality
        // rather than the stale row they tried to decide.
        ref.invalidate(reviewCapturesProvider);
      }
    } finally {
      if (mounted) setState(() => _pending.remove(item.id));
    }
  }

  /// The destructive-action guard: reject asks first, in a dialog that names the
  /// capture. Only an explicit confirm returns true.
  Future<bool> _confirmReject(CaptureItem item) async {
    final bool? confirmed = await showDialog<bool>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: const Text("Reject this capture?"),
        content: Text(
          "The pages the worker proposed will be discarded.\n\n"
          "\"${item.title}\"",
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text("Cancel"),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(dialogContext).colorScheme.error,
            ),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text("Reject"),
          ),
        ],
      ),
    );
    return confirmed ?? false;
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<CaptureInboxPage> page =
        ref.watch(reviewCapturesProvider);
    return Scaffold(
      appBar: AppBar(
        title: const Text("Capture review"),
        actions: <Widget>[
          IconButton(
            icon: const Icon(Icons.refresh),
            tooltip: "Refresh",
            onPressed: () => ref.invalidate(reviewCapturesProvider),
          ),
        ],
      ),
      body: page.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (Object e, _) => _LoadFailure(
          error: e,
          onRetry: () => ref.invalidate(reviewCapturesProvider),
        ),
        data: (CaptureInboxPage data) {
          final List<CaptureItem> pending = data.captures
              .where((CaptureItem c) => _resolved[c.id] == null)
              .toList(growable: false);
          final int awaiting = pending.length;
          if (awaiting == 0) {
            return RefreshIndicator(
              onRefresh: () async => ref.invalidate(reviewCapturesProvider),
              child: ListView(
                children: <Widget>[
                  const SizedBox(height: 120),
                  Center(
                    child: Icon(Icons.check_circle_outline,
                        size: 56, color: Theme.of(context).colorScheme.primary),
                  ),
                  const SizedBox(height: 16),
                  Center(
                    child: Text(
                      "Nothing awaiting a decision",
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Center(
                    child: Text(
                      "Captures the worker was unsure about land here.",
                      style: TextStyle(color: Theme.of(context).colorScheme.outline),
                    ),
                  ),
                ],
              ),
            );
          }
          return RefreshIndicator(
            onRefresh: () async => ref.invalidate(reviewCapturesProvider),
            child: ListView.separated(
              padding: const EdgeInsets.all(12),
              itemCount: pending.length,
              separatorBuilder: (_, __) => const SizedBox(height: 8),
              itemBuilder: (BuildContext c, int i) {
                final CaptureItem item = pending[i];
                return _ReviewCard(
                  item: item,
                  pending: _pending.contains(item.id),
                  error: _errors[item.id],
                  onAccept: () => _decide(item, true),
                  onReject: () async {
                    if (await _confirmReject(item)) {
                      await _decide(item, false);
                    }
                  },
                );
              },
            ),
          );
        },
      ),
    );
  }
}

class _LoadFailure extends StatelessWidget {
  const _LoadFailure({required this.error, required this.onRetry});

  final Object error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final String message = error is CaptureDecisionError
        ? (error as CaptureDecisionError).message
        : "Could not load captures.";
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            const Icon(Icons.error_outline, size: 48),
            const SizedBox(height: 12),
            Text(message, textAlign: TextAlign.center),
            const SizedBox(height: 16),
            OutlinedButton(onPressed: onRetry, child: const Text("Try again")),
          ],
        ),
      ),
    );
  }
}

/// One capture awaiting a decision: its metadata, the worker's proposal, and
/// the accept / reject controls.
class _ReviewCard extends StatelessWidget {
  const _ReviewCard({
    required this.item,
    required this.pending,
    required this.error,
    required this.onAccept,
    required this.onReject,
  });

  final CaptureItem item;
  final bool pending;
  final String? error;
  final VoidCallback onAccept;
  final VoidCallback onReject;

  @override
  Widget build(BuildContext context) {
    final CaptureProposal? proposal = item.proposal;
    return Card(
      key: ValueKey<String>(item.id),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                Container(
                  width: 8,
                  height: 8,
                  decoration: BoxDecoration(
                    color: Theme.of(context).colorScheme.primary,
                    shape: BoxShape.circle,
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    item.title.isEmpty ? "Untitled capture" : item.title,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.titleSmall,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              <String>[
                item.kind,
                if (item.capturedAt.isNotEmpty) item.capturedAt,
                if (item.hasAttachments) "📎",
              ].join(" · "),
              style: Theme.of(context).textTheme.labelSmall,
            ),
            if (proposal != null && proposal.hasContent) ...<Widget>[
              const SizedBox(height: 10),
              _ProposalBlock(proposal: proposal),
            ],
            const SizedBox(height: 12),
            Row(
              children: <Widget>[
                FilledButton(
                  key: const Key("accept-button"),
                  onPressed: pending ? null : onAccept,
                  child: Text(pending ? "Saving…" : "Accept"),
                ),
                const SizedBox(width: 8),
                OutlinedButton(
                  key: const Key("reject-button"),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: Theme.of(context).colorScheme.error,
                  ),
                  onPressed: pending ? null : onReject,
                  child: const Text("Reject"),
                ),
              ],
            ),
            if (error != null) ...<Widget>[
              const SizedBox(height: 8),
              Text(
                error!,
                key: const Key("decision-error"),
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// The worker's proposal, normalized server-side: summary + confidence, the
/// pages it committed, and the links it drew.
class _ProposalBlock extends StatelessWidget {
  const _ProposalBlock({required this.proposal});

  final CaptureProposal proposal;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final double? confidence = proposal.confidence;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Text(
                "WORKER PROPOSAL",
                style: theme.textTheme.labelSmall?.copyWith(
                  letterSpacing: 0.8,
                  fontWeight: FontWeight.w700,
                ),
              ),
              if (confidence != null) ...<Widget>[
                const SizedBox(width: 8),
                Text(
                  "confidence ${confidence.toStringAsFixed(2)}",
                  style: theme.textTheme.labelSmall,
                ),
              ],
            ],
          ),
          if (proposal.summary != null) ...<Widget>[
            const SizedBox(height: 6),
            Text(proposal.summary!, style: theme.textTheme.bodySmall),
          ],
          if (proposal.pages.isNotEmpty) ...<Widget>[
            const SizedBox(height: 8),
            Wrap(
              spacing: 6,
              runSpacing: 4,
              children: proposal.pages
                  .map((ProposalPage p) => _PageChip(page: p))
                  .toList(growable: false),
            ),
          ],
          if (proposal.links.isNotEmpty) ...<Widget>[
            const SizedBox(height: 8),
            for (final ProposalLink link in proposal.links)
              Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: Wrap(
                  crossAxisAlignment: WrapCrossAlignment.center,
                  spacing: 4,
                  children: <Widget>[
                    _PageChip(page: link.from),
                    const Icon(Icons.arrow_forward, size: 12),
                    _PageChip(page: link.to),
                  ],
                ),
              ),
          ],
        ],
      ),
    );
  }
}

/// One proposal page. Rendered as a plain chip: the mobile app has no Garden
/// surface to link into, so [ProposalPage.href] is shown as supporting detail
/// rather than as a dead tap target.
class _PageChip extends StatelessWidget {
  const _PageChip({required this.page});

  final ProposalPage page;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Tooltip(
      message: page.href == null
          ? page.slug
          : "${page.slug}\n(opens on web: ${page.href})",
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          border: Border.all(color: theme.colorScheme.outlineVariant),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Text(page.label, style: theme.textTheme.labelSmall),
            if (page.typeLabel != null) ...<Widget>[
              const SizedBox(width: 4),
              Text(
                page.typeLabel!,
                style: theme.textTheme.labelSmall?.copyWith(
                  color: theme.colorScheme.outline,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
