// Verify operator's staleness rules.
import { scoreStaleness } from "../lib/capture/staleness";

const oldDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); // 90 days ago

const checks: Array<{ name: string; got: ReturnType<typeof scoreStaleness>; expectReasons: string[] }> = [
  {
    name: "homepage 90d unread, alive: NO penalty",
    got: scoreStaleness({
      kindClassified: "homepage",
      evergreen: null,
      createdAt: oldDate,
      lastVisitedAt: null,
      isDeadLink: false,
      isRedirectHome: false,
      llmCurrent: null,
    }),
    expectReasons: [],
  },
  {
    name: "homepage 404: dead_link only",
    got: scoreStaleness({
      kindClassified: "homepage",
      evergreen: null,
      createdAt: oldDate,
      lastVisitedAt: null,
      isDeadLink: true,
      isRedirectHome: false,
      llmCurrent: null,
    }),
    expectReasons: ["dead_link"],
  },
  {
    name: "reference 90d unread, alive: NO penalty",
    got: scoreStaleness({
      kindClassified: "reference",
      evergreen: null,
      createdAt: oldDate,
      lastVisitedAt: null,
      isDeadLink: false,
      isRedirectHome: false,
      llmCurrent: null,
    }),
    expectReasons: [],
  },
  {
    name: "article evergreen=true 90d unread: NO penalty",
    got: scoreStaleness({
      kindClassified: "article",
      evergreen: true,
      createdAt: oldDate,
      lastVisitedAt: null,
      isDeadLink: false,
      isRedirectHome: false,
      llmCurrent: null,
    }),
    expectReasons: [],
  },
  {
    name: "article evergreen=false 90d unread + llm-not-current: both reasons",
    got: scoreStaleness({
      kindClassified: "article",
      evergreen: false,
      createdAt: oldDate,
      lastVisitedAt: null,
      isDeadLink: false,
      isRedirectHome: false,
      llmCurrent: false,
    }),
    expectReasons: ["unread_60d", "llm_not_current"],
  },
  {
    name: "video 90d unread: unread_60d penalty",
    got: scoreStaleness({
      kindClassified: "video",
      evergreen: null,
      createdAt: oldDate,
      lastVisitedAt: null,
      isDeadLink: false,
      isRedirectHome: false,
      llmCurrent: null,
    }),
    expectReasons: ["unread_60d"],
  },
];

let pass = 0;
let fail = 0;
for (const c of checks) {
  const sortedGot = [...c.got.reasons].sort();
  const sortedExp = [...c.expectReasons].sort();
  const ok =
    sortedGot.length === sortedExp.length &&
    sortedGot.every((r, i) => r === sortedExp[i]);
  if (ok) {
    pass++;
    console.log(`PASS  ${c.name}  -> score=${c.got.score.toFixed(2)} reasons=[${sortedGot.join(",")}]`);
  } else {
    fail++;
    console.log(`FAIL  ${c.name}  -> got=[${sortedGot.join(",")}] expected=[${sortedExp.join(",")}]`);
  }
}
console.log(`\n${pass}/${checks.length} passed, ${fail} failed.`);
process.exit(fail === 0 ? 0 : 1);
