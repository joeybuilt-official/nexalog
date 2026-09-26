import "package:html/dom.dart" as dom;
import "package:html/parser.dart" as html_parser;
import "package:super_editor/super_editor.dart";

/// HTML ⇄ super_editor document conversion for the WYSIWYG note editor (web
/// parity §4). Notes are stored as Tiptap HTML; this maps the COMMON subset
/// (paragraphs, h1-h3, blockquote, ordered/unordered lists, bold/italic/
/// underline/strike/inline-code/links) to a super_editor [MutableDocument] and
/// serializes it back. Anything outside the subset — or wikilink anchors, whose
/// `[[label]]` markup the document model can't preserve — is reported
/// unsupported so the caller keeps the raw-HTML editor and never silently
/// flattens a richer note.

const Set<String> _supportedTags = <String>{
  "p", "h1", "h2", "h3", "blockquote", "ul", "ol", "li",
  "strong", "b", "em", "i", "u", "s", "del", "code", "a", "br",
};

final RegExp _hasTag = RegExp(r"<[a-zA-Z!/][^>]*>");

/// True when [html] can be edited losslessly in the WYSIWYG surface.
bool isHtmlEditableWysiwyg(String html) {
  final String t = html.trim();
  if (t.isEmpty) return true;
  if (!_hasTag.hasMatch(t)) return true; // plain text
  final dom.Document doc = html_parser.parse(t);
  final dom.Element? body = doc.body;
  if (body == null) return true;
  for (final dom.Element el in body.querySelectorAll("*")) {
    final String tag = el.localName?.toLowerCase() ?? "";
    if (!_supportedTags.contains(tag)) return false;
    if (tag == "a" && el.attributes.containsKey("data-wikilink")) return false;
  }
  return true;
}

MutableDocument htmlToDocument(String html) {
  final List<DocumentNode> nodes = <DocumentNode>[];
  int counter = 0;
  String nid() => "n${counter++}";

  final String t = html.trim();
  if (t.isEmpty || !_hasTag.hasMatch(t)) {
    for (final String line in t.isEmpty ? <String>[""] : t.split("\n")) {
      nodes.add(ParagraphNode(id: nid(), text: AttributedText(line)));
    }
    return MutableDocument(nodes: nodes);
  }

  final dom.Element? body = html_parser.parse(t).body;
  if (body != null) {
    for (final dom.Node n in body.nodes) {
      _appendBlock(n, nodes, nid);
    }
  }
  if (nodes.isEmpty) {
    nodes.add(ParagraphNode(id: nid(), text: AttributedText("")));
  }
  return MutableDocument(nodes: nodes);
}

void _appendBlock(dom.Node n, List<DocumentNode> out, String Function() nid) {
  if (n is dom.Text) {
    final String s = n.text.trim();
    if (s.isNotEmpty) {
      out.add(ParagraphNode(id: nid(), text: AttributedText(s)));
    }
    return;
  }
  if (n is! dom.Element) return;
  final String tag = n.localName?.toLowerCase() ?? "";
  switch (tag) {
    case "h1":
      out.add(ParagraphNode(
          id: nid(),
          text: _inline(n),
          metadata: const <String, dynamic>{
            NodeMetadata.blockType: header1Attribution
          }));
      break;
    case "h2":
      out.add(ParagraphNode(
          id: nid(),
          text: _inline(n),
          metadata: const <String, dynamic>{
            NodeMetadata.blockType: header2Attribution
          }));
      break;
    case "h3":
      out.add(ParagraphNode(
          id: nid(),
          text: _inline(n),
          metadata: const <String, dynamic>{
            NodeMetadata.blockType: header3Attribution
          }));
      break;
    case "blockquote":
      out.add(ParagraphNode(
          id: nid(),
          text: _inline(n),
          metadata: const <String, dynamic>{
            NodeMetadata.blockType: blockquoteAttribution
          }));
      break;
    case "ul":
      for (final dom.Element li in n.children
          .where((dom.Element e) => e.localName?.toLowerCase() == "li")) {
        out.add(ListItemNode.unordered(id: nid(), text: _inline(li)));
      }
      break;
    case "ol":
      for (final dom.Element li in n.children
          .where((dom.Element e) => e.localName?.toLowerCase() == "li")) {
        out.add(ListItemNode.ordered(id: nid(), text: _inline(li)));
      }
      break;
    default: // p and any transparent wrapper
      out.add(ParagraphNode(id: nid(), text: _inline(n)));
  }
}

/// Builds an [AttributedText] from an element's inline descendants, mapping
/// formatting tags to attributions over the right character ranges.
AttributedText _inline(dom.Element el) {
  final StringBuffer buf = StringBuffer();
  final List<_Range> ranges = <_Range>[];

  void walk(dom.Node node, Set<Attribution> active) {
    if (node is dom.Text) {
      final String s = node.text;
      if (s.isEmpty) return;
      final int start = buf.length;
      buf.write(s);
      for (final Attribution a in active) {
        ranges.add(_Range(a, start, buf.length));
      }
      return;
    }
    if (node is! dom.Element) return;
    final String tag = node.localName?.toLowerCase() ?? "";
    if (tag == "br") {
      buf.write("\n");
      return;
    }
    Attribution? a;
    switch (tag) {
      case "strong":
      case "b":
        a = boldAttribution;
        break;
      case "em":
      case "i":
        a = italicsAttribution;
        break;
      case "u":
        a = underlineAttribution;
        break;
      case "s":
      case "del":
        a = strikethroughAttribution;
        break;
      case "code":
        a = codeAttribution;
        break;
      case "a":
        final String? href = node.attributes["href"];
        if (href != null && href.isNotEmpty) {
          try {
            a = LinkAttribution.fromUri(Uri.parse(href));
          } catch (_) {
            a = null;
          }
        }
        break;
    }
    final Set<Attribution> next =
        a == null ? active : <Attribution>{...active, a};
    for (final dom.Node c in node.nodes) {
      walk(c, next);
    }
  }

  for (final dom.Node c in el.nodes) {
    walk(c, <Attribution>{});
  }

  final AttributedText at = AttributedText(buf.toString());
  for (final _Range r in ranges) {
    if (r.end > r.start) {
      at.addAttribution(r.attr, SpanRange(r.start, r.end - 1));
    }
  }
  return at;
}

class _Range {
  _Range(this.attr, this.start, this.end);
  final Attribution attr;
  final int start;
  final int end;
}

// --- Document → HTML --------------------------------------------------------

String documentToHtml(Document doc) {
  final StringBuffer buf = StringBuffer();
  final int count = doc.nodeCount;
  int i = 0;
  while (i < count) {
    final DocumentNode? node = doc.getNodeAt(i);
    if (node == null) {
      i++;
      continue;
    }
    if (node is ListItemNode) {
      final bool ordered = node.type == ListItemType.ordered;
      buf.write(ordered ? "<ol>" : "<ul>");
      while (i < count) {
        final DocumentNode? m = doc.getNodeAt(i);
        if (m is ListItemNode &&
            (m.type == ListItemType.ordered) == ordered) {
          buf.write("<li>${_inlineHtml(m.text)}</li>");
          i++;
        } else {
          break;
        }
      }
      buf.write(ordered ? "</ol>" : "</ul>");
      continue;
    }
    if (node is ParagraphNode) {
      final Object? bt = node.getMetadataValue(NodeMetadata.blockType);
      final String inner = _inlineHtml(node.text);
      if (bt == header1Attribution) {
        buf.write("<h1>$inner</h1>");
      } else if (bt == header2Attribution) {
        buf.write("<h2>$inner</h2>");
      } else if (bt == header3Attribution) {
        buf.write("<h3>$inner</h3>");
      } else if (bt == blockquoteAttribution) {
        buf.write("<blockquote>$inner</blockquote>");
      } else {
        buf.write("<p>$inner</p>");
      }
      i++;
      continue;
    }
    if (node is TextNode) {
      buf.write("<p>${_inlineHtml(node.text)}</p>");
    }
    i++;
  }
  return buf.toString();
}

const List<Attribution> _markOrder = <Attribution>[
  codeAttribution,
  boldAttribution,
  italicsAttribution,
  underlineAttribution,
  strikethroughAttribution,
];

String _openTag(Attribution a) {
  if (a is LinkAttribution) return '<a href="${_escAttr(a.plainTextUri)}">';
  if (a == codeAttribution) return "<code>";
  if (a == boldAttribution) return "<strong>";
  if (a == italicsAttribution) return "<em>";
  if (a == underlineAttribution) return "<u>";
  if (a == strikethroughAttribution) return "<s>";
  return "";
}

String _closeTag(Attribution a) {
  if (a is LinkAttribution) return "</a>";
  if (a == codeAttribution) return "</code>";
  if (a == boldAttribution) return "</strong>";
  if (a == italicsAttribution) return "</em>";
  if (a == underlineAttribution) return "</u>";
  if (a == strikethroughAttribution) return "</s>";
  return "";
}

/// Canonical ordered list of the supported attributions present at an offset
/// (links last so they wrap the inline marks).
List<Attribution> _ordered(Set<Attribution> attrs) {
  final List<Attribution> out = <Attribution>[];
  LinkAttribution? link;
  for (final Attribution a in attrs) {
    if (a is LinkAttribution) link = a;
  }
  if (link != null) out.add(link);
  for (final Attribution m in _markOrder) {
    if (attrs.contains(m)) out.add(m);
  }
  return out;
}

String _inlineHtml(AttributedText at) {
  final String text = at.toPlainText();
  final AttributedSpans spans = at.spans;
  final StringBuffer buf = StringBuffer();
  List<Attribution> open = <Attribution>[];

  void setOpen(List<Attribution> target) {
    final List<String> a = open.map(_openTag).toList();
    final List<String> b = target.map(_openTag).toList();
    if (a.length == b.length &&
        List<int>.generate(a.length, (int i) => i)
            .every((int i) => a[i] == b[i])) {
      return;
    }
    for (final Attribution x in open.reversed) {
      buf.write(_closeTag(x));
    }
    for (final Attribution x in target) {
      buf.write(_openTag(x));
    }
    open = target;
  }

  for (int i = 0; i < text.length; i++) {
    setOpen(_ordered(spans.getAllAttributionsAt(i)));
    buf.write(_escText(text[i]));
  }
  setOpen(<Attribution>[]);
  return buf.toString();
}

String _escText(String s) =>
    s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

String _escAttr(String s) => _escText(s).replaceAll('"', "&quot;");
