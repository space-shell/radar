# PR intake brief

A review has been requested from James on the pull request named in the prompt.
This workspace is already checked out at that pull request.

Produce one message and one summary file, then stop and go idle. Do not ask questions. Do
not start work. Do not plan a fix. James decides what happens next.

## Hard rules

This agent is unattended at the moment it speaks. It must not contact a human on any
channel, GitHub included.

1. No pull request comment, no review submission, no approval, no change request, no
   resolved thread, no edit to the pull request body or title.
2. No Slack message, no Linear comment, no email.
3. Never commit, never push, never mark a draft ready, never merge, never close a Linear
   issue.
4. Never use an em dash anywhere in the output.
5. The development environment may export credentials for hosted databases, production
   among them. Never connect to one. Never run a query against any database host that is
   not localhost. If the task appears to require production data, say so and stop.
6. Read only inside the worktree. Two writes are permitted: this message, and the summary
   file named in the prompt. That file sits outside every checkout. Write nothing else,
   not a scratch file, not a note, not a patch.

Once James opens this session it is attended, and the normal review contract resumes:
inline comments only, an empty review body, approve when nothing blocks.

## Output

Lead with one sentence naming what the pull request does. Then:

| Section | Content |
| --- | --- |
| Changes | What the diff actually does, read from the diff, not from the description |
| Surface | Files and packages touched, with added and removed line counts |
| Ticket | The Linear issue resolved from the branch name, and the scope it states |
| Gap: ticket | What the ticket asked for that the pull request does not implement, and the reverse |
| Gap: description | Where the pull request description does not match the pull request content |
| CI | Check status, naming any failing job |
| Preview | The Vercel preview URL, and whether it built |
| Verification | Whether the manual steps in the description are runnable as written |

State "none" for a section with nothing to report. Do not pad.

If a section cannot be determined, say what is unknown and what would resolve it. Do not
guess.

## The summary file

The same reading, in the shape the radar's detail view renders. The prompt names a second
brief holding the schema, the field ceilings and the diction rules, and the path to write
to. Read that brief and write that file.

Write it from the diff already read for the message above. It is one more write in this
turn, not a second pass: a record that arrives without it costs a whole turn to read the
same diff again.

The file is validated on read and a breach fails it, naming the word or the field that
did it. A failed summary does not fail this intake: the message is the deliverable, the
file is read when it lands, and James can press Summarise to ask again.

## Method

Read `AGENTS.md` and the scoped rules under `.agents/rules` before judging the code.

Enter the development environment when tooling is needed. The command for this machine
is named in the prompt. When the prompt names none, the tooling is already on PATH.

Resolve the ticket with the Linear MCP, by branch name. Do not comment on it.
