# QA brief

Review the code of the pull request this workspace is checked out at, and write what you
find to the findings file named in the prompt. Writing that file is the whole job.

## Hard rules

1. Post nothing to GitHub. No comment, no review, no approval, no change request, no
   resolved thread, no edit to the pull request body or title. The findings file is the
   only output. James decides later what, if anything, is said. AC-E7.
2. No Slack message, no Linear comment, no email.
3. Never commit, never push, never mark a draft ready, never merge, never close a Linear
   issue.
4. Write nothing inside the worktree. Not a scratch file, not a note, not a patch. The
   findings file sits outside every checkout and is the only file to create. AC-E4.
5. Never use an em dash anywhere, the findings file included.
6. The development environment may export credentials for hosted databases, production
   among them. Never connect to one. Never run a query against any database host that is
   not localhost. If a check appears to need production data, record that as the reason it
   could not be made and move on.

## What counts as a finding

Something a reviewer would say out loud on a specific line. Anchored to a line in this
diff, and worth a human's attention.

Not findings: style the formatter owns, a preference with no defect behind it, a
restatement of what the code says, or praise.

An empty findings list is a real answer. Write the file with `"findings": []` rather than
inventing something to fill it.

## Severity

| Severity | Meaning |
| --- | --- |
| `blocking` | Merging this does damage: data loss, a security hole, a broken contract, a crash on a real path |
| `concern` | Worth changing before merge, but it will not break anything today |
| `nit` | Correct as written, better another way. The reviewer can ignore it with no cost |

Use `blocking` only where the damage is nameable. It unchecks the approve box on its own.

## The file

Write exactly this shape, to the path in the prompt, and nothing else to it:

```json
{
  "version": 1,
  "key": "<the record key from the prompt>",
  "generatedAt": "<ISO 8601 timestamp>",
  "findings": [
    {
      "path": "apps/web/src/thing.ts",
      "line": 42,
      "side": "RIGHT",
      "severity": "concern",
      "body": "What is wrong, and what would be right."
    }
  ],
  "verification": []
}
```

- `path` is relative to the repository root, exactly as the diff names it.
- `line` is a line in the diff. `side` is `RIGHT` for the new version of the file and
  `LEFT` for the old. A finding anchored off the diff is dropped at submit time, so check
  the anchor before writing it.
- `body` is the comment a reviewer would leave. Plain prose, no severity prefix, no
  greeting, no sign-off. Say what is wrong and what would be right.
- Leave `verification` as an empty array. The verification stage owns it.

The file is validated against a schema on read. A file that does not parse fails the stage
and nothing is recovered from it, so write it once and write it whole.

## Method

Read `AGENTS.md` and the scoped rules under `.agents/rules` before judging the code.

Enter the development environment when tooling is needed. The command for this machine
is named in the prompt. When the prompt names none, the tooling is already on PATH.

Read the diff first and the surrounding code second. A finding that only makes sense
without the rest of the file is not a finding.

When the file is written, say one line naming how many findings there are, and stop.
