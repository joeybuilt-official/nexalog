import "dart:async";

import "package:flutter/material.dart";
import "package:flutter_html/flutter_html.dart";
import "package:flutter_riverpod/flutter_riverpod.dart";
import "package:go_router/go_router.dart";
import "package:url_launcher/url_launcher.dart";

import "../../core/api/api_client.dart";
import "../../core/offline/offline_repo.dart";
import "../../core/providers.dart";
import "../../core/richtext/html_doc.dart";
import "notes_providers.dart";
import "wysiwyg_note_editor.dart";

/// Note content is HTML on the server (web Tiptap). We render it faithfully with
/// flutter_html in read mode and edit the raw body in edit mode, so a formatted
/// web note is never silently flattened. New / plain notes open straight in edit.
bool _looksLikeHtml(String s) => RegExp(r"<[a-zA-Z!/][^>]*>").hasMatch(s);

/// Note editor (web parity §4): title + body with debounced autosave (1s) and a
/// confirm-twice delete. Edits queue offline and replay on reconnect. The full
/// Tiptap rich-text parity (wikilinks, slash menu, backlinks) is tracked
/// separately; this renders + saves the stored note body faithfully as text.
class NoteEditorScreen extends ConsumerStatefulWidget {
  const NoteEditorScreen({required this.noteId, super.key});

  final String noteId;

  @override
  ConsumerState<NoteEditorScreen> createState() => _NoteEditorScreenState();
}

class _NoteEditorScreenState extends ConsumerState<NoteEditorScreen> {
  final TextEditingController _title = TextEditingController();
  final TextEditingController _content = TextEditingController();
  Timer? _debounce;
  bool _loaded = false;
  bool _saving = false;
  bool _confirmDelete = false;
  bool _editing = false;
  bool _canWysiwyg = true;
  bool _rawMode = false;
  int _wysSeq = 0;

  // Wikilink [[ autocomplete state.
  Timer? _wikiDebounce;
  int? _wikiStart;
  List<Map<String, Object?>> _wikiResults = const <Map<String, Object?>>[];

  @override
  void dispose() {
    _debounce?.cancel();
    _wikiDebounce?.cancel();
    _title.dispose();
    _content.dispose();
    super.dispose();
  }

  void _onChanged() {
    _debounce?.cancel();
    _debounce = Timer(const Duration(seconds: 1), _save);
    _detectWiki();
  }

  /// Detects an open `[[query` token left of the caret and drives the wikilink
  /// picker (web parity §4). Closes once the token is completed or removed.
  void _detectWiki() {
    final TextEditingValue v = _content.value;
    final int caret = v.selection.baseOffset;
    final String text = v.text;
    if (caret < 0 || caret > text.length) {
      _closeWiki();
      return;
    }
    final String left = text.substring(0, caret);
    final int open = left.lastIndexOf("[[");
    if (open < 0 || left.indexOf("]]", open) >= 0) {
      _closeWiki();
      return;
    }
    final String query = left.substring(open + 2);
    if (query.contains("\n") || query.contains("[")) {
      _closeWiki();
      return;
    }
    _wikiStart = open;
    _wikiDebounce?.cancel();
    _wikiDebounce = Timer(const Duration(milliseconds: 250), () => _wikiSearch(query));
  }

  Future<void> _wikiSearch(String query) async {
    final ApiClient api = ref.read(apiClientProvider);
    try {
      final dynamic res = await api.get<dynamic>("/api/notes/search",
          query: <String, Object?>{"q": query, "limit": 8});
      final Map<String, Object?> body = res.data is Map
          ? Map<String, Object?>.from(res.data as Map)
          : <String, Object?>{};
      final List<Object?> notes = (body["notes"] as List<Object?>?) ?? const [];
      if (!mounted) return;
      setState(() => _wikiResults = notes
          .map((Object? e) => Map<String, Object?>.from(e as Map))
          .where((Map<String, Object?> n) => n["id"] != widget.noteId)
          .toList());
    } catch (_) {
      if (mounted) setState(() => _wikiResults = const <Map<String, Object?>>[]);
    }
  }

  void _closeWiki() {
    _wikiDebounce?.cancel();
    if (_wikiStart != null || _wikiResults.isNotEmpty) {
      setState(() {
        _wikiStart = null;
        _wikiResults = const <Map<String, Object?>>[];
      });
    }
  }

  /// Inserts the same anchor markup the web Tiptap wikilink node serializes to,
  /// so the link round-trips and resolves on web + server.
  void _insertWiki(Map<String, Object?> note) {
    final int? start = _wikiStart;
    if (start == null) return;
    final String id = note["id"]?.toString() ?? "";
    final String label = (note["title"]?.toString().trim().isNotEmpty == true)
        ? note["title"].toString()
        : "Untitled";
    final TextEditingValue v = _content.value;
    final int caret = v.selection.baseOffset.clamp(0, v.text.length);
    final String anchor =
        '<a data-wikilink href="/app/notes/$id" class="wikilink text-blue-500 underline cursor-pointer">[[$label]]</a> ';
    final String next =
        v.text.substring(0, start) + anchor + v.text.substring(caret);
    _content.value = TextEditingValue(
      text: next,
      selection: TextSelection.collapsed(offset: start + anchor.length),
    );
    _closeWiki();
    _onChanged();
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    await ref.read(offlineRepoProvider).update(
      "notes",
      id: widget.noteId,
      payload: <String, Object?>{
        "title": _title.text,
        "content": _content.text,
      },
      optimisticRow: <String, Object?>{
        "title": _title.text,
        "content": _content.text,
      },
    );
    if (mounted) setState(() => _saving = false);
  }

  void _showBacklinks(BuildContext context) {
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (BuildContext c) => Consumer(
        builder: (BuildContext c, WidgetRef r, _) {
          final List<Map<String, Object?>> backlinks =
              r.watch(backlinksProvider(widget.noteId)).valueOrNull ?? const [];
          final List<Map<String, Object?>> mentions =
              r.watch(unlinkedMentionsProvider(widget.noteId)).valueOrNull ??
                  const [];
          return DraggableScrollableSheet(
            expand: false,
            initialChildSize: 0.5,
            maxChildSize: 0.85,
            builder: (BuildContext c, ScrollController sc) => ListView(
              controller: sc,
              children: <Widget>[
                const ListTile(title: Text("Notes that link here")),
                if (backlinks.isEmpty)
                  const ListTile(subtitle: Text("No backlinks yet")),
                ...backlinks.map((Map<String, Object?> n) => ListTile(
                      leading: const Icon(Icons.north_east),
                      title: Text(_titleOf(n)),
                      onTap: () {
                        Navigator.of(c).pop();
                        context.go("/app/notes/${n["id"]}");
                      },
                    )),
                if (mentions.isNotEmpty) ...<Widget>[
                  const Divider(),
                  const ListTile(title: Text("Suggested links")),
                  ...mentions.map((Map<String, Object?> n) => ListTile(
                        leading: const Icon(Icons.lightbulb_outline),
                        title: Text(_titleOf(n)),
                        trailing: TextButton(
                          onPressed: () => linkNote(
                              r, widget.noteId, n["id"]?.toString() ?? ""),
                          child: const Text("Link"),
                        ),
                        onTap: () {
                          Navigator.of(c).pop();
                          context.go("/app/notes/${n["id"]}");
                        },
                      )),
                ],
              ],
            ),
          );
        },
      ),
    );
  }

  void _showHistory(BuildContext context) {
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (BuildContext c) => Consumer(
        builder: (BuildContext c, WidgetRef r, _) {
          final AsyncValue<List<Map<String, Object?>>> snaps =
              r.watch(snapshotsProvider(widget.noteId));
          return snaps.when(
            loading: () => const Padding(
              padding: EdgeInsets.all(24),
              child: Center(child: CircularProgressIndicator()),
            ),
            error: (Object e, _) =>
                Padding(padding: const EdgeInsets.all(24), child: Text("Error: $e")),
            data: (List<Map<String, Object?>> rows) => DraggableScrollableSheet(
              expand: false,
              initialChildSize: 0.5,
              maxChildSize: 0.85,
              builder: (BuildContext c, ScrollController sc) => ListView(
                controller: sc,
                children: <Widget>[
                  const ListTile(title: Text("Version history")),
                  if (rows.isEmpty)
                    const ListTile(subtitle: Text("No snapshots yet")),
                  ...rows.map((Map<String, Object?> s) {
                    final String body = (s["content"]?.toString() ?? "")
                        .replaceAll(RegExp(r"<[^>]+>"), " ")
                        .trim();
                    return ListTile(
                      leading: const Icon(Icons.history),
                      title: Text(_fmtTs(s["createdAt"]?.toString())),
                      subtitle: Text(body,
                          maxLines: 2, overflow: TextOverflow.ellipsis),
                    );
                  }),
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _readView() => SingleChildScrollView(
        child: Html(
          data: _content.text.trim().isEmpty
              ? "<p><em>Empty note</em></p>"
              : _content.text,
          onLinkTap: (String? url, _, __) {
            if (url != null) {
              launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
            }
          },
        ),
      );

  Widget _fmtBtn(IconData icon, String tip, VoidCallback onTap) => IconButton(
        icon: Icon(icon, size: 20),
        tooltip: tip,
        visualDensity: VisualDensity.compact,
        onPressed: onTap,
      );

  String _titleOf(Map<String, Object?> n) =>
      n["title"]?.toString().trim().isNotEmpty == true
          ? n["title"].toString()
          : "Untitled";

  String _fmtTs(String? iso) {
    if (iso == null) return "";
    final DateTime? d = DateTime.tryParse(iso);
    return d == null ? iso : d.toLocal().toString().split(".").first;
  }

  Future<void> _delete() async {
    if (!_confirmDelete) {
      setState(() => _confirmDelete = true);
      return;
    }
    await ref.read(offlineRepoProvider).delete("notes", id: widget.noteId);
    if (mounted) context.go("/app/notes");
  }

  // --- Rich-text formatting (web parity §4) -----------------------------
  // Notes are stored as HTML (web Tiptap). The toolbar wraps/inserts the same
  // tags Tiptap serializes, so edits round-trip losslessly and render via
  // flutter_html in read mode — a WYSIWYG-authoring assist over real HTML.

  /// Wraps the current selection (or inserts an empty pair at the caret) with
  /// [open]/[close] and keeps the caret sensibly placed.
  void _wrap(String open, String close) {
    final TextEditingValue v = _content.value;
    final TextSelection sel = v.selection;
    final int start = sel.isValid ? sel.start : v.text.length;
    final int end = sel.isValid ? sel.end : v.text.length;
    final String selected = v.text.substring(start, end);
    final String inserted = "$open$selected$close";
    final String next = v.text.replaceRange(start, end, inserted);
    final int caret =
        selected.isEmpty ? start + open.length : start + inserted.length;
    _content.value = TextEditingValue(
      text: next,
      selection: TextSelection.collapsed(offset: caret),
    );
    _onChanged();
  }

  void _insertBlock(String html) {
    final TextEditingValue v = _content.value;
    final int at = v.selection.isValid ? v.selection.end : v.text.length;
    final String next = v.text.replaceRange(at, at, html);
    _content.value = TextEditingValue(
      text: next,
      selection: TextSelection.collapsed(offset: at + html.length),
    );
    _onChanged();
  }

  Future<void> _insertLink() async {
    final TextEditingValue v = _content.value;
    final TextSelection sel = v.selection;
    final String selected =
        sel.isValid ? v.text.substring(sel.start, sel.end) : "";
    final TextEditingController urlC = TextEditingController();
    final TextEditingController textC =
        TextEditingController(text: selected);
    final bool? ok = await showDialog<bool>(
      context: context,
      builder: (BuildContext c) => AlertDialog(
        title: const Text("Insert link"),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            TextField(
              controller: textC,
              decoration: const InputDecoration(labelText: "Text"),
            ),
            TextField(
              controller: urlC,
              autofocus: true,
              decoration: const InputDecoration(labelText: "URL (https://…)"),
            ),
          ],
        ),
        actions: <Widget>[
          TextButton(
              onPressed: () => Navigator.of(c).pop(false),
              child: const Text("Cancel")),
          FilledButton(
              onPressed: () => Navigator.of(c).pop(true),
              child: const Text("Insert")),
        ],
      ),
    );
    if (ok != true) return;
    final String url = urlC.text.trim();
    if (url.isEmpty) return;
    final String label = textC.text.trim().isEmpty ? url : textC.text.trim();
    final String anchor = '<a href="$url">$label</a>';
    final int start = sel.isValid ? sel.start : v.text.length;
    final int end = sel.isValid ? sel.end : v.text.length;
    final String next = v.text.replaceRange(start, end, anchor);
    _content.value = TextEditingValue(
      text: next,
      selection: TextSelection.collapsed(offset: start + anchor.length),
    );
    _onChanged();
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<Note?> note = ref.watch(noteByIdProvider(widget.noteId));
    return note.when(
      loading: () => const Scaffold(
          body: Center(child: CircularProgressIndicator())),
      error: (Object e, _) =>
          Scaffold(body: Center(child: Text("Error: $e"))),
      data: (Note? n) {
        if (n == null) {
          return Scaffold(
            appBar: AppBar(),
            body: const Center(child: Text("Note not found")),
          );
        }
        if (!_loaded) {
          _title.text = n.title;
          _content.text = n.content;
          // Open in read mode when the note already has formatted HTML; new or
          // plain notes go straight to editing.
          _editing = !(n.content.trim().isNotEmpty && _looksLikeHtml(n.content));
          _canWysiwyg = isHtmlEditableWysiwyg(n.content);
          _loaded = true;
        }
        return Scaffold(
          appBar: AppBar(
            leading: IconButton(
              icon: const Icon(Icons.arrow_back),
              onPressed: () => context.go("/app/notes"),
            ),
            title: _saving
                ? const Text("Saving…",
                    style: TextStyle(fontSize: 13, fontWeight: FontWeight.w400))
                : const Text("Note",
                    style: TextStyle(fontSize: 16)),
            actions: <Widget>[
              IconButton(
                icon: Icon(_editing ? Icons.visibility : Icons.edit),
                tooltip: _editing ? "Read" : "Edit",
                onPressed: () => setState(() => _editing = !_editing),
              ),
              if (_editing && _canWysiwyg)
                IconButton(
                  icon: Icon(_rawMode ? Icons.text_fields : Icons.code),
                  tooltip: _rawMode ? "Formatted editor" : "HTML source",
                  onPressed: () => setState(() {
                    _rawMode = !_rawMode;
                    _wysSeq++;
                  }),
                ),
              IconButton(
                icon: const Icon(Icons.link),
                tooltip: "Links",
                onPressed: () => _showBacklinks(context),
              ),
              IconButton(
                icon: const Icon(Icons.history),
                tooltip: "History",
                onPressed: () => _showHistory(context),
              ),
              TextButton.icon(
                onPressed: _delete,
                icon: Icon(Icons.delete_outline,
                    color: Theme.of(context).colorScheme.error),
                label: Text(_confirmDelete ? "Confirm" : "Delete",
                    style:
                        TextStyle(color: Theme.of(context).colorScheme.error)),
              ),
            ],
          ),
          body: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                TextField(
                  controller: _title,
                  style: Theme.of(context).textTheme.headlineSmall,
                  decoration: const InputDecoration(
                    hintText: "Title",
                    border: InputBorder.none,
                  ),
                  onChanged: (_) => _onChanged(),
                ),
                _TagsRow(noteId: widget.noteId),
                const SizedBox(height: 8),
                if (_editing && (_rawMode || !_canWysiwyg))
                  SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    child: Row(
                      children: <Widget>[
                        _fmtBtn(Icons.format_bold, "Bold",
                            () => _wrap("<strong>", "</strong>")),
                        _fmtBtn(Icons.format_italic, "Italic",
                            () => _wrap("<em>", "</em>")),
                        _fmtBtn(Icons.format_underlined, "Underline",
                            () => _wrap("<u>", "</u>")),
                        _fmtBtn(Icons.title, "Heading",
                            () => _wrap("<h2>", "</h2>")),
                        _fmtBtn(Icons.format_quote, "Quote",
                            () => _wrap("<blockquote>", "</blockquote>")),
                        _fmtBtn(Icons.format_list_bulleted, "Bulleted list",
                            () => _insertBlock("<ul><li></li></ul>")),
                        _fmtBtn(Icons.format_list_numbered, "Numbered list",
                            () => _insertBlock("<ol><li></li></ol>")),
                        _fmtBtn(Icons.code, "Inline code",
                            () => _wrap("<code>", "</code>")),
                        _fmtBtn(Icons.link, "Link", _insertLink),
                      ],
                    ),
                  ),
                Expanded(
                  child: !_editing
                      ? _readView()
                      : (_canWysiwyg && !_rawMode)
                          ? WysiwygNoteEditor(
                              key: ValueKey<String>("wys-${widget.noteId}-$_wysSeq"),
                              initialHtml: _content.text,
                              onChanged: (String html) {
                                _content.text = html;
                                _onChanged();
                              },
                              apiClient: ref.read(apiClientProvider),
                            )
                          : Stack(
                          children: <Widget>[
                            TextField(
                              controller: _content,
                              maxLines: null,
                              expands: true,
                              textAlignVertical: TextAlignVertical.top,
                              decoration: const InputDecoration(
                                hintText: "Start writing… ([[ to link a note)",
                                border: InputBorder.none,
                              ),
                              onChanged: (_) => _onChanged(),
                            ),
                            if (_wikiStart != null && _wikiResults.isNotEmpty)
                              Positioned(
                                left: 0,
                                right: 0,
                                bottom: 0,
                                child: Material(
                                  elevation: 4,
                                  borderRadius: BorderRadius.circular(8),
                                  child: ConstrainedBox(
                                    constraints:
                                        const BoxConstraints(maxHeight: 220),
                                    child: ListView(
                                      shrinkWrap: true,
                                      padding: EdgeInsets.zero,
                                      children: _wikiResults
                                          .map((Map<String, Object?> n) =>
                                              ListTile(
                                                dense: true,
                                                leading: const Icon(
                                                    Icons.link, size: 18),
                                                title: Text(_titleOf(n),
                                                    maxLines: 1,
                                                    overflow:
                                                        TextOverflow.ellipsis),
                                                onTap: () => _insertWiki(n),
                                              ))
                                          .toList(),
                                    ),
                                  ),
                                ),
                              ),
                          ],
                        ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}

class _TagsRow extends ConsumerWidget {
  const _TagsRow({required this.noteId});

  final String noteId;

  Future<void> _add(BuildContext context, WidgetRef ref) async {
    final TextEditingController c = TextEditingController();
    final String? name = await showDialog<String>(
      context: context,
      builder: (BuildContext c2) => AlertDialog(
        title: const Text("Add tag"),
        content: TextField(
          controller: c,
          autofocus: true,
          decoration: const InputDecoration(hintText: "Tag name"),
          onSubmitted: (String v) => Navigator.of(c2).pop(v.trim()),
        ),
        actions: <Widget>[
          TextButton(
              onPressed: () => Navigator.of(c2).pop(),
              child: const Text("Cancel")),
          FilledButton(
              onPressed: () => Navigator.of(c2).pop(c.text.trim()),
              child: const Text("Add")),
        ],
      ),
    );
    if (name != null && name.isNotEmpty) {
      await addNoteTag(ref, noteId, name);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final List<Map<String, Object?>> tags =
        ref.watch(noteTagsProvider(noteId)).valueOrNull ?? const [];
    return Wrap(
      spacing: 6,
      runSpacing: 4,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: <Widget>[
        ...tags.map((Map<String, Object?> t) => Chip(
              label: Text(t["name"]?.toString() ?? ""),
              visualDensity: VisualDensity.compact,
              onDeleted: () =>
                  removeNoteTag(ref, noteId, t["id"]?.toString() ?? ""),
            )),
        ActionChip(
          avatar: const Icon(Icons.add, size: 16),
          label: const Text("Tag"),
          visualDensity: VisualDensity.compact,
          onPressed: () => _add(context, ref),
        ),
      ],
    );
  }
}
