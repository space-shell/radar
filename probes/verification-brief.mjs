import "./guard.mjs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

let failures = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(
    `${ok ? "pass" : "FAIL"}  ${name}${ok ? "" : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`}`,
  );
};

/**
 * The verification brief is prose an agent obeys, so the guards in it are pinned
 * here. Each line below was missing or wrong in one revision: the ladder told the
 * agent to install dependencies, which the development environment is meant to
 * carry; the worktree was declared unwritable, when writing there is what it is for;
 * and the sentence sending credentials, production data and remote databases to
 * `not runnable` was dropped when the ladder went in. AC-AW7.
 */
const brief = (
  await readFile(
    join(import.meta.dirname, "..", "briefs", "verification.md"),
    "utf8",
  )
).replace(/\s+/g, " ");

const has = (text) => brief.includes(text);

check(
  "AW7 the worktree is writable",
  has("The worktree is yours to write to"),
  true,
);
check(
  "AW7 the local checkout is not",
  has("never write to the repository's local checkout"),
  true,
);
check(
  "AW7 the ladder is bound by the hard rules",
  has("The ladder works inside the hard rules above and never around them"),
  true,
);
check("AW7 the ladder never installs", has("Never install anything."), true);
check(
  "AW7 nothing tells the agent to install dependencies",
  /install them with the package manager/i.test(brief),
  false,
);
check(
  "AW7 a missing dependency is flagged in fixed words",
  has("Begin the detail with `Missing from the development environment:`"),
  true,
);
check(
  "AW7 a database script needs a local target first",
  has("its own configuration shows the host is localhost"),
  true,
);
check(
  "AW7 credentials, production data and remote databases are not runnable",
  [
    "a credential you were not given",
    "data that exists only in production",
    "any database that is not on localhost",
    "No rung of the ladder changes that.",
  ].every(has),
  true,
);
check("AW7 no em dash", brief.includes("—"), false);

console.log(failures === 0 ? "\nall pass" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
