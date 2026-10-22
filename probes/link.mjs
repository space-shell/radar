import "./guard.mjs";
import { parsePullRequestLink } from "../shared/pr-link.ts";

let fails = 0;
const check = (ok, name, detail = "") => {
  if (!ok) fails++;
  console.log(ok ? "pass" : "FAIL", name, ok ? "" : detail);
};

let read = 0;
const reads = (input, repo, number) => {
  const parsed = parsePullRequestLink(input);
  check(
    parsed.ok && parsed.repo === repo && parsed.number === number,
    `A${++read} ${input || "(empty)"}`,
    JSON.stringify(parsed),
  );
};

// The shapes a link actually arrives in. AC-AK1.
reads("https://github.com/Quartr-App/web/pull/9485", "Quartr-App/web", 9485);
reads("https://github.com/Quartr-App/web/pull/9485/files", "Quartr-App/web", 9485);
reads("https://github.com/Quartr-App/web/pull/9485#discussion_r123", "Quartr-App/web", 9485);
reads("https://github.com/Quartr-App/web/pull/9485?w=1", "Quartr-App/web", 9485);
reads("https://github.com/Quartr-App/web/pull/9485/", "Quartr-App/web", 9485);
reads("http://github.com/Quartr-App/web/pull/9485", "Quartr-App/web", 9485);
reads("https://www.github.com/Quartr-App/web/pull/9485", "Quartr-App/web", 9485);
reads("github.com/Quartr-App/web/pull/9485", "Quartr-App/web", 9485);
reads("GitHub.com/Quartr-App/web/pull/9485", "Quartr-App/web", 9485);
reads("  https://github.com/Quartr-App/web/pull/9485  ", "Quartr-App/web", 9485);
// What `gh` and the GitHub UI both print. AC-AK2.
reads("Quartr-App/web#9485", "Quartr-App/web", 9485);
reads("Quartr-App/web/pull/9485", "Quartr-App/web", 9485);
// An owner may carry a dot, so a first segment is not a host by that alone.
reads("foo.bar/web/pull/1", "foo.bar/web", 1);
reads("space-shell/radar.js/pull/7", "space-shell/radar.js", 7);

const refuses = (input, fragment, name) => {
  const parsed = parsePullRequestLink(input);
  check(
    !parsed.ok && parsed.reason.indexOf(fragment) !== -1,
    name,
    JSON.stringify(parsed),
  );
};

// Each rejection says which thing was wrong, because each has a different fix.
// AC-AK3.
refuses("", "Paste", "B1 nothing pasted");
refuses("   ", "Paste", "B2 whitespace only");
refuses("https://github.com/Quartr-App/web/issues/9485", "issue", "B3 an issue link");
refuses("Quartr-App/web/issues/9485", "issue", "B4 an issue without its host");
refuses("https://gitlab.com/Quartr-App/web/pull/1", "github.com", "B5 another forge");
refuses("https://github.com/Quartr-App/web", "Expected", "B6 the repository alone");
refuses("https://github.com/Quartr-App/web/pull/", "Expected", "B7 no number");
refuses("#9485", "Expected", "B8 a number with no repository");
refuses("not a link at all", "Expected", "B9 prose");
refuses("https://github.com/Quartr-App/web/pull/0", "Expected", "B10 pull request zero");
refuses("https://github.com/Quartr-App/web/pull/99999999999999999999", "Expected", "B11 a number no forge issued");
// A fragment is only a number in the short form, so neither may borrow the other.
refuses("Quartr-App/web#9485/files", "Expected", "B12 the short form with a tail");

console.log(fails === 0 ? "all clear" : `${fails} failures`);
