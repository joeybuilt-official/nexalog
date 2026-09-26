// Standalone classifier verification — no DB needed.
import { classifyUrl } from "../lib/capture/classifier";

const cases: Array<{ url: string; expected: string; note: string }> = [
  // homepage cases (operator-specified)
  { url: "https://nissan.com", expected: "homepage", note: "brand bare host" },
  { url: "https://www.microsoft.com/", expected: "homepage", note: "brand www + slash" },
  { url: "https://github.com/", expected: "homepage", note: "github root" },
  { url: "https://apple.com/about", expected: "homepage", note: "marketing slug" },
  { url: "https://example.com/?utm_source=newsletter", expected: "homepage", note: "utm-only query" },
  // youtube root vs watch — content classifier wins
  { url: "https://youtube.com/", expected: "homepage", note: "youtube root = homepage" },
  { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", expected: "video", note: "youtube watch" },
  { url: "https://youtu.be/dQw4w9WgXcQ", expected: "video", note: "youtu.be short" },
  // article
  { url: "https://blog.example.com/posts/why-tcp", expected: "article", note: "blog path" },
  { url: "https://medium.com/@alice/foo-bar", expected: "article", note: "medium" },
  // reference
  { url: "https://docs.djangoproject.com/en/5.0/topics/db/queries/", expected: "reference", note: "docs subdomain" },
  { url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/map", expected: "reference", note: "MDN" },
  // social
  { url: "https://x.com/some_user/status/123", expected: "social", note: "x post" },
  { url: "https://twitter.com/handle", expected: "social", note: "twitter handle" },
];

let pass = 0;
let fail = 0;
for (const c of cases) {
  const r = classifyUrl({ url: c.url, ogType: null });
  const ok = r.kind === c.expected;
  if (ok) pass++;
  else fail++;
  const status = ok ? "PASS" : "FAIL";
  console.log(`${status} [${r.kind} vs ${c.expected}] ${c.url}  -- ${c.note}`);
}
console.log(`\n${pass}/${cases.length} passed, ${fail} failed.`);
process.exit(fail === 0 ? 0 : 1);
