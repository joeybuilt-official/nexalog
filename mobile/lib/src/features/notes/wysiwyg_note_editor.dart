import "dart:async";

import "package:flutter/material.dart";
import "package:super_editor/super_editor.dart";

import "../../core/api/api_client.dart";
import "../../core/richtext/html_doc.dart";

/// True WYSIWYG note editor (web parity §4) on super_editor. Loads the stored
/// HTML into a document model, renders it formatted (not raw tags), and lets the
/// user edit + apply formatting via the toolbar. Emits HTML back through
/// [onChanged] (debounced) for the screen's offline autosave. Only used when
/// [isHtmlEditableWysiwyg] passed — richer notes stay on the raw-HTML editor.
class WysiwygNoteEditor extends StatefulWidget {
  const WysiwygNoteEditor({
    super.key,
    required this.initialHtml,
    required this.onChanged,
    this.apiClient,
  });

  final String initialHtml;
  final void Function(String html) onChanged;
  final ApiClient? apiClient;

  @override
  State<WysiwygNoteEditor> createState() => _WysiwygNoteEditorState();
}

class _WysiwygNoteEditorState extends State<WysiwygNoteEditor> {
  late final MutableDocument _doc;
  late final MutableDocumentComposer _composer;
  late final Editor _editor;
  Timer? _debounce;
  bool _aiLoading = false;

  @override
  void initState() {
    super.initState();
    _doc = htmlToDocument(widget.initialHtml);
    _composer = MutableDocumentComposer();
    _editor = createDefaultDocumentEditor(
      document: _doc,
      composer: _composer,
    );
    _doc.addListener(_onDocChange);
  }

  void _onDocChange(DocumentChangeLog _) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 800), () {
      widget.onChanged(documentToHtml(_doc));
    });
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _doc.removeListener(_onDocChange);
    _editor.dispose();
    _composer.dispose();
    super.dispose();
  }

  void _toggleMark(Attribution a) {
    final DocumentSelection? sel = _composer.selection;
    if (sel == null || sel.isCollapsed) {
      _hint("Select some text first");
      return;
    }
    _editor.execute(<EditRequest>[
      ToggleTextAttributionsRequest(
        documentRange: sel,
        attributions: <Attribution>{a},
      ),
    ]);
  }

  void _setBlock(Attribution? blockType) {
    final DocumentSelection? sel = _composer.selection;
    if (sel == null) return;
    _editor.execute(<EditRequest>[
      ChangeParagraphBlockTypeRequest(
        nodeId: sel.extent.nodeId,
        blockType: blockType,
      ),
    ]);
  }

  void _toList(ListItemType type) {
    final DocumentSelection? sel = _composer.selection;
    if (sel == null) return;
    _editor.execute(<EditRequest>[
      ConvertParagraphToListItemRequest(
        nodeId: sel.extent.nodeId,
        type: type,
      ),
    ]);
  }

  Future<void> _link() async {
    final DocumentSelection? sel = _composer.selection;
    if (sel == null || sel.isCollapsed) {
      _hint("Select the text to link first");
      return;
    }
    final TextEditingController urlC = TextEditingController();
    final bool? ok = await showDialog<bool>(
      context: context,
      builder: (BuildContext c) => AlertDialog(
        title: const Text("Link"),
        content: TextField(
          controller: urlC,
          autofocus: true,
          decoration: const InputDecoration(labelText: "URL (https://…)"),
        ),
        actions: <Widget>[
          TextButton(
              onPressed: () => Navigator.of(c).pop(false),
              child: const Text("Cancel")),
          FilledButton(
              onPressed: () => Navigator.of(c).pop(true),
              child: const Text("Add")),
        ],
      ),
    );
    if (ok != true) return;
    final String url = urlC.text.trim();
    if (url.isEmpty) return;
    _editor.execute(<EditRequest>[
      ToggleTextAttributionsRequest(
        documentRange: sel,
        attributions: <Attribution>{
          LinkAttribution.fromUri(Uri.parse(url)),
        },
      ),
    ]);
  }

  Future<void> _askAi() async {
    final DocumentSelection? sel = _composer.selection;
    if (sel == null) {
      _hint("Place cursor in a paragraph first");
      return;
    }
    final String nodeId = sel.extent.nodeId;
    final DocumentNode? node = _doc.getNodeById(nodeId);
    final String blockText = node is TextNode ? node.text.text : '';

    const List<Map<String, String>> options = <Map<String, String>>[
      {'label': 'Summarize', 'cmd': 'summarize'},
      {'label': 'Related', 'cmd': 'related'},
      {'label': 'Turn into checklist', 'cmd': 'checklist'},
      {'label': 'Expand', 'cmd': 'expand'},
      {'label': 'Shorten', 'cmd': 'shorten'},
      {'label': 'Rephrase', 'cmd': 'rephrase'},
    ];

    final String? cmd = await showModalBottomSheet<String>(
      context: context,
      builder: (BuildContext c) => ListView(
        shrinkWrap: true,
        children: options
            .map((Map<String, String> o) => ListTile(
                  title: Text(o['label']!),
                  onTap: () => Navigator.of(c).pop(o['cmd']),
                ))
            .toList(),
      ),
    );
    if (cmd == null || !mounted) return;

    if (widget.apiClient == null) {
      _hint("AI not available");
      return;
    }
    setState(() => _aiLoading = true);
    try {
      final res = await widget.apiClient!.post<Map<String, dynamic>>(
        '/api/ai/inline',
        data: <String, String>{'command': cmd, 'blockText': blockText},
      );
      final String result = (res.data?['result'] as String?) ?? '';

      if (cmd == 'related') {
        final String lastId = _doc.last.id;
        _editor.execute(<EditRequest>[
          InsertNodeAfterNodeRequest(
            existingNodeId: lastId,
            newNode: ParagraphNode(id: Editor.createNodeId(), text: AttributedText(result)),
          ),
        ]);
      } else {
        _editor.execute(<EditRequest>[
          DeleteContentRequest(
            documentRange: DocumentRange(
              start: DocumentPosition(nodeId: nodeId, nodePosition: const TextNodePosition(offset: 0)),
              end: DocumentPosition(nodeId: nodeId, nodePosition: TextNodePosition(offset: blockText.length)),
            ),
          ),
          InsertTextRequest(
            documentPosition: DocumentPosition(nodeId: nodeId, nodePosition: const TextNodePosition(offset: 0)),
            textToInsert: result,
            attributions: <Attribution>{},
          ),
        ]);
      }
    } catch (e) {
      if (mounted) _hint("AI request failed: $e");
    } finally {
      if (mounted) setState(() => _aiLoading = false);
    }
  }

  void _hint(String m) {
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(m)));
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(
            children: <Widget>[
              _btn(Icons.format_bold, "Bold", () => _toggleMark(boldAttribution)),
              _btn(Icons.format_italic, "Italic",
                  () => _toggleMark(italicsAttribution)),
              _btn(Icons.format_underlined, "Underline",
                  () => _toggleMark(underlineAttribution)),
              _btn(Icons.format_strikethrough, "Strikethrough",
                  () => _toggleMark(strikethroughAttribution)),
              _btn(Icons.code, "Code", () => _toggleMark(codeAttribution)),
              _btn(Icons.title, "Heading",
                  () => _setBlock(header2Attribution)),
              _btn(Icons.format_quote, "Quote",
                  () => _setBlock(blockquoteAttribution)),
              _btn(Icons.notes, "Paragraph", () => _setBlock(paragraphAttribution)),
              _btn(Icons.format_list_bulleted, "Bulleted list",
                  () => _toList(ListItemType.unordered)),
              _btn(Icons.format_list_numbered, "Numbered list",
                  () => _toList(ListItemType.ordered)),
              _btn(Icons.link, "Link", _link),
              _btn(Icons.auto_awesome, "Ask AI", _aiLoading ? null : _askAi),
            ],
          ),
        ),
        const Divider(height: 1),
        Expanded(
          child: SuperEditor(editor: _editor),
        ),
      ],
    );
  }

  Widget _btn(IconData icon, String tip, VoidCallback? onTap) => IconButton(
        icon: Icon(icon, size: 20),
        tooltip: tip,
        visualDensity: VisualDensity.compact,
        onPressed: onTap,
      );
}
