import "./guard.mjs";
const { statusNote } = await import("../shared/inbox.ts");
const { graphql } = await import("../server/api.ts");

const base = { state: "open", isDraft: false, decision: null, approvedBy: [], blockedBy: [], mine: null, checkedAt: "x" };
const cases = [
  ["no status at all", undefined, null],
  ["open, nothing said", base, null],
  ["merged outranks a block", { ...base, state: "merged", blockedBy: ["a"] }, "merged|settled"],
  ["closed", { ...base, state: "closed" }, "closed|settled"],
  ["one approver", { ...base, approvedBy: ["a-colleague"] }, "approved by a-colleague|settled"],
  ["two approvers", { ...base, approvedBy: ["a", "b"] }, "approved by a and b|settled"],
  ["three approvers counted", { ...base, approvedBy: ["a", "b", "c"] }, "approved by a and 2 others|settled"],
  ["a block outranks approvals", { ...base, approvedBy: ["a"], blockedBy: ["b"] }, "changes requested by b|blocked"],
  ["James approved alone", { ...base, mine: "approved" }, "approved|settled"],
  ["James blocked alone", { ...base, mine: "changes_requested" }, "changes requested|blocked"],
  ["others outrank James", { ...base, approvedBy: ["a"], mine: "approved" }, "approved by a|settled"],
  ["draft, no reviews", { ...base, isDraft: true }, "draft|neutral"],
  ["draft loses to merged", { ...base, isDraft: true, state: "merged" }, "merged|settled"],
];

let fails = 0;
for (const [name, input, want] of cases) {
  const note = statusNote(input);
  const got = note ? `${note.label}|${note.tone}` : null;
  const ok = got === want;
  if (!ok) fails++;
  console.log(ok ? "pass" : "FAIL", name, ok ? "" : `want ${want}, got ${got}`);
}

// The helper must refuse anything that is not a query, so it cannot become a write path.
for (const doc of ["mutation { addComment(input: {}) { clientMutationId } }", "  mutation x", "{ viewer { login } }"]) {
  try {
    await graphql(doc);
    console.log("FAIL: accepted", JSON.stringify(doc.slice(0, 20)));
    fails++;
  } catch (error) {
    const ok = String(error).includes("queries only");
    if (!ok) fails++;
    console.log(ok ? "pass" : "FAIL", "refused", JSON.stringify(doc.slice(0, 20)));
  }
}
console.log(fails === 0 ? "all clear" : `${fails} failures`);
