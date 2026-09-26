import "package:flutter/material.dart";
import "package:flutter_riverpod/flutter_riverpod.dart";

import "../../app.dart";
import "../../core/auth/auth_controller.dart";
import "../../core/providers.dart";

/// Settings (web parity §19). Profile + theme + sync status + sign-out. The
/// password change, web-history config, and billing sections follow.
class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AuthState auth = ref.watch(authControllerProvider);
    final ThemeMode mode = ref.watch(themeModeProvider);
    final bool online = ref.watch(connectivityProvider).valueOrNull ?? true;
    final int pending =
        ref.watch(pendingMutationCountProvider).valueOrNull ?? 0;
    return ListView(
      children: <Widget>[
        const _Header("Profile"),
        ListTile(
          leading: const Icon(Icons.email_outlined),
          title: const Text("Email"),
          subtitle: Text(auth.email ?? "—"),
        ),
        const _Header("Appearance"),
        SwitchListTile(
          secondary: const Icon(Icons.dark_mode_outlined),
          title: const Text("Dark mode"),
          value: mode == ThemeMode.dark,
          onChanged: (bool v) => ref.read(themeModeProvider.notifier).state =
              v ? ThemeMode.dark : ThemeMode.light,
        ),
        const _Header("Sync"),
        ListTile(
          leading: Icon(online ? Icons.cloud_done_outlined : Icons.cloud_off),
          title: Text(online ? "Online" : "Offline"),
          subtitle: Text(pending == 0
              ? "All changes synced"
              : "$pending change(s) pending"),
        ),
        const Divider(),
        ListTile(
          leading: const Icon(Icons.logout),
          title: const Text("Sign out"),
          onTap: () => ref.read(authControllerProvider.notifier).signOut(),
        ),
      ],
    );
  }
}

class _Header extends StatelessWidget {
  const _Header(this.label);
  final String label;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 20, 16, 6),
      child: Text(label.toUpperCase(),
          style: Theme.of(context).textTheme.labelSmall),
    );
  }
}
