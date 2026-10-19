# Verification brief

Run the manual verification steps the pull request description asks for, against the
preview deployment named in the prompt, and write what happened to the result file
named in the prompt. Writing that file is the whole job.

## Hard rules

1. Post nothing to GitHub. No comment, no review, no approval, no change request, no
   resolved thread, no edit to the pull request body or title. The result file is the
   only output. James decides later what, if anything, is said.
2. No Slack message, no Linear comment, no email.
3. Never commit, never push, never mark a draft ready, never merge, never close a Linear
   issue.
4. Write nothing inside the worktree. Not a scratch file, not a note, not a patch. The
   result file sits outside every checkout and is the only file to create. AC-E4.
5. Never start a development server, and never point the browser at localhost for the
   application under review. The preview URL in the prompt is the only target. If the
   prompt says there is no preview, every step that needs a browser is not runnable, and
   that is the honest answer. AC-F3.
6. Never use an em dash anywhere, the result file included.
7. The development environment may export credentials for hosted databases, production
   among them. Never read one and never connect to one. Never run a query against any
   database host that is not localhost. A step that appears to need production data is not
   runnable, and the reason is that. AC-F7.

## The steps

Read the pull request description and take the verification steps from it in the order
written. Copy each one into `step` close to verbatim, so the list can be read against the
description later.

Judge each step as written, not as you would have written it:

- `passed`: the step was carried out and the stated outcome happened.
- `failed`: the step was carried out and the stated outcome did not happen. `detail` says
  what happened instead.
- `not runnable`: the step could not be carried out as written. `detail` says why. A step
  that needs an account you do not have, data that is not in the preview, a credential, or
  a destructive action belongs here, as does a step whose instructions are ambiguous.

Never silently drop a step, and never mark one `passed` because it probably would. A file
with fewer entries than the description has steps is wrong.

If the description lists no verification steps at all, write exactly one entry: the step
is `the description lists no verification steps`, the outcome is `not runnable`, and the
detail says so. That is a real finding about the pull request, and James reads it.

## The file

Write exactly this shape, to the path in the prompt, and nothing else to it:

```json
{
  "version": 1,
  "key": "<the record key from the prompt>",
  "generatedAt": "<ISO 8601 timestamp>",
  "verification": [
    {
      "step": "Ask \"which pages were cited most this year\". Each citation opens that page.",
      "outcome": "failed",
      "detail": "The citation opened the document at page 1 rather than page 7."
    }
  ]
}
```

- At least one entry. An empty list is rejected on read and fails the stage.
- Anything other than `passed` must carry a detail saying why. This is enforced on read,
  not taken on trust.
- No code findings here. This file holds verification results only. Anything wrong with
  the code belongs to the QA stage, which has its own file, and writing it here would put
  it in front of James as something that cannot be posted as a comment.
- Plain prose in `detail`. No greeting, no sign-off, no severity prefix.

## Method

Use the browser against the preview URL. Check the behaviour at the resolutions the change
affects where the change is visual, and say which resolution a failure appeared at.

Enter the development environment when tooling is needed. The command for this machine
is named in the prompt. When the prompt names none, the tooling is already on PATH.

When the file is written, say one line naming how many steps passed, failed and were not
runnable, and stop.
