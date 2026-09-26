import "package:flutter/material.dart";
import "package:flutter_riverpod/flutter_riverpod.dart";
import "package:go_router/go_router.dart";

import "core/auth/auth_controller.dart";
import "features/auth/sign_in_screen.dart";
import "features/bookmarks/bookmarks_screen.dart";
import "features/bookmarks/reader_screen.dart";
import "features/capture/capture_screen.dart";
import "features/inbox/inbox_screen.dart";
import "features/journal/journal_entry_screen.dart";
import "features/journal/journal_list_screen.dart";
import "features/notes/note_editor_screen.dart";
import "features/notes/notes_list_screen.dart";
import "features/review/review_screen.dart";
import "features/search/search_screen.dart";
import "features/settings/settings_screen.dart";
import "features/shell/app_shell.dart";
import "features/today/today_screen.dart";
import "features/voice/voice_memo_screen.dart";

/// Deep-linkable routes for the v2 surface (capture/inbox/review/notes/journal/
/// bookmarks/search/settings + offline sync). v1-only screens (chat, graph,
/// projects, typed objects, queue, history, import, billing, admin, dashboard,
/// calendar, kind surfaces) were deleted with their backend routes.
final routerProvider = Provider<GoRouter>((Ref ref) {
  return GoRouter(
    initialLocation: "/app/today",
    refreshListenable: _AuthListenable(ref),
    redirect: (BuildContext context, GoRouterState state) {
      final AuthPhase phase = ref.read(authControllerProvider).phase;
      final bool atSignIn = state.matchedLocation == "/sign-in";
      if (phase == AuthPhase.unknown) return null;
      if (phase == AuthPhase.signedOut) return atSignIn ? null : "/sign-in";
      if (atSignIn) return "/app/today";
      return null;
    },
    routes: <RouteBase>[
      GoRoute(
        path: "/sign-in",
        builder: (BuildContext c, GoRouterState s) => const SignInScreen(),
      ),
      ShellRoute(
        builder: (BuildContext c, GoRouterState s, Widget child) =>
            AppShell(location: s.matchedLocation, child: child),
        routes: <RouteBase>[
          // Today group
          GoRoute(path: "/app/today", builder: (_, __) => const TodayScreen()),
          GoRoute(
            path: "/app/journal",
            builder: (_, __) => const JournalListScreen(),
          ),
          GoRoute(
            path: "/app/journal/today",
            redirect: (_, __) =>
                "/app/journal/${JournalListScreen.todayDate()}",
          ),
          GoRoute(
            path: "/app/journal/:date",
            builder: (BuildContext c, GoRouterState s) =>
                JournalEntryScreen(date: s.pathParameters["date"] ?? ""),
          ),
          GoRoute(
            path: "/app/inbox",
            builder: (_, __) => const InboxScreen(),
          ),
          GoRoute(
            path: "/app/review",
            builder: (_, __) => const ReviewScreen(),
          ),
          // Library group
          GoRoute(
            path: "/app/notes",
            builder: (_, __) => const NotesListScreen(),
          ),
          GoRoute(
            path: "/app/notes/:id",
            builder: (BuildContext c, GoRouterState s) =>
                NoteEditorScreen(noteId: s.pathParameters["id"] ?? ""),
          ),
          GoRoute(
            path: "/app/bookmarks",
            builder: (_, __) => const BookmarksScreen(),
          ),
          GoRoute(
            path: "/app/bookmarks/:id/reader",
            builder: (BuildContext c, GoRouterState s) =>
                ReaderScreen(captureId: s.pathParameters["id"] ?? ""),
          ),
          GoRoute(
            path: "/app/settings",
            builder: (_, __) => const SettingsScreen(),
          ),
          // Capture (bottom-nav tab; also a global action)
          GoRoute(
            path: "/app/capture",
            builder: (_, __) => const CaptureScreen(),
          ),
          GoRoute(
            path: "/app/voice-memo",
            builder: (_, __) => const VoiceMemoScreen(),
          ),
          GoRoute(
            path: "/app/search",
            builder: (_, __) => const SearchScreen(),
          ),
        ],
      ),
    ],
  );
});

class _AuthListenable extends ChangeNotifier {
  _AuthListenable(Ref ref) {
    ref.listen(authControllerProvider, (_, __) => notifyListeners());
  }
}
