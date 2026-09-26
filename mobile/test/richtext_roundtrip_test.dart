import "package:flutter_test/flutter_test.dart";
import "package:nexalog_mobile/src/core/richtext/html_doc.dart";

void main() {
  String roundTrip(String html) => documentToHtml(htmlToDocument(html));

  test("paragraph with inline marks round-trips", () {
    final String out = roundTrip("<p>hi <strong>bold</strong> <em>it</em></p>");
    expect(out, contains("<strong>bold</strong>"));
    expect(out, contains("<em>it</em>"));
    expect(out, startsWith("<p>"));
  });

  test("headings + blockquote preserved", () {
    final String out = roundTrip("<h2>Title</h2><blockquote>q</blockquote><p>b</p>");
    expect(out, contains("<h2>Title</h2>"));
    expect(out, contains("<blockquote>q</blockquote>"));
    expect(out, contains("<p>b</p>"));
  });

  test("lists preserved with type", () {
    final String ul = roundTrip("<ul><li>a</li><li>b</li></ul>");
    expect(ul, contains("<ul><li>a</li><li>b</li></ul>"));
    final String ol = roundTrip("<ol><li>x</li></ol>");
    expect(ol, contains("<ol><li>x</li></ol>"));
  });

  test("link preserved", () {
    final String out = roundTrip('<p><a href="https://e.com">e</a></p>');
    expect(out, contains('<a href="https://e.com">e</a>'));
  });

  test("plain text becomes a paragraph", () {
    expect(roundTrip("just text"), contains("just text"));
  });

  test("special chars escaped", () {
    expect(roundTrip("<p>a &amp; b &lt;c&gt;</p>"), contains("a &amp; b &lt;c&gt;"));
  });

  test("guard: plain + simple html supported, rich/wikilink not", () {
    expect(isHtmlEditableWysiwyg(""), isTrue);
    expect(isHtmlEditableWysiwyg("plain note"), isTrue);
    expect(isHtmlEditableWysiwyg("<p>x <strong>y</strong></p>"), isTrue);
    expect(isHtmlEditableWysiwyg("<p><img src='x'></p>"), isFalse);
    expect(isHtmlEditableWysiwyg("<table><tr><td>x</td></tr></table>"), isFalse);
    expect(
      isHtmlEditableWysiwyg(
          '<p><a data-wikilink href="/app/notes/1">[[n]]</a></p>'),
      isFalse,
    );
  });
}
