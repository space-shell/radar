import "./guard.mjs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { STATE_DIR, statePath, loadState } from "../server/state.ts";
import { addByLink } from "../server/add.ts";
import { LEDGER_DIR } from "../server/ledger.ts";
import { readdir } from "node:fs/promises";

let fails = 0;
const check = (ok, name, detail = "") => {
  if (!ok) fails++;
  console.log(ok ? "pass" : "FAIL", name, ok ? "" : detail);
};

const record = (fields) => ({
  key: "owner/web#9485",
  repo: "owner/web",
  number: 9485,
  title: "Cache the lookup",
  firstSeen: new Date().toISOString(),
  state: "created",
  review: {
    acknowledge: { status: "pending" },
    qa: { status: "pending" },
    verification: { status: "pending" },
    feedback: { status: "pending" },
  },
  ...fields,
});

const seed = async (fields) => {
  await rm(STATE_DIR, { recursive: true, force: true });
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(
    statePath,
    JSON.stringify(
      { seenPullRequests: ["owner/web#9485"], intake: [record(fields)] },
      null,
      2,
    ),
  );
};

// Nothing is written until the paste has been read, so a refusal cannot leave a
// claim behind. AC-AK3.
await seed({});
const before = JSON.stringify(await loadState());
const refused = await addByLink("not a link");
check(refused.ok === false, "C1 a paste that is not a link is refused", JSON.stringify(refused));
check(
  typeof refused.error === "string" && refused.error.indexOf("Expected") !== -1,
  "C2 and says what was expected",
  JSON.stringify(refused),
);
check(JSON.stringify(await loadState()) === before, "C3 and writes nothing");

// A record already in the inbox. No second launch, no second row. AC-AK5.
const present = await addByLink("https://github.com/owner/web/pull/9485");
check(
  present.ok === true && present.already === "present" && present.key === "owner/web#9485",
  "C4 a record already there is reported, not added twice",
  JSON.stringify(present),
);
check(JSON.stringify(await loadState()) === before, "C5 and nothing is written for it");

// The short form names the same record, which is the parse feeding the key.
const short = await addByLink("owner/web#9485");
check(short.already === "present" && short.key === "owner/web#9485", "C6 the short form finds the same record", JSON.stringify(short));

// Adding a dismissed record is an instruction to bring it back. AC-AK5.
await seed({ dismissedAt: new Date().toISOString() });
const restored = await addByLink("https://github.com/owner/web/pull/9485/files");
check(
  restored.ok === true && restored.already === "restored",
  "C7 a dismissed record is restored rather than taken in again",
  JSON.stringify(restored),
);
const after = await loadState();
check(after.intake[0].dismissedAt === null, "C8 and it leaves the dismissed list", JSON.stringify(after.intake[0]));
check(after.intake.length === 1, "C9 with no second record beside it");

// The restore is a ledger event like any other, written by the one path that
// already knew how. AC-AK9.
const weeks = await readdir(LEDGER_DIR).catch(() => []);
const ledger = weeks.length
  ? await readFile(`${LEDGER_DIR}/${weeks[0]}`, "utf8")
  : "";
check(ledger.indexOf("restored") !== -1, "C10 and the week file says so", ledger);

console.log(fails === 0 ? "all clear" : `${fails} failures`);
