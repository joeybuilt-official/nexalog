// SPDX-License-Identifier: MIT
//
// ProjectsScreen render tests.
//
// These exercise the SCREEN, not the rules — the rules have their own suite in
// `project_browse_test.dart`. What a widget test can prove that a pure test
// cannot: that the screen actually renders a sub-project under its parent, that
// it dims and labels a context row (the A1.7 "never hide a matching child"
// guarantee, made visible), that the search box drives the list, and that an
// empty mirror explains itself instead of implying the projects are gone.
//
// `projectsListProvider` is overridden rather than backed by sqflite: it is the
// mirror read, and no sqflite exists in the Flutter test environment (the same
// reason `today_screen_test.dart` overrides `notesListProvider`).

import "package:flutter/material.dart";
import "package:flutter_riverpod/flutter_riverpod.dart";
import "package:flutter_test/flutter_test.dart";
import "package:nexalog_mobile/src/features/projects/project_providers.dart";
import "package:nexalog_mobile/src/features/projects/projects_screen.dart";

Project _project({
  required String id,
  required String name,
  String? description,
  String lifecycleState = "active",
  String? parentId,
  int itemCount = 0,
  int subProjectCount = 0,
  String? updatedAt = "2026-01-02T00:00:00.000Z",
}) {
  return Project(<String, Object?>{
    "id": id,
    "workspaceId": "ws-1",
    "name": name,
    "description": description,
    "lifecycleState": lifecycleState,
    "parentId": parentId,
    "itemCount": itemCount,
    "subProjectCount": subProjectCount,
    "updatedAt": updatedAt,
  });
}

List<Project> _fixture() => <Project>[
      _project(
        id: "10-ton",
        name: "10 Ton",
        description: "Heavy fabrication studio.",
        subProjectCount: 1,
      ),
      _project(
        id: "frame-forge",
        name: "Frame Forge",
        description: "Bike frame jig.",
        parentId: "10-ton",
      ),
      _project(
        id: "full-on",
        name: "Full-On Pictures",
        description: "Influencer CRM, originally Angel Studios.",
        subProjectCount: 1,
      ),
      _project(
        id: "learning-curve",
        name: "Learning Curve",
        description: "Tutorial pipeline.",
        parentId: "full-on",
      ),
    ];

Future<void> _pump(WidgetTester tester, List<Project> projects) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: <Override>[
        projectsListProvider.overrideWith((Ref ref) async => projects),
      ],
      child: const MaterialApp(home: ProjectsScreen()),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets("renders roots and their sub-projects as children", (WidgetTester tester) async {
    await _pump(tester, _fixture());

    expect(find.text("10 Ton"), findsOneWidget);
    expect(find.text("Frame Forge"), findsOneWidget);
    expect(find.text("Full-On Pictures"), findsOneWidget);
    expect(find.text("Learning Curve"), findsOneWidget);
  });

  testWidgets("keeps a matching sub-project visible when its parent does not match",
      (WidgetTester tester) async {
    await _pump(tester, _fixture());

    await tester.enterText(find.byKey(const Key("projects-search")), "learning curve");
    await tester.pumpAndSettle();

    // The child matches; the parent renders as context, dimmed and labelled.
    expect(find.text("Learning Curve"), findsOneWidget);
    expect(find.text("Full-On Pictures"), findsOneWidget);
    expect(find.text("Shown because a sub-project matches."), findsOneWidget);
    // The other root and its child are gone.
    expect(find.text("10 Ton"), findsNothing);
    expect(find.text("Frame Forge"), findsNothing);
  });

  testWidgets("search matches the description as well as the name", (WidgetTester tester) async {
    await _pump(tester, _fixture());

    await tester.enterText(find.byKey(const Key("projects-search")), "angel studios");
    await tester.pumpAndSettle();

    expect(find.text("Full-On Pictures"), findsOneWidget);
    expect(find.text("10 Ton"), findsNothing);
  });

  testWidgets("a lifecycle filter narrows the roots", (WidgetTester tester) async {
    final List<Project> projects = <Project>[
      _project(id: "active-1", name: "Active One", lifecycleState: "active"),
      _project(id: "draft-1", name: "Draft One", lifecycleState: "draft"),
    ];
    await _pump(tester, projects);

    expect(find.text("Active One"), findsOneWidget);
    expect(find.text("Draft One"), findsOneWidget);

    await tester.tap(find.byKey(const Key("projects-lifecycle-draft")));
    await tester.pumpAndSettle();

    expect(find.text("Draft One"), findsOneWidget);
    expect(find.text("Active One"), findsNothing);
  });

  testWidgets("the has-sub-projects toggle keeps parents that have one", (WidgetTester tester) async {
    await _pump(tester, _fixture());

    await tester.tap(find.byKey(const Key("projects-has-sub-projects")));
    await tester.pumpAndSettle();

    // Both fixture roots have a sub-project, so both survive; the children do too.
    expect(find.text("10 Ton"), findsOneWidget);
    expect(find.text("Full-On Pictures"), findsOneWidget);
    expect(find.text("Frame Forge"), findsOneWidget);
    expect(find.text("Learning Curve"), findsOneWidget);
  });

  testWidgets("collapsing a root hides its children, and a context row is never collapsible",
      (WidgetTester tester) async {
    await _pump(tester, _fixture());

    expect(find.text("Frame Forge"), findsOneWidget);
    await tester.tap(find.byKey(const Key("projects-disclosure-10-ton")));
    await tester.pumpAndSettle();
    expect(find.text("Frame Forge"), findsNothing);
    expect(find.text("10 Ton"), findsOneWidget);

    // A context row carries no disclosure control at all — collapsing it would
    // hide the row the reader searched for.
    await tester.enterText(find.byKey(const Key("projects-search")), "learning curve");
    await tester.pumpAndSettle();
    expect(find.byKey(const Key("projects-disclosure-full-on")), findsNothing);
    expect(find.text("Learning Curve"), findsOneWidget);
  });

  testWidgets("an empty mirror explains itself rather than reading as data loss",
      (WidgetTester tester) async {
    await _pump(tester, <Project>[]);

    expect(find.byKey(const Key("projects-empty")), findsOneWidget);
    expect(find.text("No projects on this device"), findsOneWidget);
  });

  testWidgets("a search that matches nothing offers a reset, not a bare empty list",
      (WidgetTester tester) async {
    await _pump(tester, _fixture());

    await tester.enterText(find.byKey(const Key("projects-search")), "zzz no such project");
    await tester.pumpAndSettle();

    expect(find.text("No projects match"), findsOneWidget);
    expect(find.text("Reset controls"), findsOneWidget);

    await tester.tap(find.text("Reset controls"));
    await tester.pumpAndSettle();
    expect(find.text("10 Ton"), findsOneWidget);
  });
}
