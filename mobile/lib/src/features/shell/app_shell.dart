import "package:flutter/material.dart";
import "package:flutter_riverpod/flutter_riverpod.dart";
import "package:go_router/go_router.dart";

import "../../app.dart";
import "../../core/auth/auth_controller.dart";
import "../../core/providers.dart";
import "../../core/workspace_providers.dart";
import "../../theme/app_theme.dart";
import "../capture/quick_capture_sheet.dart";

/// App chrome: hamburger AppBar + slide-in sidebar drawer (grouped nav, web
/// parity §0) + fixed bottom tab bar (Today / Notes / Capture / Bookmarks /
/// Search, parity mobile-bottom-nav.tsx). Kicks a sync on mount and whenever
/// connectivity returns.
class AppShell extends ConsumerStatefulWidget {
  const AppShell({required this.location, required this.child, super.key});

  final String location;
  final Widget child;

  @override
  ConsumerState<AppShell> createState() => _AppShellState();
}

class _AppShellState extends ConsumerState<AppShell> {
  bool _wasOnline = true;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _kickSync());
  }

  Future<void> _kickSync() async {
    await ref.read(syncEngineProvider).sync();
    if (mounted) {
      ref.read(mirrorRevisionProvider.notifier).state++;
    }
  }

  static const List<_Tab> _tabs = <_Tab>[
    _Tab("/app/today", Icons.today_outlined, Icons.today, "Today"),
    _Tab("/app/notes", Icons.notes_outlined, Icons.notes, "Notes"),
    _Tab("/app/capture", Icons.add_circle_outline, Icons.add_circle, "Capture"),
    _Tab("/app/bookmarks", Icons.bookmark_outline, Icons.bookmark, "Bookmarks"),
    _Tab("/app/search", Icons.search_outlined, Icons.search, "Search"),
  ];

  int get _currentIndex {
    final int i =
        _tabs.indexWhere((_Tab t) => widget.location.startsWith(t.path));
    return i < 0 ? 0 : i;
  }

  @override
  Widget build(BuildContext context) {
    // Sync when connectivity transitions offline → online.
    ref.listen<AsyncValue<bool>>(connectivityProvider, (_, next) {
      final bool online = next.valueOrNull ?? true;
      if (online && !_wasOnline) _kickSync();
      _wasOnline = online;
    });

    return Scaffold(
      drawer: const _SidebarDrawer(),
      appBar: AppBar(
        title: const _BrandMark(),
        actions: <Widget>[
          const _SyncIndicator(),
          IconButton(
            icon: const Icon(Icons.add),
            tooltip: "Quick capture",
            onPressed: () => showQuickCapture(context),
          ),
          IconButton(
            icon: const Icon(Icons.search),
            onPressed: () => context.go("/app/search"),
          ),
        ],
      ),
      body: widget.child,
      bottomNavigationBar: NavigationBar(
        selectedIndex: _currentIndex,
        onDestinationSelected: (int i) => context.go(_tabs[i].path),
        destinations: _tabs
            .map((_Tab t) => NavigationDestination(
                  icon: Icon(t.icon),
                  selectedIcon: Icon(t.activeIcon),
                  label: t.label,
                ))
            .toList(),
      ),
    );
  }
}

class _Tab {
  const _Tab(this.path, this.icon, this.activeIcon, this.label);
  final String path;
  final IconData icon;
  final IconData activeIcon;
  final String label;
}

class _BrandMark extends StatelessWidget {
  const _BrandMark();

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        const Text("_",
            style: TextStyle(
                fontSize: 22, fontWeight: FontWeight.w800, color: kCopper)),
        Text("nexalog",
            style: Theme.of(context)
                .textTheme
                .titleLarge
                ?.copyWith(fontWeight: FontWeight.w700)),
      ],
    );
  }
}

class _SyncIndicator extends ConsumerWidget {
  const _SyncIndicator();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final bool online = ref.watch(connectivityProvider).valueOrNull ?? true;
    final int pending = ref.watch(pendingMutationCountProvider).valueOrNull ?? 0;
    if (online && pending == 0) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: Center(
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Icon(online ? Icons.sync : Icons.cloud_off,
                size: 18, color: Theme.of(context).colorScheme.outline),
            if (pending > 0) ...<Widget>[
              const SizedBox(width: 4),
              Text("$pending",
                  style: Theme.of(context).textTheme.labelSmall),
            ],
          ],
        ),
      ),
    );
  }
}

class _SidebarDrawer extends ConsumerWidget {
  const _SidebarDrawer();

  static const List<_NavGroup> _groups = <_NavGroup>[
    _NavGroup("Today", <_NavItem>[
      _NavItem("/app/today", Icons.today_outlined, "Today"),
      _NavItem("/app/journal", Icons.book_outlined, "Journal"),
      _NavItem("/app/inbox", Icons.inbox_outlined, "Inbox"),
      _NavItem("/app/review", Icons.replay_outlined, "Review"),
    ]),
    _NavGroup("Capture", <_NavItem>[
      _NavItem("/app/capture", Icons.add_circle_outline, "Quick capture"),
      _NavItem("/app/voice-memo", Icons.mic_none, "Voice memo"),
    ]),
    _NavGroup("Library", <_NavItem>[
      _NavItem("/app/notes", Icons.notes_outlined, "Notes"),
      _NavItem("/app/bookmarks", Icons.bookmark_outlined, "Bookmarks"),
    ]),
    _NavGroup("Workspace", <_NavItem>[
      _NavItem("/app/settings", Icons.settings_outlined, "Settings"),
    ]),
  ];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final String location = GoRouterState.of(context).matchedLocation;
    final String? email = ref.watch(authControllerProvider).email;
    final ThemeMode mode = ref.watch(themeModeProvider);
    return Drawer(
      child: SafeArea(
        child: Column(
          children: <Widget>[
            const Padding(
              padding: EdgeInsets.fromLTRB(16, 16, 16, 8),
              child: Align(
                  alignment: Alignment.centerLeft, child: _BrandMark()),
            ),
            const _WorkspaceSwitcher(),
            Expanded(
              child: ListView(
                padding: EdgeInsets.zero,
                children: <Widget>[
                  for (final _NavGroup g in _groups) ...<Widget>[
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 14, 16, 4),
                      child: Text(g.label.toUpperCase(),
                          style: Theme.of(context)
                              .textTheme
                              .labelSmall
                              ?.copyWith(
                                  letterSpacing: 0.8,
                                  color:
                                      Theme.of(context).colorScheme.outline)),
                    ),
                    for (final _NavItem it in g.items)
                      ListTile(
                        dense: true,
                        leading: Icon(it.icon, size: 20),
                        title: Text(it.label),
                        selected: location == it.path ||
                            location.startsWith("${it.path}/"),
                        selectedTileColor: kCopper.withValues(alpha: 0.12),
                        onTap: () {
                          Navigator.of(context).pop();
                          context.go(it.path);
                        },
                      ),
                  ],
                ],
              ),
            ),
            const Divider(height: 1),
            ListTile(
              leading: Icon(mode == ThemeMode.dark
                  ? Icons.dark_mode
                  : Icons.light_mode),
              title: const Text("Theme"),
              onTap: () => ref.read(themeModeProvider.notifier).state =
                  mode == ThemeMode.dark ? ThemeMode.light : ThemeMode.dark,
            ),
            ListTile(
              leading: const Icon(Icons.logout),
              title: Text(email ?? "Sign out"),
              onTap: () => ref.read(authControllerProvider.notifier).signOut(),
            ),
          ],
        ),
      ),
    );
  }
}

class _WorkspaceSwitcher extends ConsumerWidget {
  const _WorkspaceSwitcher();

  Color _dot(String hex) {
    final String h = hex.replaceFirst("#", "");
    final int? v = int.tryParse(h.length == 6 ? "FF$h" : h, radix: 16);
    return v == null ? kCopper : Color(v);
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final List<Workspace> all =
        ref.watch(workspacesProvider).valueOrNull ?? const <Workspace>[];
    final String? active = ref.watch(activeWorkspaceIdProvider).valueOrNull;
    if (all.length < 2) return const SizedBox.shrink();
    final Workspace current = all.firstWhere(
      (Workspace w) => w.id == active,
      orElse: () => all.first,
    );
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12),
      child: PopupMenuButton<String>(
        onSelected: (String id) => setActiveWorkspace(ref, id),
        itemBuilder: (BuildContext c) => all
            .map((Workspace w) => PopupMenuItem<String>(
                  value: w.id,
                  child: Row(
                    children: <Widget>[
                      CircleAvatar(radius: 6, backgroundColor: _dot(w.color)),
                      const SizedBox(width: 8),
                      Expanded(child: Text(w.name)),
                      if (w.id == active) const Icon(Icons.check, size: 16),
                    ],
                  ),
                ))
            .toList(),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(
            border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Row(
            children: <Widget>[
              CircleAvatar(radius: 6, backgroundColor: _dot(current.color)),
              const SizedBox(width: 8),
              Expanded(
                child: Text(current.name,
                    maxLines: 1, overflow: TextOverflow.ellipsis),
              ),
              const Icon(Icons.unfold_more, size: 18),
            ],
          ),
        ),
      ),
    );
  }
}

class _NavGroup {
  const _NavGroup(this.label, this.items);
  final String label;
  final List<_NavItem> items;
}

class _NavItem {
  const _NavItem(this.path, this.icon, this.label);
  final String path;
  final IconData icon;
  final String label;
}
