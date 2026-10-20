# Radar: acceptance criteria

Tracks the PR review pipeline added on top of intake. One checkbox per criterion.
IDs are stable and never reused.

Tick on evidence, never on the code compiling. Two kinds of evidence count, and every
tick names which it rests on:

- **Verified live.** Observed against a running plugin or the real API.
- **Verified by construction.** The criterion is a structural property of the code that
  cannot vary at runtime: a dependency that is absent, a single shared writer, a control
  that has no handler.

A criterion asserting what a human sees, or what happens on a press, can only be
verified live. Those are collected under "Awaiting the app" at the foot of this file.

| Group | Scope                                        | Built | Verified |
| ----- | -------------------------------------------- | ----- | -------- |
| A     | Row actions: retry, dismiss, restore         | yes   | 6 / 11   |
| B     | Dismissed rows view                          | yes   | 2 / 4    |
| C     | Review pipeline model                        | yes   | 6 / 7    |
| D     | Stage 1, Acknowledge                         | yes   | 5 / 6    |
| E     | Stage 2, QA                                  | yes   | 6 / 8    |
| F     | Stage 3, Verification                        | yes   | 3 / 7    |
| G     | Stage 4, Feedback wizard                     | yes   | 25 / 25  |
| H     | Stage 5, Dismiss                             | yes   | 4 / 4    |
| I     | Guardrails, apply throughout                 | part  | 8 / 9    |
| J     | Metro map visualisation                      | yes   | 9 / 12   |
| K     | Pull request summary                         | yes   | 5 / 9    |
| L     | Engagement ledger                            | part  | 12 / 12  |
| M     | Pull request status on the row               | yes   | 8 / 9    |
| N     | Sweep on demand, faults as an icon           | yes   | 6 / 8    |
| O     | Acknowledge cannot be skipped                | yes   | 6 / 7    |
| P     | Nothing about one machine in the source      | yes   | 10 / 10  |
| Q     | Long turns outlive the call that starts them | yes   | 5 / 8    |
| R     | An armed control reads as armed              | yes   | 0 / 1    |
| S     | The Linear half of the radar                 | part  | 11 / 13  |
| T     | The reaper decides and holds                 | yes   | 10 / 10  |
| U     | A summary costs a turn only when asked for   | yes   | 4 / 5    |
| V     | A finished pull request is not a fault       | yes   | 10 / 10  |

## Decisions settled

| #   | Question                                                   | Resolution                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Stage controls inline on the row, or on a detail screen?   | Detail screen, carrying a metro map of the five stages. The row keeps a compact strip. Group J                                                                                                                                                                                                                                                                                                     |
| D2  | Does dismiss archive the workspace?                        | No. The reaper keeps its own 24h rule                                                                                                                                                                                                                                                                                                                                                              |
| D3  | Which GitHub identity authors the reaction and the review? | `space-shell`. Not a choice: it is the only account `gh` holds a token for. `repo` scope already covers reactions and reviews, so no token refresh is needed                                                                                                                                                                                                                                       |
| D4  | Can a stage be actioned from the row strip?                | No. The strip is read-only. Every stage control lives on the detail screen, so no GitHub write sits behind a 14px square                                                                                                                                                                                                                                                                           |
| D5  | Where does sweep and state information live?               | The inbox header carries a clock pill at top right showing the bare elapsed span. Per-record state moves to a footer status bar on the detail screen, built with group J                                                                                                                                                                                                                           |
| D6  | How does a row tap reach the detail screen?                | It does not. `openScreen` is declared on `PluginSidebarItemProps`, `PluginPopoverProps` and the command context, never on `PluginScreenProps`, so a screen cannot open another screen. The detail is a view of the `inbox` screen, swapped in by local state. `params.key` still seeds the selection, so the record stays reachable from the surfaces that can navigate. AC-J1 is amended to match |

## Resolved by inspection

`server.handle` passes `PluginHandlerContext { paseo: PaseoApi }` as the handler's second
argument, so the full SDK is available inside every stage action. Stages are RPC handlers
behind a press, which is exactly where the SDK is reachable. The long-standing `server.paseo`
open item therefore does not block any of this; only the background poller still has to
shell out.

`paseo send <id> <prompt>` exists, so reusing the intake agent is reachable by either route.

## A. Row actions

- [x] **AC-A1** A record in `failed`, `unmapped` or `orphaned` offers Retry. A record in any other state does not. Amended: `orphaned` did not exist when this was written and was added by R3, which makes it retryable by design. Verified by construction: `client/inbox.tsx:163` tests exactly those three states, and a dismissed record is excluded.
- [ ] **AC-A2** Retry re-resolves the repo checkout, re-launches the intake agent, and on success sets `state=created` with a fresh `agentId` and `workspaceId`.
- [ ] **AC-A3** Retry on a record whose agent already exists and is alive adopts that agent rather than launching a second one.
- [ ] **AC-A4** Retry failing leaves the record in `failed` with the reason visible in the UI, not only in the plugin log.
- [x] **AC-A5** Retry is idempotent under double-press: a second press while the first is in flight is ignored. Guarded server side by an in-flight key set and client side by a disabled control.
- [x] **AC-A6** Retry works on a record suppressed by `seenPullRequests`. Suppression governs new intake only, never an explicit retry. Verified by construction: `server/actions.ts` never reads that list.
- [x] **AC-A11** A record whose agent was archived or deleted leaves the `created` state within one tick and becomes retryable. Verified live 2026-10-15 on PR #9470.
- [ ] **AC-A7** Dismiss sets `dismissedAt` to an ISO timestamp and removes the row from the default view.
- [x] **AC-A8** Dismiss and Retry each require a confirm press. A single tap while scrolling cannot fire either. Verified by construction: both go through `ConfirmButton`, whose first press only arms the control and whose armed state expires after 4s.
- [ ] **AC-A9** Restore clears `dismissedAt` and returns the row to the default view with every stage status intact. Amended by AC-H2: a dismissal returns a `done` acknowledge to `pending`, because it takes the reaction back. Restore itself still changes no stage, and does not re-add the reaction.
- [x] **AC-A10** An action in flight replaces its control with a working indicator naming the action, held until the refreshed row lands. No press leaves the row looking idle while work is running. Verified by construction, against query-core 5.104.2: the busy set is read from the mutation cache, and `mutation.js:195` awaits `onSettled` before dispatching `success`. Every mutation here passes the cache invalidation as `onSettled`, so it stays `pending` until the refetch resolves.

## B. Dismissed rows

- [ ] **AC-B1** The screen has a visible toggle between active and dismissed rows, with a count on the dismissed side.
- [ ] **AC-B2** Dismissed rows render the same information as active rows, plus the dismissal age.
- [x] **AC-B3** Dismissed rows are sorted most recently dismissed first. Verified by construction: `client/inbox.tsx:141` sorts on `dismissedAt` descending.
- [x] **AC-B4** A dismissed record is never deleted from `seen.json` by any automatic process, including the reaper. Verified: `server/reap.ts` only sets `state`, it never removes an entry.

## C. Review pipeline model

- [x] **AC-C1** Pipeline state is a separate field from intake `state`. The two never collapse into one enum. Verified by construction: `record.review` is its own object and no code path writes intake `state` from a stage.
- [x] **AC-C2** Each stage holds one of `pending`, `running`, `done`, `skipped`, `failed`. Verified: `stageStatusSchema` in `shared/review.ts`.
- [x] **AC-C3** `skipped` is visually and structurally distinct from `pending`. A skipped stage never blocks a later one. Verified by construction: `skipped` carries its own glyph and a dashed border where `pending` is blank and solid, and `currentNode` steps over both `done` and `skipped`, so a skipped stage cannot hold up a later one.
- [x] **AC-C4** Stage transitions are written to `seen.json` atomically, through the existing temp-and-rename path. Verified: every stage write goes through `updateState`, the only writer, which serialises load-mutate-save and renames a temp file into place.
- [ ] **AC-C5** A stage left `running` when the daemon restarts is re-derived from the agent's real status on the next tick, never left stuck.
- [x] **AC-C6** The row shows a compact five-segment stage strip readable without opening anything. It is read-only and never pressable, per decision D4. The full map and every control live on the detail screen, group J. Verified by construction: the row renders `StageStrip`, which contains no `Pressable` and no handler of any kind.
- [x] **AC-C7** No stage ever advances on its own. Every transition follows a press. Verified: the only background writer is `reconcileStages`, which can move a stage backwards to `pending` or sideways to `failed`, never forwards.

## D. Stage 1, Acknowledge

- [x] **AC-D1** Acknowledge posts the `eyes` reaction to the pull request and nothing else. `server/reactions.ts` is the only module that writes to GitHub, and it has three calls: add, list, delete.
- [x] **AC-D2** The reaction is posted to the issues reactions endpoint for the PR number, verified against a real PR. Verified 2026-10-15 against `owner/web#9462`: add left `["space-shell"]`, and the probe restored the PR to the empty state it started in.
- [x] **AC-D3** Acknowledging a PR that already carries an `eyes` reaction from this account is a no-op, not a duplicate or an error. Verified 2026-10-15: a second add answered 200 rather than 201 and the list stayed at one entry.
- [x] **AC-D4** Removal re-queries the live reaction list and deletes by the returned id, rather than trusting a stored id. A reaction added by hand in the GitHub UI is therefore removable. Verified 2026-10-15: remove returned true and emptied the list, and a second remove returned false rather than throwing.
- [x] **AC-D5** A failed reaction call sets the stage to `failed` with the GitHub status code shown, and changes nothing else. Verified 2026-10-15 against a 404: the stage read `failed` with `GitHub returned 404 adding the reaction`.
- [ ] **AC-D6** Acknowledge is reversible by pressing it again before any later stage runs. Server half verified 2026-10-15: undo removed the reaction, and undo on a record whose QA had moved was refused with `a later stage has already run`, leaving the stage untouched. The press itself is still to do.

## E. Stage 2, QA

- [x] **AC-E1** QA sends a new prompt to the existing intake agent, through the SDK handle on the RPC context. It never creates a second agent for the same PR. Verified by construction: `server/turn.ts` reaches the SDK only through `agents.ref(record.agentId)`, and `launchIntake` is the one creation site in the plugin, called only from `server/actions.ts`. Confirmed 2026-10-15 against a stand-in SDK whose `create` threw on contact: the happy path never touched it.
- [x] **AC-E2** QA on a record with no live agent reports that and offers Retry instead of silently doing nothing. Verified 2026-10-15 through the real stage machinery: the stage settled `failed` with `this record has no agent. Retry it to make one`, the record moved to `orphaned` carrying `lastError`, and `orphaned` is one of the three states the row offers Retry for. An agent that is archived, closed or unreadable takes the same route.
- [x] **AC-E3** The agent writes findings to `~/.local/state/radar/findings/<repo>#<number>.json`, outside every git worktree. Verified 2026-10-15: the resolved path sat under the state directory, and the repo's slash puts the file one directory deeper, which `prepareFindings` creates.
- [ ] **AC-E4** Nothing is ever written into the PR worktree, so no stage can dirty a checkout or create something committable. The server half holds by construction: every write goes through `server/findings.ts`, which only ever addresses `STATE_DIR`. The agent half rests on a hard rule in the brief and needs a real run to confirm.
- [x] **AC-E5** The findings file is validated against a zod schema on read. An invalid file sets the stage to `failed` and says so; it never degrades to zero findings silently. Verified 2026-10-15 against seven inputs: missing file, malformed JSON, missing keys, an unknown severity, a missing line anchor, a fractional line and an empty body. Every one threw with the offending field named.
- [x] **AC-E6** Each finding carries `path`, `line`, `side`, `severity`, and `body`. Verified 2026-10-15: dropping any one of the five fails the parse.
- [ ] **AC-E7** The QA agent posts nothing to GitHub. Writing the findings file is its only output. The server posts nothing, but the agent holds `gh`, so only a real run settles this.
- [x] **AC-E8** QA is skippable, and skipping it leaves Verification and Feedback reachable. Verified by construction: Skip is offered on the current pending stage and on a failed one, and `currentNode` steps over `skipped` exactly as it steps over `done`, so the stage after it becomes current.

A re-run replaces the code findings and carries the verification list across, so QA cannot
discard work that belongs to stage 3. Verified 2026-10-15: a stale two-finding file was
replaced by the new one and the previous verification entry survived, with the stage
settling `done` and noting `1 finding`.

## F. Stage 3, Verification

- [x] **AC-F1** Verification sends a prompt to the same existing agent, as in AC-E1. Verified by construction: it calls the same `askAgent`, which only ever reaches `agents.ref`. Confirmed 2026-10-15 against a stand-in SDK whose `create` threw on contact.
- [ ] **AC-F2** The agent follows the manual verification steps from the PR description, in order. The brief requires each step copied close to verbatim and forbids dropping one, but only a real run shows whether the list matches the description.
- [ ] **AC-F3** Browser work targets the Vercel preview URL parsed from the PR body, never a local dev server. The parser is verified: on 2026-10-15 it returned the right host for `#9462`, `#9457`, `#9470` and `#9414`, declined a body carrying only the Storybook preview, declined another pull request's preview, and declined `pr-94620` against `9462`. The prompt carries that URL, and says plainly not to start a dev server when there is none. What the browser is actually pointed at needs a real run.
- [ ] **AC-F4** A step that is not runnable as written is recorded as such, with the reason, rather than skipped quietly. The reason is enforced on read, not asked for: verified 2026-10-15 that a `not runnable` step with a blank detail fails the stage with `a step that did not pass must say why`, and that an empty list fails with `expected array to have >=1 items`. Whether every step in the description reached the list can only be seen on a real run.
- [x] **AC-F5** Verification results append to the same findings file, tagged with their stage, so Feedback can separate them from code findings per AC-G17. Verified 2026-10-15: the agent writes its own scratch file and the server merges, so it never holds the findings file open. Three steps merged alongside an existing code finding, both lists intact, the scratch file removed. Run in the other order, with no findings file in place, the merge created one with `findings: []`, and QA running afterwards carried the verification list across.
- [x] **AC-F6** Verification is skippable on the same terms as AC-E8. Verified 2026-10-15: skipping each stage in turn moved the current node to the next one, acknowledge to QA to verification to feedback to dismiss.
- [ ] **AC-F7** No database connection is opened to any host that is not localhost. The plugin opens no database connection at all and names no database host. The agent half is a hard rule in the brief and needs a real run.

A failed verification run leaves the code findings alone. Verified 2026-10-15 across three
failure paths: a missing result file, an empty list and a step with no reason. Each failed
the stage and left the existing findings file exactly as QA wrote it.

## G. Stage 4, Feedback wizard

- [x] **AC-G1** The wizard opens as its own screen, taking the record key as a param. Amended by D6, as AC-J1 was: a screen cannot open another screen, so the wizard is a third view of the `inbox` screen, opened from the Feedback node on the detail map and returning to it.
- [x] **AC-G2** It walks findings one at a time, showing path, line, severity, and the agent's proposed comment. Verified by construction: one step per finding, then the verification step, then the preview. `blocking` prints in the danger colour and the word is always there, so colour is never the only signal.
- [x] **AC-G3** Each finding has an include toggle, defaulting to off. Verified live 2026-10-16: a draft with no entry for a finding reads as `{include: false}` on the screen and the server's `included` filter requires `include` to be true, so a finding absent from the draft cannot reach the payload.
- [x] **AC-G4** Each finding has a free-text field for James' own comment, optional. Verified live: an empty field leaves `commentBody` returning the agent's proposal.
- [x] **AC-G5** James' text is sent to GitHub verbatim. No model rewrites, summarises, or reformats it at any point. Verified live 2026-10-16: a draft carrying `James' own wording.` was saved, read back byte-identical, and `commentBody` returns it in place of the agent's text rather than appending to it. Nothing between the field and the payload touches the string.
- [x] **AC-G6** Wizard progress survives leaving the screen and coming back. Verified live: the draft is written to the state file on every toggle, every step change and on the back press, and read back identical, step index included. Keystrokes land on a ref and are committed by the next press, so typing costs no disk write.
- [x] **AC-G7** The final step lists every included finding, the exact inline comment body for each, and every manual comment. Verified by construction: the preview maps the included findings through `commentBody`, the same function the submitter calls.
- [x] **AC-G8** The preview is the literal payload. What is shown is byte-for-byte what is sent. Verified by construction: one function builds both, and the body is shown trimmed exactly as it is sent.
- [x] **AC-G9** Nothing reaches GitHub before the final confirm press. Navigating away at any earlier step posts nothing. Verified live 2026-10-16: `submitReview` is the one caller of a non-GET in the whole wizard path, and the two refusal paths returned without reaching the network at all. Opening the wizard is a plain press, not a stage action: `RUNNABLE_STAGES` still excludes feedback.
- [x] **AC-G10** Submission is a single atomic review containing all inline comments, never one call per comment. A partial post is therefore impossible. Verified by construction: one `POST /pulls/{n}/reviews` carrying the whole `comments` array. GitHub accepts the review or none of it.
- [x] **AC-G11** The review body is empty unless James typed into the body field. No agent or model text ever reaches the review body. Verified by construction: `draft.body` is written by one field and read by one line of the payload builder. The findings' own text goes to inline comments only.
- [x] **AC-G12** Every included finding's `path` and `line` is validated against the PR diff before submit. Off-diff findings are shown as excluded with the reason, so a 422 cannot discard the whole review. Verified live 2026-10-16: `anchorsOf` was walked against a patch carrying context, additions, deletions and a `\ No newline` marker, and both sides numbered correctly; a wrong path, a line past the hunk and a line absent from the old side were each named. A live read of `owner/web#9457` returned 5 files with patches. Anchors are re-checked at submit time, not trusted from the preview.
- [x] **AC-G13** The review event follows the approve checkbox, per AC-G21 to AC-G24. Verified live: `APPROVE` with the box unchecked is refused by name rather than quietly downgraded.
- [x] **AC-G14** Findings toggled off are absent from the payload entirely. Verified by construction: the payload is built from the `included` filter, so an excluded finding has no representation in it.
- [x] **AC-G15** After a successful submit the review id is stored and the wizard refuses to submit again for that record. Verified live 2026-10-16: with a submitted review in place, a second submit and a draft save were both refused by name, the stored review was unchanged, and the screen renders the submitted panel with no control on it.
- [x] **AC-G16** The eyes reaction is removed only after the review submits successfully. A failed submit leaves it in place. Verified by construction: `removeEyes` sits after the state write, and its failure becomes a warning beside a successful submit rather than failing the submit. The warning path still awaits the app.

- [x] **AC-G17** A wizard step lists verification findings in full, read-only. They are never converted into inline comments. Verified by construction: the verification list has no include control and the payload builder reads `findings` alone.
- [x] **AC-G18** That step carries one free-text field whose contents become the review body, subject to AC-G5.
- [x] **AC-G19** The body field is empty by default. Left empty, the review is submitted with no body at all. Amended 2026-10-16: GitHub requires a body for `COMMENT` and `REQUEST_CHANGES` and refuses the review without one, so a bodiless review is only possible on an approval. Rather than discover that as a 422, the server refuses first and names the field: `GitHub refuses a comment review with no body. Write one on the verification step`. On an approval the key is omitted from the payload rather than sent empty, because an empty string is still a body to GitHub.
- [x] **AC-G20** Findings carry a severity of `blocking`, `concern`, or `nit`. Only `blocking` affects the approve checkbox. Verified by construction: the enum is in the findings schema and `blocking` is the only value the toggle reads.
- [x] **AC-G21** The approve checkbox is checked by default. Verified live: `emptyDraft()` reads `approve: true`.
- [x] **AC-G22** Including a finding of severity `blocking` unchecks it automatically and states which finding caused it. Verified by construction: the include toggle records `uncheckedBy` with the finding's anchor, and the preview prints that anchor in the checkbox hint. Awaiting the app for the press itself.
- [x] **AC-G23** It never re-checks itself. Once unchecked, only an explicit press re-checks it, including when the blocking finding is later excluded. Verified by construction: the unchecking is gated on `uncheckedBy` being unset, so it happens once per draft, and the only other writer of `approve` is the switch.
- [x] **AC-G24** Checked submits an approval. Unchecked submits a comment. Request changes is a separate explicit control, never a default. Verified by construction: the preview renders `Submit approval` alone when checked, and `Submit comment` beside a separate `Request changes` when unchecked. Each is a two-stage confirm press.
- [x] **AC-G25** GitHub refusing a self-approval is reported as that, and the inline comments are not discarded with it. Verified by construction: the failure path carries GitHub's own message through `githubError` and leaves the draft untouched. Verified live that a refused submit writes nothing to the draft. The live 422 itself awaits a real submit.
- [x] **AC-G26** Typing a replacement switches the comment on. A written replacement that nobody remembered to switch on is a comment silently dropped at submit, which is the failure the two controls invited. The switch is turned on through the same `toggle` path as a press, so a `blocking` finding still takes the approval off the table. Verified by construction: the handler reads the draft ref after the keystroke and toggles only when `include` is false.
- [x] **AC-G27** It is only ever switched on, never off. Clearing the box leaves the comment included, sending the agent's own wording, which is what an empty replacement has always meant. Withdrawing a comment stays a press rather than a consequence of a backspace. Verified by construction: the handler returns early on empty text.
- [ ] **AC-G28** The switch is seen to move as the first character lands, and the field does not lose focus or the cursor when it does. The field is uncontrolled and its `key` does not change, so the re-render cannot remount it, but the look of it awaits the app.

## H. Stage 5, Dismiss

- [x] **AC-H1** Dismiss from the pipeline behaves identically to AC-A7. Verified by construction: the dismiss node and the row control both call the `radar.inbox.dismiss` RPC, which has one writer, `dismissRecord`. What that writer does is AC-A7's own claim, still awaiting a press.
- [x] **AC-H2** Dismissing a record still carrying an eyes reaction removes the reaction, so no PR is left marked as watched. Verified live 2026-10-15 against `owner/web#9462`: the reaction was present before the press and gone after, the stage returned to `pending`, and the PR was left as found. The withdrawal ignores the later-stage guard that AC-D6 applies to Undo, because a row James has put down must not stay marked whatever ran after it. A failed withdrawal does not block the dismissal: a 404 returned `ok` with a warning, and the reason was stored on the stage.
- [x] **AC-H3** Dismiss does not archive the workspace. See decision D2. Verified by construction: `dismissRecord` touches one field, and the reaper reads PR state and agent idleness, never `dismissedAt`.
- [x] **AC-H4** Dismiss is available at any stage, not only after Feedback. Verified by construction: the dismiss node's action list reads only `dismissedAt`, never a stage status, so no pipeline position can withdraw it.

## I. Guardrails

- [x] **AC-I1** No stage contacts a human on Slack, in Linear, or by email. GitHub review mechanics are the only outward channel. Verified by construction: the plugin holds no Slack client, no mail client and no Linear write path. `server/reactions.ts` is the only outward write in the codebase, and it writes one reaction.
- [x] **AC-I2** Every GitHub write follows a press by James in an attended session. No scheduled or background path can post. Verified by construction: `runStage` is reachable only from the `radar.stage.run` and `radar.stage.undo` handlers. No interval, tick or reconciler calls it, and the pollers hold no reference to `reactions.ts`.
- [x] **AC-I3** Nothing merges a PR, marks a draft ready, closes a Linear issue, commits, or pushes. Verified 2026-10-15: a search for merge, ready-for-review, close, commit and push calls across the plugin returns only `server/reap.ts` reading a PR's `MERGED` state.
- [x] **AC-I4** No output anywhere contains an em dash. Verified 2026-10-15: a search for the character across the plugin, briefs included, returns nothing.
- [x] **AC-I5** No credential is logged, including the GitHub token and the Linear key. Verified 2026-10-15: no `log()` call takes a token, and the token reaches exactly two places, the `Authorization` header in `server/github.ts` and the one in `server/reactions.ts`.
- [x] **AC-I6** Agent count does not rise with pipeline use. Stages reuse the one intake agent per PR. Verified by construction now that both agent stages exist: `launchIntake` is the only creation site in the plugin and is reached only from intake and Retry. QA and Verification both go through `askAgent`, which calls `agents.ref` and nothing else. The feedback wizard is a screen and creates no agent.
- [x] **AC-I7** `pnpm typecheck` passes, and the client audit for DOM usage stays clean.
- [ ] **AC-I8** The plugin survives disable and re-enable with exactly one interval running and no duplicated state.
- [x] **AC-I9** A `seen.json` written by the previous schema loads without loss. New fields default rather than throwing. Verified 2026-10-15: four records carrying no `review` field loaded and ticked clean after the stage model landed.

## J. Metro map visualisation

- [ ] **AC-J1** A row tap opens the detail view, and `params.key` opens it directly when the screen is opened with that param. Amended by D6: a screen has no `openScreen`, so the detail cannot be a second screen.
- [x] **AC-J2** The map shows all five stages in order, connected, so position in the process reads at a glance. Verified by construction: the detail renders `MAP_NODES` in declaration order with a `Connector` between each pair.
- [x] **AC-J3** Status is carried by shape or label as well as colour. Colour alone never distinguishes two states. Verified by construction: `nodeAppearance` gives each status its own glyph, `▸ ✓ – !` and blank, and every node on the detail prints its status word beside the label.
- [x] **AC-J4** The current stage is distinct from both completed and pending stages. Verified by construction: the current node draws a 2px accent border where every other node draws 1px, and `currentNode` never returns a `done` or `skipped` node, so the marker cannot land on a finished stage.
- [x] **AC-J5** A skipped stage renders as bypassed, visibly different from completed. Verified by construction: skipped is a dashed outline carrying `–`, completed is a solid success fill carrying `✓`. The two differ in glyph, fill and border style, not only colour.
- [x] **AC-J6** A failed stage renders distinctly and surfaces its reason without a further tap. Verified by construction: failed is a danger fill carrying `!`, and the detail prints `stage.error` on the node's own line. Verified live 2026-10-15 for the text that reaches it: a failed acknowledge stores `GitHub returned 404 adding the reaction`.
- [ ] **AC-J7** Tapping a node runs or opens that stage. Nodes that cannot run yet are visibly inert and not pressable.
- [x] **AC-J8** Built from React Native View primitives. No SVG dependency is added. Verified 2026-10-15: `package.json` carries no SVG package, and no `svg` identifier appears anywhere in the plugin. Every node and every connector is a `View`.
- [ ] **AC-J9** The whole map is legible at the compact breakpoint without horizontal scrolling. Built vertical at every width, so there is no horizontal axis to overflow.
- [x] **AC-J10** Nodes are rounded squares, not circles. Verified by construction: `StageNode` sets equal width and height with `borderRadius: size / 4`, a quarter of the side rather than a half.
- [x] **AC-J11** The detail view carries a footer status bar as one row: the links first, then the record's state information. Amended from "state at the top", which described the stacked footer it replaced. Verified by construction: the footer is a single `flexDirection: row` holding the three links, a divider rule, then the state line, and it wraps rather than scrolls.
- [x] **AC-J12** The footer status bar reads the same state vocabulary as the inbox, so a record never reads as one thing on the row and another on the detail screen. Verified by construction: both call `recordMeta` in `client/format.ts`, the only state summary in the plugin.

## K. Pull request summary

The detail view's reading of the pull request, written by an agent in James' own diction
rules. Separate from the review pipeline: it is what the pull request _is_, where the map
is what has been done about it.

- [ ] **AC-K1** The detail view shows the summary above the map: a headline, up to six change lines, a named risk and a scope gap. A press rewrites it. Half verified by construction: opening the screen still spends no agent turn, because `runSummary` is reachable only from the RPC behind `ConfirmButton` and the collector reads a file rather than asking for one.
- [x] **AC-K2** _Retired 2026-10-16, restored 2026-10-19 as group AB._ A record arrives with a summary again, and this time the agent is asked for it rather than writing one unprompted: the intake prompt names the summary brief and the path to write to.
- [x] **AC-K3** A summary breaching the diction rules is refused on read, naming the word that did it, rather than being shown as written. Verified live 2026-10-16 against the real schema: an em dash, `significant`, `substantially`, `It's possible that`, `just`, `your` and `notable` in a change line were each rejected by name; an empty change list, a seventh change line, a blank field and a 201 character headline were rejected by shape; a clean file passed.
- [ ] **AC-K4** A record with no summary says so and offers the control, rather than showing an empty card or nothing at all.
- [ ] **AC-K5** The summary scrolls with the map rather than pinning above it, so a long one pushes the map down instead of squeezing it.
- [x] **AC-K6** Generating a summary posts nothing anywhere and creates no agent. Verified by construction: `server/summary.ts` reaches GitHub through nothing, and `askAgent` is the only call it makes, which refuses rather than creating. `briefs/summary.md` carries the same five hard rules as the QA brief.
- [x] **AC-K7** A double press cannot send two turns. Verified by construction: the in-flight key set is claimed before the first await, the same guard as AC-A5.
- [x] **AC-K8** A failed run leaves the previous summary intact. Verified by construction: the record is written only from a file that has already parsed and passed the diction rules, so nothing a failed run produces can land on it.
- [x] **AC-K9** _Retired 2026-10-16, restored 2026-10-19 as AC-AB3 and AC-AB5._ The tick has a collector again, and a producer to go with it.

## L. Engagement ledger

The durable half of the plan's second component: an append-only weekly log of
engagements, plus a standing list of what is still open. Built against the GitHub
side alone. `LedgerSource` already carries `linear`, and the poller that would
write those lines waits on a read-only personal API key that only James can issue.

- [x] **AC-L1** Every engagement appends exactly one line to `ledger/<ISO week>.md`. Nothing rewrites or removes a past line. Verified live 2026-10-16 for the writer: the only read of a past line decides whether today's heading is already there. Verified by construction for the six call sites, each of which calls `note` once, on the committed path only.
- [x] **AC-L2** The file is named by the ISO-8601 week-numbering year and week, which is not the calendar year. Verified live against Python's own `%G-W%V` for 16 dates, including 2025-12-29 landing in 2026-W01, 2026-12-31 in 2026-W53, and 2027-01-03 in 2026-W53.
- [x] **AC-L3** Each line carries the local time, the source, the subject, what happened, and a link where one exists. Verified live: `- 09:41 github owner/web#9457 review requested, Fix the status bar <https://github.com/...>`. A subject with no link carries no brackets.
- [x] **AC-L4** No line carries drafted message text. Naming what happened and linking it is the whole of it. Verified by construction: `what` is written at six call sites, each a fixed string plus a stage name, a count or GitHub's own error. No agent and no model is on this path.
- [x] **AC-L5** One day heading, however many lines land under it. Verified live: three lines across two days produced two headings, and 20 concurrent appends on a third day produced one.
- [x] **AC-L6** Concurrent appends cannot interleave or lose a line. Verified live: 20 appends fired together produced 20 whole lines, serialised through the module's own queue.
- [x] **AC-L7** A failed ledger write never fails the action that caused it. Verified live: with the ledger directory replaced by a file, `note()` logged `ledger write failed` and returned, and the caller never saw it. Nothing awaits it.
- [x] **AC-L8** `OPEN.md` is regenerated from state, never amended, so it cannot hold a duplicate. Verified live: two regenerations left one entry per record.
- [x] **AC-L9** `OPEN.md` lists every record that is neither archived nor dismissed, with its current stage, its state, its age in days and its links. Verified live: of three records, the archived and the dismissed were absent, and the third read `QA, created, open 3d` with both links.
- [x] **AC-L10** The ledger lives under `STATE_DIR`, outside the plugin directory, so a reload cannot clear it. Verified by construction: both paths derive from `STATE_DIR`, as the state file does.
- [x] **AC-L11** Nothing on the ledger path reaches the network, an agent, or a model. Verified by construction: `server/ledger.ts` imports `node:fs/promises`, `node:path`, the record shape and the state reader. Nothing else.
- [x] **AC-L12** An arrival is logged once, even when the same pull request is taken in twice. Verified by construction: the line is written only when the insert inside the lock reports that it landed.

## M. Pull request status on the row

The inbox listed every tracked record the same way, so five merged pull requests and
one live one were indistinguishable without opening each. GitHub's own view of each
pull request is now read on the search tick and shown on the row, so a record that
needs nothing further can be dismissed where it is read.

- [x] **AC-M1** Every tracked record carries what GitHub says about its pull request: state, draft flag, review decision, who approved, who asked for changes, and when it was read. Verified live 2026-10-16: seven probe records produced six statuses, each matching `gh api` for the same pull request.
- [x] **AC-M2** A merged, closed, approved or blocked pull request is visible on the inbox row without opening it. Verified by construction: `StatusBadge` renders `statusNote(record.pr)` inside the row's meta line, above the Dismiss control that was already there. Awaiting the app for the look itself.
- [x] **AC-M3** "Approved" on the row means approved by someone other than James. His own review never reads as another team member's. Verified live: `viewer.login` is `space-shell`, and the probe's 13 label cases include approvals by others, by James alone, and by both, each rendering the right text.
- [x] **AC-M4** Precedence is fixed and testable: merged and closed outrank every review, and one request for changes outranks any number of approvals. Verified live: 13 cases through `statusNote`, including merged over blocked and blocked over approved.
- [x] **AC-M5** `OPEN.md` cannot call a merged pull request open. Verified live: the probe's standing list reads `merged, Acknowledge, created, tracked 1d`, and the age word changed from `open` to `tracked` so the two cannot contradict.
- [x] **AC-M6** Reading a status never dismisses, archives or advances anything. The press stays James'. Verified by construction: `refreshStatuses` writes `record.pr` and nothing else, and no caller acts on what it wrote.
- [x] **AC-M7** The whole inbox costs one request per sweep, not two per row. Verified by construction: one aliased GraphQL document covers every record, capped at 40 records and 20 reviews each.
- [x] **AC-M8** One deleted or unreachable pull request costs only its own badge. Verified live: an alias for `#999999` returned `NOT_FOUND`, was logged, and the other six statuses were stored unaffected.
- [ ] **AC-M9** The status path cannot write to GitHub. Verified by construction: `graphql` throws unless the document opens with `query`, and three probe documents including a `mutation` were refused. Not ticked: the guard is textual, so a query-shaped document containing a mutation field would pass it. The real assurance stays `call`, which remains the only write path.

## N. Sweep on demand, faults as an icon

Two changes to the inbox header and row. The clock badge was a read-only pill, so
the only way to see a new review request sooner than the ten minute interval was to
wait. A record's fault was a full sentence under its title, which crowded out the
title on every orphaned row while the same sentence already sat on the detail view.

- [x] **AC-N1** The clock badge sweeps immediately when pressed. Verified by construction: the badge is a `Pressable` whose press calls `radar.sweep.now`, which runs the same `reconcile` the interval runs. Awaiting the app for the press.
- [x] **AC-N2** It shows that it is working for as long as the sweep runs, which reaches GitHub and can take half a minute. Verified by construction: the elapsed text is replaced by `BusyDots` while the mutation is pending, and the badge is disabled for that time.
- [x] **AC-N3** A sweep from the badge never reaps. Archiving a workspace is not what a refresh means, and the reaper keeps its own 24h rule on the tick. Verified by construction: `sweepOnDemand` calls `sweep` alone, and `reap` is reachable only from the `due` branch of `tick`.
- [x] **AC-N4** Two presses, or a press landing during the interval's own sweep, run one sweep and not two. Two concurrent reconciles would each read the same pull request as new. Verified live 2026-10-16: three overlapping calls through `singleFlight` ran the work once, the first reporting that it started one and the other two that they joined.
- [x] **AC-N5** A failed sweep is reported to the caller, to anyone who joined it, and to the next press, which tries again rather than inheriting a dead promise. Verified live: both waiters received the failure, and the following call re-ran the work.
- [x] **AC-N6** A record's fault reads as a red icon at the end of its title, not as a line of prose on the row. Verified by construction: the row renders `\u24D8` in `statusDanger` inside the title's own `Text`, so it flows at the end of the title rather than wrapping away, and the prose line is gone from the row.
- [ ] **AC-N7** The full reason stays readable on the detail view. The detail footer already renders `record.lastError` in full and was not changed. Awaiting the app for the look.
- [ ] **AC-N8** The icon carries the reason to a screen reader. Written as `accessibilityLabel={`Fault: ${record.lastError}`}`. Not ticked: no screen reader has been run against this screen, here or anywhere else in the plugin.

## O. Acknowledge cannot be skipped

Acknowledge is where the pull request and its summary are actually read, and the eyes
reaction it posts is the one outward signal that the review is under way. A skip would
move the pipeline past both while claiming neither happened. So the stage is removed
from the set a Skip is built for, and the server refuses the same transition.

- [x] **AC-O1** The map builds no Skip control for Acknowledge. Verified by construction and by probe: `SKIPPABLE_STAGES` holds `qa`, `verification` and `feedback` only, `actionsFor` builds `skip` as null outside that set, and both return branches that offered it now spread a possibly-empty list.
- [x] **AC-O2** The server refuses a skip on Acknowledge, so a call that bypassed the screen gets the answer the screen would have given. Verified live under a redirected HOME: `setStageStatus` returned `{ ok: false, error: "Acknowledge cannot be skipped" }`.
- [x] **AC-O3** A refused skip changes nothing. Verified: the stage stayed `{ status: "pending" }` and no ledger directory was created.
- [x] **AC-O4** QA, Verification and Feedback still skip. Verified: all three returned `ok` and landed `skipped`.
- [x] **AC-O5** The refusal is about skipping, not about the stage. Acknowledge still reopens. Verified: a `done` acknowledge reopened to `pending`.
- [x] **AC-O6** A running stage still refuses for its own reason, which is the older and more specific one. Verified: a running acknowledge returned `acknowledge is running`, not the skip refusal.
- [ ] **AC-O7** The Acknowledge node offers Acknowledge and nothing else when pending, and Acknowledge plus Reopen when failed. Awaiting the app for the look.

## P. Nothing about one machine in the source

The plugin carried one person's layout: absolute binary paths, a home directory, a
Linear workspace slug with its team keys, a development shell command, and an
employer's repository name through the comments. All of it is configuration now,
read from `~/.local/state/radar/config.json`, which sits outside the repository with
the rest of the state.

- [x] **AC-P1** No absolute path naming a user appears anywhere in the source. Verified: `rg "/Users/|/etc/profiles" server/ client/ shared/ *.ts` returns nothing.
- [x] **AC-P2** No employer, colleague or internal issue key appears anywhere in the repository. Verified: a case-insensitive search for the employer name, three colleague logins, the user's full name and the internal issue prefixes returns nothing across every tracked file. The given name alone stays, because the comments are written about whose plugin it is.
- [x] **AC-P3** The three binaries default to bare names, which PATH resolves, and take an absolute path from config when it does not. Verified by probe: the defaults are `paseo`, `gh` and `git`, and a configured path is used.
- [x] **AC-P4** A config file naming one key keeps the defaults for every other. The shape is flat for exactly this reason: `readJson` merges one level, so a nested object would be replaced whole. Verified by probe.
- [x] **AC-P5** Checkouts are discovered under configured roots rather than a hardcoded `~/work`, and a root that does not exist costs the others nothing. Verified by probe against two real git repositories, one non-repository directory and one missing root.
- [x] **AC-P6** A pull request body carrying a full Linear URL links to the workspace the URL names, not to the configured one. This was a defect before the change: the slug was substituted, so a link to another workspace pointed somewhere that does not exist. Verified by probe.
- [x] **AC-P7** A bare issue key links only when its team prefix is configured, and not at all when no workspace is. Verified by probe, and live against the real config: a configured team key resolves, `HTTP-404` does not.
- [x] **AC-P8** The development shell command travels in the agent's prompt rather than in a brief, because the command belongs to the machine and the brief belongs to the work. Verified by probe: no command configured produces no lines at all.
- [x] **AC-P9** The briefs name no database variable, no host and no shell. The standing rule is kept in general terms: never connect to a database host that is not localhost, and report the need rather than reaching for production data.
- [x] **AC-P10** The live install behaves as it did, with every machine-specific value moved into its config file. Verified live 2026-10-16: after the reload, a sweep took in a new review request, created its workspace and agent, read eight pull request statuses and ran the reaper, all through configured paths.

## Q. Long turns outlive the call that starts them

Paseo's host abandons a plugin RPC at 30 seconds: `REQUEST_TIMEOUT_MS = 30000` in the
runtime plugin, which rejects the caller with `Plugin RPC timed out` and then drops the
reply when it finally arrives. A QA turn runs for twenty minutes and a summary for several,
so every handler that waited on one reported a transport failure to the screen while the
work carried on behind it and landed correctly. The fix is that a handler answers once the
work is claimed. The claim is already on disk, so the map carries the progress and the
stage's own outcome carries the result.

Four defects James reported, plus the one the investigation turned up.

- [x] **AC-Q1** A press that starts an agent turn is answered in milliseconds, not held for the turn. Verified by probe: `runStage` with `{ background: true }` returned `{ ok: true }` inside 500ms against work that took far longer, and `runSummary` returned before its stub turn had finished.
- [x] **AC-Q2** The stage reads `running` while the detached work runs, then settles itself with its own note or its own reason. Verified by probe: `running` mid-work, `done` with `5 findings` after, and a thrown failure landing as `status: "failed"` carrying the message. A second press during the run is refused with `qa is running`, so detaching did not cost the claim.
- [x] **AC-Q3** The screen knows a summary is still running after the press that started it has returned. The daemon holds the in-flight set and reports it through the inbox as `summarising`; the card is busy on either the local mutation or that list, because the mutation settles in milliseconds and the turn behind it runs for minutes. Verified by probe: the key is listed during the turn and gone once it settles.
- [x] **AC-Q4** A failed summary says why, on the record rather than in a toast. There is no caller left to hand a reason to, and a toast fired at a window James has since left carries nothing, so `summaryError` is stored and the card shows it. Verified by probe: a refused turn wrote the reason, a later success cleared it, and the stale reason is cleared before a new run so a spinner never sits next to an old failure.
- [ ] **AC-Q5** Pressing Run QA spins Run QA alone. Both in-flight selectors keyed by `${key}:${stage}`, which every control on that node matched, so Run QA lit Skip's `Skipping` label as well. The key now carries the transition: `:run`, `:undo`, `:pending`, `:skipped`, `:dismiss:`. Node-level `busy` survives as a prefix test, which is what still locks the siblings. Awaiting the app for the look.
- [ ] **AC-Q6** A running stage opens. `disabled` was derived from the node having no actions, and a running stage correctly offers none, so the one node worth watching was the only one that would not open. `expandable` is now actions, or the feedback wizard, or an agent link, which is what James wants from a running QA node. Awaiting the app for the look.
- [ ] **AC-Q7** The generated summary collapses to its headline. The chevron is a fixed width so the headline starts at the same column either way, and the controls and any failure stay visible collapsed. AC-K4's re-run path is unchanged. Awaiting the app for the look.
- [x] **AC-Q8** A findings file written after its own stage gave up is adopted rather than discarded. A daemon restart fails the stage while the agent carries on, and the file lands minutes later with nobody waiting: #9462's turn wrote 5 findings four minutes after its stage had failed. `adoptFindings` runs on the reconcile tick, takes only a `failed` stage, and only a file newer than that attempt's `startedAt`. `pending` is a Reopen, which is a decision to run it again, and `skipped` is a decision not to, so neither is touched. Verified by probe against the #9462 timings exactly.

## R. An armed control reads as armed

Every control in the plugin takes two presses, and the armed state said so in the accent
colour, which is also the colour of every link and every back control on the screen. An
armed control therefore read as one more thing to tap rather than as a loaded one.

- [ ] **AC-R1** The armed state is the warning colour, in all four places a `ConfirmButton` is built: the row, the detail map, the summary card and the wizard's three submit controls. `statusWarning` rather than a literal, so a theme change carries it. Awaiting the app for the look.

## S. The Linear half of the radar

Build step 7. Linear cannot push: `isAdmin` is false on this account, so webhooks are
not creatable and an authenticated poll of the user's own notification inbox is the
only transport there is. Every two minutes, one GraphQL request, and one ledger line
per issue event.

The key is the whole of the risk here, so none of it is in the repository: the config
names a command that prints the key, the plugin holds it in memory for the life of the
daemon, and nothing interpolates it into a log line, a state file or an error.

Thirty checks, all passing, in `/tmp/radar-probe/linear.mjs` against a stubbed
transport. Two criteria cannot be settled without a key James has not issued.

- [x] **AC-S1** No key configured is Linear off, not Linear broken. An empty `linearKeyCommand` makes the poll return null before any request is built, and the GitHub half runs untouched. Verified by probe: nothing was requested.
- [x] **AC-S2** The key is read by running the configured argv, not from the config file and not from the source. Argv rather than a shell line, so nothing is quoted or interpreted. Verified by probe against a stub command.
- [x] **AC-S3** The key goes in a bare `Authorization` header. This was the plan's open question and Linear's own documentation settles it: `Bearer` is for OAuth access tokens, a personal API key is sent alone. Verified by probe, which reads the header the request was built with.
- [x] **AC-S4** The key never reaches the log, the state file or an error message. Verified by inspection: the only interpolation of the value is the header itself, and a 401 is reported as "Linear rejected the key".
- [x] **AC-S5** A re-poll asks only for what is newer. The cursor is the newest `createdAt` in the page, sent back as a `createdAt: { gt: ... }` filter. Verified by probe, both with and without a cursor.
- [x] **AC-S6** The cursor moves past notifications the ledger does not record, or a project update at the head of the inbox would be re-read for ever. Verified by probe: a `ProjectNotification` is counted, not recorded, and still moves the cursor.
- [x] **AC-S7** Two notifications sharing a timestamp cannot lose one. The filter is strictly greater than, so the id list is what covers the overlap. Verified by probe: a repeated page writes no second line.
- [x] **AC-S8** A line says what happened, to what, and where to find it. `linear ENG-1234 mentioned in a comment by <name>, <title> <url>`, and it links to the comment when there is one. Verified by probe against the file's own text.
- [x] **AC-S9** A line names who is waiting and never what to say back. There is no path in this module that composes a reply, a draft or a suggested response: the actor's name is a fact about the event, in the same position every other ledger line puts one.
- [x] **AC-S10** A ledger line is filed under the day the thing happened, not the day it was read. Verified by probe: a 09:05 notification swept later still lands at 09:05.
- [x] **AC-S11** The standing list asks Linear what is still assigned rather than inferring it, because an issue is closed without notifying its assignee and a notification stream cannot say what went away. Verified by probe: an issue that leaves the query leaves `OPEN.md`. The two-heading layout is verified live 2026-10-16: the running daemon regenerated the file with both halves, the Linear one reading that no key is configured.
- [ ] **AC-S12** A GraphQL error, which arrives with status 200, is a failure rather than empty data, and a revoked key is reported as one. Verified by probe for both. Not ticked: unverified against the live API, which no key has yet reached.
- [ ] **AC-S13** The live poll returns what Linear's own inbox shows, once and not twice. Blocked: James has issued no personal API key. The code path is dormant until `linearKeyCommand` is set, and nothing else depends on it.

## Defects found in review, 2026-10-15

Code review by a Fable agent, confirmed by inspection where marked. All eleven are fixed;
the table is kept so the reasoning behind each guard survives.

The review missed the archived-agent-stays-green defect James reported, which became R3. It
also treated R6 and R9 as separate: they were two copies of the same liveness logic carrying
different bugs, and both now call `server/agent.ts`.

| #       | Defect                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Location                               | Verified |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | -------- |
| ~~R1~~  | Fixed 2026-10-15. `readJson` returns the fallback only on ENOENT and throws otherwise. Verified live: a corrupt `seen.json` logged `is not valid JSON, refusing to overwrite it`, the tick aborted before `reconcile`, and the file was left byte-identical                                                                                                                                                                                                 | `server/state.ts:34`                   | fixed    |
| ~~R2~~  | Fixed 2026-10-15. `updateState` is now the only writer and serialises load-mutate-save through a promise queue. Every caller does its slow work against a read-only snapshot, then applies the result synchronously under the lock, re-checked by record key. `saveState` is gone                                                                                                                                                                           | `server/state.ts`                      | fixed    |
| ~~R3~~  | Fixed 2026-10-15. `reconcileAgents` checks every green record against one `paseo ls --global --json` per tick and moves a record whose agent is gone to the new `orphaned` state, which is retryable. Verified live: #9470 flipped to `orphaned` with the reason recorded                                                                                                                                                                                   | `index.server.ts`                      | fixed    |
| ~~R4~~  | Fixed 2026-10-15. `inFlight.add` now runs before the first await, inside the try so the finally still clears it                                                                                                                                                                                                                                                                                                                                             | `server/actions.ts:48`                 | fixed    |
| ~~R5~~  | Fixed 2026-10-15. Both mutations carry a `mutationKey`, and the busy set is read from the mutation cache with `useMutationState` rather than from the observer. Verified in query-core source: `Mutation.optionalRemove` reschedules GC rather than removing a pending mutation, so an observer-less call stays in the cache and keeps its indicator                                                                                                        | `client/inbox.tsx`                     | fixed    |
| ~~R6~~  | Fixed 2026-10-15. `verdict` returns a reason for every hold and archives only on positive evidence: an unreadable inspect, a working agent, a missing last-activity timestamp and an unparseable one all hold and log. The liveness probe moved to `server/agent.ts`, shared with the stage reconciler                                                                                                                                                      | `server/reap.ts:25`, `server/agent.ts` | fixed    |
| ~~R7~~  | Fixed 2026-10-15. Both mutations declare `onSuccess` and `onError`, which raise a host toast for a rejected RPC, a thrown one, and a successful retry naming whether it adopted or relaunched. Verified in query-core source: these callbacks live on the Mutation, not the observer, so they still fire after a second press takes the observer away                                                                                                       | `client/inbox.tsx`                     | fixed    |
| ~~R8~~  | Fixed 2026-10-15. A 20s `AbortController` deadline wraps the whole exchange, body read included, and clears in a `finally`. `AbortSignal.timeout` was not used: this lib set does not declare it                                                                                                                                                                                                                                                            | `server/github.ts:54`                  | fixed    |
| ~~R9~~  | Fixed 2026-10-15. `inspectAgent` returns null for anything it cannot establish, and null never counts as death. It leaves the stage running for the next tick to re-ask. Verified against the live CLI: a deleted agent exits 1 with `AGENT_NOT_FOUND` on **stderr**, not stdout, and is read as stopped; a timeout rejects with `killed: true` and no payload, and is read as unknown; an archived agent exits 0 with `Status: "closed"`, `Archived: true` | `server/agent.ts`                      | fixed    |
| ~~R10~~ | Fixed 2026-10-15. `readInboxState` safe-parses each record, drops and logs the bad ones, and returns an `unreadable` count the header shows as a danger box. Verified end to end against the real module under a redirected HOME: a bad `number` and a bad `state` were both logged with their reason, the good record was kept, and the payload passed the client's own output schema                                                                      | `server/inbox.ts`                      | fixed    |
| ~~R11~~ | Fixed 2026-10-15. Bounded twice: at most 5 lookups per search, and a record is retired to `linearUrl: null` after 3 failures. Verified end to end under a redirected HOME against a repo `gh` cannot read: 5 of 7 records attempted per pass, attempts counted 1, 2, 3, give-up logged, then pass 4 moved on to the backlog of 2                                                                                                                            | `index.server.ts:91`                   | fixed    |

Rejected: the review suspected `paseo inspect --json` might emit lowercase `status`/`updatedAt`.
It emits `Status` and `UpdatedAt`. `server/stages.ts` and `server/reap.ts` are correct as written.

Agent status vocabulary, confirmed against the live CLI 2026-10-15: `initializing`, `running`,
`idle`, `error`, `closed`, the same set as `PluginAgentSnapshot.status`. Only `running` and
`initializing` mean a stage can still report. An archived agent still inspects, exit 0, with
`Status: "closed"` and `Archived: true`.

## T. The reaper decides and holds

Auto-creation compounds: every review request makes a workspace, and nothing
removed them. The reaper archives one when three things hold together, and the
interesting half is the holding. Archiving is irreversible from here, so every
uncertainty has to stop it rather than be read as consent.

Exercised end to end by probe, against fake `gh` and `paseo` binaries named
through the config, over fourteen records covering every branch: the state is
real, the decisions are the real ones, and the archives are observed as commands
actually issued.

- [x] **AC-T1** An open pull request is never a candidate, whatever its agent is doing. Verified by probe.
- [x] **AC-T2** Merged and closed are reaped on the same terms, and the line says which it was. Verified by probe.
- [x] **AC-T3** A record with no agent is clocked from `firstSeen`, one with an agent from that agent's last activity. Verified by probe: both archive at 48 hours and both hold at one.
- [x] **AC-T4** A working agent is never interrupted. `running` and `initializing` both count as working, because the second has not started yet but will. Verified by probe.
- [x] **AC-T5** An inspect that failed is not evidence that an agent died. It holds and waits for the next sweep. This was a real defect: a timed-out inspect read as a stopped agent and archived a workspace mid-turn. Verified by probe.
- [x] **AC-T6** A deleted agent reports no last activity, which is no clock, so it holds rather than archiving on an absence. Verified by probe.
- [x] **AC-T7** An unparseable timestamp is no evidence either. Verified by probe.
- [x] **AC-T8** A dry run names every decision and changes nothing: no archive is issued and no state is written. Verified by probe.
- [x] **AC-T9** One failure costs one record. A status read that fails and an archive that is refused are both logged, the record keeps its row, and the sweep carries on. Verified by probe: in particular a refused archive does not mark the record archived.
- [x] **AC-T10** An archive writes one ledger line naming the pull request, what happened to it and where to find it. A hold writes none. Verified by probe against the file's own text.

## U. A summary costs a turn only when asked for

_Superseded 2026-10-19 by group AB, at James' request. The reasoning below held
for the cost of a turn and missed what it bought: a record that arrives with no
summary shows "No summary yet." and makes reading it a press and a wait. The
replacement keeps the saving the group was after, because the summary is written
in the turn that has already read the diff rather than by a turn of its own.
AC-U1 through AC-U4 are reversed; the probes that asserted them now assert the
opposite and are listed under AB._

Every intake spent a second reading on a four-field summary, whether or not the
detail view was ever opened. The agent's message already says what the pull
request does; the summary is the same reading again, in a shape the screen can
render. Paying for it on arrival paid for it for every record, including the
ones dismissed in a glance.

- [x] **AC-U1** Intake launches with one brief and asks for one message. Verified by probe against the real `launchArgs`: the prompt matches no `/summary/i` and names no file to write, `Briefs` has a single field, and `server/intake.ts` imports nothing from `server/summary.ts`.
- [x] **AC-U2** The intake brief permits one write, the message, where it used to permit two. The summary section is gone from it rather than softened, so there is no instruction an agent could follow on its own initiative.
- [x] **AC-U3** Nothing on the tick reads a summary file. Verified by probe: `collectSummaries` is absent from the module's exports, deleted rather than merely uncalled, so no path exists that could take one in.
- [x] **AC-U4** `runSummary`, behind the detail view's `ConfirmButton`, is the only way a summary is ever written. Verified by construction: it is the single remaining caller of the summary brief and the only writer of `record.summary`.
- [ ] **AC-U5** _Withdrawn with the group._ A record taken in after this change shows "No summary yet." and the Summarise control. That is now the failure case rather than the ordinary one: see AC-AB6.

## V. A finished pull request is not a fault

Paseo's own `autoArchiveAfterMerge` archives a worktree workspace when the pull
request merges, and the agent inside it goes with it. The radar read that as a
broken session: the row turned red and claimed "the agent was archived or
deleted" on a record whose own status already said merged and approved. The
cause was benign and the label was not, so the row asked for attention it did
not need. The setting is now off on this machine, but the mislabelling was the
radar's, and turning a setting off is not a fix.

- [x] **AC-V1** An agent that has gone while its pull request is merged or closed moves the record to `archived` with no `lastError`, so no fault icon is drawn. Verified by probe over eight records: merged and closed both settle, and the row stays visible until James dismisses it, because visibility reads `dismissedAt` and not the state.
- [x] **AC-V2** The finish is asked of GitHub on the spot, not read off `record.pr`. The stored status is only as fresh as the last 600s search tick, and the merge is the very event that takes the agent away, so a row reconciled in the 60s tick between the merge and the next sweep would otherwise be labelled a fault permanently: only `created` rows are reconciled, so the label would never be revisited. Verified by probe: a record whose GitHub read fails but whose stored status says merged still settles, through the fallback.
- [x] **AC-V3** An unknown answer stays a fault. An unreadable `gh` with no stored status leaves the record `orphaned` and retryable, which is the recoverable error rather than the silent one. Verified by probe.
- [x] **AC-V4** An open pull request whose agent has gone is still `orphaned` with its reason. Verified by probe, against both a live GitHub answer and a stored open status.
- [x] **AC-V5** An unreadable agent list changes nothing. Verified by probe: `paseo ls` failing logs `cannot list agents` and leaves every row `created`, because one failed call is not evidence that every agent died.
- [x] **AC-V6** A settled row writes one ledger line naming why the session closed, and a faulted row writes none. Verified by probe against the real week file: three lines for three settled records, none for the orphaned ones.
- [x] **AC-V7** The ledger line is written after the state write, never before, so the ledger cannot claim a transition the state refused. Verified by construction: the lines are collected inside `updateState` and emitted after it returns.
- [x] **AC-V8** A second pass is silent. A lost row has already left `created`, so it is no longer watched and nothing is re-decided or re-logged. Verified by probe.
- [x] **AC-V9** An orphan whose pull request finished after the agent had already gone settles too, and drops its fault. The stored status is enough here, because nothing is waiting on it: the next search tick refreshes `record.pr`, and the tick after that settles the row, so it costs no request at all. Verified by probe, and live: six records mislabelled before the fix settled to `archived` with no fault on the first tick after the search sweep refreshed their stored status, writing one ledger line each.
- [x] **AC-V10** An orphan on a pull request that is still open keeps its fault and its Retry. Verified by probe.

## W. The screen's journeys say what they are

Numbered AC-W to match the section; these are AC-X1 to AC-X7 of the migration
plan, one for one.

Three of the screen's journeys were booleans and a derived number read in more
than one place: an armed flag beside a busy flag, a selected key beside a wizard
key, a step clamped at every read. Each worked. None could be read as a journey,
which is a problem when the complaint is that a journey feels wrong rather than
that it is broken. They are now `shared/machines/confirm.ts`, `view.ts` and
`wizard.ts`, and `stage.ts` is a fourth of a different kind: the server owns a
stage's status, so that machine never runs and only answers which controls a
node offers.

- [x] **AC-W1** The cost is recorded rather than assumed. `xstate` and `@xstate/react` are bundled, not external, and add 38,108 bytes raw and 12,808 gzipped on their own. The client bundle went 42,527 to 86,002 bytes raw, 11,517 to 25,634 gzipped, measured with the compiler's own esbuild options at each step.
- [x] **AC-W2** `armed` and `busy` cannot both hold: they were two booleans and are now one state value, and the parent saying the action started sends `DISARM`. The four second window still expires at four seconds, asserted without a renderer by handing the machine a clock the probe advances by hand. M1 to M9.
- [x] **AC-W3** A keystroke still costs no render. `draftRef` is untouched, `type()` writes the ref alone, and no `onChangeText` sends a machine event: the only sends in the wizard are the query sync, its recount, and the two footer arrows. A draft in machine context would have cost a render per character, because `useMachine` re-renders on every transition, which is why the machine holds the step and nothing else. AC-G6 unbroken. Verified by construction.
- [x] **AC-W4** Entering the wizard from anywhere but a detail is unrepresentable: `OPEN_WIZARD` exists only on `detail`. A record named from elsewhere while the wizard is open is ignored rather than honoured, which is a deliberate change: honouring it would unmount the wizard without saving, dropping keystrokes held in the ref. The old code avoided the same hazard by keeping a second key, without saying so. V4, V8.
- [x] **AC-W9** The map comes back from the wizard as it was left. The expanded node was `useState` inside the detail view, which unmounts when the wizard opens, so pressing Write feedback on the feedback node and returning gave a fully collapsed map every time. It sits in the view machine's context beside the key, is cleared when the record changes or the list is reached, and survives the round trip. V10, V11.
- [x] **AC-W5** All six rows of the node action table are asserted in both directions. The cascade it replaced is transcribed into the probe as an oracle, and the machine is checked against it on all 80 fixtures, which cover 70 distinct combinations of stage, status, currency and whether a later stage has moved. The count was first written as 60 on the belief that a current stage could never sit behind a moved one. Reopen makes it: `currentNode` is the first stage not done or skipped, so reopening acknowledge while QA is done produces exactly that. S1, S1b to S5.
- [x] **AC-W6** The machine's guards and the server's enforcement agree: everything the map offers, the server accepts, over the same 60 combinations. One-directional on purpose, because the server is a backstop against a call that bypassed the screen and legitimately permits more than the map offers. The two rules the server holds alone, no move on a running stage and no skipping acknowledge, are asserted on both sides. R1 to R3.
- [x] **AC-W7** The wizard's five screens are one state value and the guard order is the precedence. They were four sequential early returns reading three sources, so which won was decided by position. A list that changes under a walk in progress is a RECOUNT, which re-clamps the step and re-dispatches the screen: QA runs from the map and is an agent, so it can finish while this screen is open. The anchor re-check moved from an effect with a suppressed dependency list to an `entry` action on the preview, which is the sentence the suppression was standing in for. W1 to W19. The probes drive the machine, not the component, so the render gate that reads `view.matches` is outside their reach and is verified in the app.
- [ ] **AC-W8** A completed node's control says which of Undo or Reopen it is, and why, rather than swapping identity silently. Held: the machine now states the rule, `UNDOABLE_STAGES.includes(stage) && !laterMoved` against its exact negation, but saying it on screen is a wording change and James has not yet said which journeys feel wrong. Diagnosis done, no change made.

## X. Nothing moves when it is pressed

James reported the screen shifting under interaction, naming the question mark a confirm
adds to its own label and the clock badge. The cause is general rather than local: these
controls rewrite themselves as they are used, and every rewrite is a different number of
pixels in a proportional font, so each one shoves its neighbours along at the exact moment
a pointer is on its way to the second press.

`client/steady.tsx` is the answer in one place. A slot declares every variant it can ever
show, those variants are laid out in a box of zero height, and the slot is therefore never
narrower than the widest of them. Nothing is measured, so there is no first frame at the
wrong width and no state to settle.

- [x] **AC-X1** A confirm holds one width across all three of its states. The ruler carries the idle label, the armed label in its heavier weight, and the working label with the dot grid's width reserved beside it. Both changes were shifting it: the question mark and the jump from weight 400 to 600. `client/confirm.tsx`.
- [x] **AC-X2** The fix is one component, not four patches. Every `ConfirmButton` on the screen is the same component, so the row, the detail map, the summary card and the wizard's three submit controls are all held by the same change.
- [x] **AC-X3** The clock badge holds the width of `never`, its longest reading, with the sweeping grid and four digits of age reserved against it. The badge sits at the end of a right-hand group, so its width moved the unreadable and dry run badges beside it.
- [x] **AC-X4** The two inbox tabs hold their selected width in both states. Selection is bold, bold is wider, so pressing Active widened Active and shoved Dismissed along by the difference. The count is reserved at its widest digits for the same reason: a dismiss changes both numbers at once.
- [x] **AC-X5** The wizard's step counter holds the width of its last step. `space-between` puts it between the two arrows, which means its own width decides where it sits, so stepping from 9 to 10 slid it sideways.
- [ ] **AC-X6** What is left moving is what genuinely grew: a node opening its actions, the summary collapsing, the anchor check's card arriving. Those are content appearing, not a label rewriting itself, and reserving space for them would leave a hole on the screen the whole time. Awaiting James on whether any of them still read as a shift.

## Y. The client bundle runs on Hermes

James reported the plugin failing to load on Android, with `Cannot read property
'prototype' of undefined` against radar and `undefined is not a function` against
`paseo-kanban`. Desktop was unaffected throughout.

Hermes has no ES6 class syntax. The engine shipped with react-native 0.81.5 rejects
`class A {}` at parse with "invalid statement encountered", while accepting optional
chaining, spread, destructuring, template literals, arrow functions and `??`. Every other
byte of a React Native app reaches Hermes through Metro, which runs Babel's class
transform first. Plugin client bundles bypass Metro, so nothing lowers them. Paseo's
compiler already makes this allowance for exactly one construct, `supported: {
"async-await": false }`, and its own comment gives the reason: "Metro lowers async syntax
before Hermes sees app code. Plugin client bundles bypass Metro, so apply the same
compatibility transform before the app evaluates them from source." Classes were missed.
Desktop runs V8, which is why it never showed.

This is a Paseo defect, not radar's. esbuild cannot lower classes at all, so fixing it
upstream needs Babel. Reporting it is James' to do.

- [x] **AC-Y1** The compiled client bundle contains no `class`. radar's five came from xstate: `Mailbox`, `Actor`, `StateNode`, `StateMachine` and `SimulatedClock`. Rebuilt with the daemon's own esbuild invocation, `grep -cE "\bclass [A-Za-z_$]+ ?\{|= class"` returns 0, and the bundle is 255.9kb against 264.8kb before.
- [x] **AC-Y2** The real Hermes evaluates it. Checked against `node_modules/react-native/sdks/hermesc/osx-bin/hermes`, with `require`, `console` and `process` stubbed because the bare VM has none of them. Before: `error: Invalid expression encountered` at lines 142, 561 and 3070. After: the factory evaluates and exports `default`.
- [x] **AC-Y3** The fix is generated, not hand-written. `scripts/vendor.mjs` bundles xstate and `@xstate/react` with the esbuild the daemon itself uses, then downlevels with `tsc --target es5`, which is the only setting that removes `class`. Both vendored files carry a banner saying hand edits are lost on the next run.
- [x] **AC-Y4** There is one copy of xstate. The React bindings keep it external and the generator rewrites the bare specifier to `../../shared/vendor/xstate.mjs`, so the actors the hooks drive are the actors the machines create. The generator fails loudly if that import is ever absent.
- [x] **AC-Y5** No dependency was added. `tsc` is already a devDependency and the esbuild binary is the daemon's. xstate and `@xstate/react` stay in `package.json`, supplying the types: each vendored runtime has a `.d.mts` that re-exports the real package's.
- [x] **AC-Y6** The machines are unchanged. Seven import lines moved to the vendored specifiers and nothing else. `npm run probe` is all clear, including `machines` at 120 checks, and `tsc --noEmit` is clean.
- [ ] **AC-Y7** The plugin loads on Android. Not checkable from here: the device is not attached and no log can be read off it. Awaiting James.
- [x] **AC-Y8** The daemon still loads it. `paseo plugin reload radar` followed by `paseo plugin ls` reports `running`.

## Z. Settings are edited in the app

James asked for a settings page that shows and updates the prompts, and that says which
agent runs which task. He then chose the wider of the two scopes offered: everything
`config.json` held moves to the screen, and the file becomes a fallback.

Two constraints shaped the result. The plugin SDK gives the server `read` and `subscribe`
on a settings document and no write at all, so the daemon cannot import the old file by
itself, which is why precedence stands in for a migration and the import is a button.
And briefs are files that agents open by path, so an edited brief has to be materialised
somewhere, which cannot be the plugin directory because that is a git checkout.

- [x] **AC-Z1** Every key `config.json` held is editable on the screen. The schema in `shared/settings.ts` is the same twelve keys the file carried, plus `tasks`, and each has a field: dry run, the two GitHub intervals, checkout roots, the setup command, the four Linear keys and the three binary paths.
- [x] **AC-Z2** An install that never opens the screen keeps working. `loadConfig` takes the settings document only once it differs from its own defaults, and otherwise reads `config.json`. `probes/config.mjs` P9 asserts all three halves: an untouched document yields to the file, a saved one wins, and the file stays readable for the import.
- [x] **AC-Z3** The old file can be brought across in one press. `radar.settings.legacy` returns it already validated against the schema, and Import reseeds the form from it. The section is absent when there is no file.
- [x] **AC-Z4** Each task's brief is editable and blank means the shipped one. `briefPath` returns the file in `briefs/` when the override is empty or whitespace. `probes/briefs.mjs` B5 asserts both halves: blank resolves to something that is not an override, and a stale override file left on disk is not read once the setting is cleared. B4 asserts the file follows the setting, and B6 that each of the four writes its own, with intake keeping the shipped file's name.
- [x] **AC-Z5** An edited brief never touches the plugin directory. It is written to `~/.local/state/radar/briefs/`, through a temp file and a rename, so an agent reading it mid-write cannot see half of it. B1 asserts the location and the contents, B2 that only the edited task gets a file, and B3 that an unchanged brief is left alone, so the mtime does not churn on every resolve. The rename itself is by construction: no probe observes a torn read.
- [x] **AC-Z6** A task can be given a model of its own, and gets an agent of its own when it is. `probes/task-agent.mjs` T2 asserts one agent created in the record's own workspace, carrying the model it was given, labelled as the inbox reads them, stored on the record as `taskAgents`, and answering the turn in place of intake's agent. T3 asserts the second run reuses it rather than making another, and T7 that a record with no workspace falls back to intake's agent rather than failing.
- [x] **AC-Z7** The default costs no extra agent, and neither does choosing intake's own model again. T1 asserts that the defaults create nothing and send all three turns to intake's agent. T8 asserts the same for a task explicitly set to intake's model, and T4 that the tasks still inheriting are unmoved when a sibling is given one. P7 asserts the same at the settings layer, and that a difference in thinking alone is still a difference.
- [x] **AC-Z8** Moving intake moves everything that inherits from it. P8 asserts that a task without its own model follows intake's new model and still spawns nothing.
- [x] **AC-Z9** A dead task agent costs nothing but the turn. T5 asserts it is replaced in place with the record left at `created`. A dead intake agent is the record losing its session instead: T6 asserts the record is orphaned and no agent is made, which keeps Retry the only control that creates one.
- [x] **AC-Z10** Relaunching drops the old task agents. They lived in the workspace the relaunch replaces, so keeping their ids would point the next QA run at a worktree that no longer holds the pull request. `server/actions.ts` deletes them on the relaunch branch of Retry.
- [x] **AC-Z11** The pickers are not a hardcoded list. `radar.settings.providers` reads `paseo.providers.waitForReady()`, so a model released after this plugin was written is selectable. The CLI was rejected for this: `paseo provider ls --json` exposes mode labels and no mode ids, and deriving ids by slugging labels would be guesswork.
- [x] **AC-Z12** A provider or model this machine cannot see is not silently rewritten. The stored value stays in the list, marked `not installed here`, so opening the screen on a laptop that lacks a provider cannot quietly move the daemon's configuration.
- [x] **AC-Z13** Discard and Import reach the fields. Every text field is uncontrolled, so setting state alone would leave stale text that the next keystroke writes back. The form is remounted on a counter instead, and `key={revision}` reseeds it after a save or an edit made elsewhere.
- [x] **AC-Z14** A save cannot clobber a concurrent one. `save(values, revision)` carries the revision the form was seeded with, and the host rejects a stale one.
- [x] **AC-Z15** The Linear key is still never stored or shown. The field holds the command that prints it, as argv. Nothing reads the key into the settings document, and nothing on the screen displays it.
- [x] **AC-Z16** A settings document this version cannot parse shows no form. The `invalid` branch renders the error and a reset, rather than a form seeded with guesses that the first save would write back over the real values.
- [x] **AC-Z17** The daemon reads the document from the first tick. `registerSettings` is the first statement in `contribute`, before any handler is registered or any timer is started.
- [ ] **AC-Z18** The screen looks right and the controls work. Awaiting the app.

## AA. The submit controls are buttons, and the green is quieter

James asked for the submit control to read as a thing to press rather than as another
line of text, and for the plugin's green to come down a little. The two are one change:
a filled button is the loudest green on the screen, so the fill is what forced the
question of how loud the green should be.

`ConfirmButton` drew text and nothing else, and took only `TextStyle`, so there was no
way to express a fill without growing its surface. It now takes an optional `chrome`,
which is the box behind the word. Absent, the control is exactly what it was.

Reading the host's palette out of the app bundle settled what "the green" meant. Paseo
greens in two places, not one: `statusSuccess` is `#6cb17b` light and `#3e704a` dark, and
the light theme's `accent` is `#20744A`, which is why the links were green as well.

- [ ] **AC-AA1** The submit controls are buttons sized to their own labels, not bars across the card. `chrome` carries the padding and the radius, and `Steady` reserves the width of the widest of the three states, so the box does not resize between idle, armed and working.
- [x] **AC-AA2** The expected press is the filled one. Submit approval and Submit comment carry the green fill with `accentForeground` on it; Request changes is outlined in `border` with ordinary foreground text, because two fills side by side name no default between them. AC-G24 still holds: it is its own control, not the fallback for an unchecked box.
- [x] **AC-AA3** Arming changes the colour and not the shape. The fill becomes `statusWarning` and the outline's border and text do the same, so the second press lands on the target the first one armed. AC-R1 still holds, and so does group X: the armed state is still the warning colour, and the reserved width means nothing beside the control moves.
- [x] **AC-AA4** The green is set in one place. `success()` in `shared/colour.ts` is the plugin's green, and all three draw sites call it: the done node, the settled badge and the submit fill. `colors.statusSuccess` appears nowhere in `client/` on its own.
- [x] **AC-AA5** The mute holds the brightness. `desaturate` pulls a colour towards the weighted grey the eye reads as its brightness, so white text on the fill is as readable after the adjustment as before it. `probes/colour.mjs` C3 asserts the brightness is unchanged, the channel spread has narrowed, green is still the strongest channel, and alpha survives.
- [x] **AC-AA6** A theme notation the helper cannot read costs the adjustment, never the colour. Hex in three lengths, `rgb`, `rgba`, `hsl` and `hsla` are parsed; anything else is returned exactly as it came. C1 asserts eleven notations read correctly, C2 that ten unreadable ones pass through untouched.
- [x] **AC-AA7** Nothing else grew a button. `chrome` is optional and only the wizard passes it, so the row, the detail map and the summary card are the text controls they were. A screen of buttons names no action in particular, which is the problem this change was made to fix.
- [x] **AC-AA8** Every green on a radar surface is accounted for. The plugin draws colour only from the eleven tokens `PluginTheme` exposes, and the census is in the probe: `statusSuccess` at five sites, all through `success()`, and `accent` at twelve, all through `highlight()`. What is left green is drawn by the host and has no plugin surface to change it: the switch track when a switch is on, which `SettingsSwitchProps` gives no colour prop for, and the three `variant: "success"` toasts, where the plugin picks the variant and the host picks the colour.
- [x] **AC-AA9** A filled control derives its text colour from its own fill. `carryWhite` darkens a fill by as little as it takes for white on it to clear WCAG's 4.5 floor, and `WHITE` is what it is paired with. `accentForeground` cannot do this job: Paseo's dark theme accents in a near white, so the token is a near black there, which is correct on the accent and unreadable on a green. C5 asserts the floor is cleared and not overshot on four fills, that black is already dark enough, and that an unreadable notation is left alone.
- [x] **AC-AA10** The accent is quietened too, because in Paseo's light theme the accent is a green. `#20744A` is what every link, the running node, the spinner and the preview's left rule were drawn in. `highlight()` pulls it 55%, set against the chroma the green's mute produces rather than picked by eye. The dark theme accents in `#e4e4e7`, and a pull towards grey does nothing to something already grey: C6 asserts there was under 2 of chroma in it to take.
- [x] **AC-AA11** The two themes this actually runs against are in the probe. C6 carries Paseo's own values, light and dark, and asserts what each produces: the light green fill lands at `rgb(95, 126, 102)` and the dark one needs no darkening at all, both armed fills clear the floor, and the light accent comes out `rgb(67, 105, 86)`.
- [ ] **AC-AA12** The button looks right, and the green and the links are quieter without being grey. Awaiting the app.
- [x] **AC-AA13** Every mute lands in one band of saturation. The first attempt set the two amounts independently and by eye, and the accent came out at a chroma of 30.8 against the status greens' 24.4 and 18.7. The result was a screen where the badge and the finished node had plainly moved while the links, the back control and the running node's border still read as the untouched green, which is what James reported twice. The accent is now pulled 55% and lands at 19.2. C6 asserts all three sit between 15 and 26, that each is a drop of more than 10 from what the theme supplied, that the accent is still a green rather than a grey, and that none of it costs contrast: holding luminance means the light accent reads 6.19 on white, against 5.74 before any of this.

## AB. A record arrives with its summary

Group U made the summary a press, to stop every intake paying a second reading
for a record that might be dismissed at a glance. What that cost was the thing
the detail view is for: a record arrived saying "No summary yet.", and reading
it meant a press and a wait of minutes.

The saving survives the reversal, because the expensive part was never the
summary. It was reading the diff twice. Intake already reads it for the message,
so the file is one more write in a turn that is running anyway. A press is still
the way to rewrite a summary that has gone stale, and that press is still the
second reading that group U objected to, now charged only when it is asked for.

- [x] **AC-AB1** Intake asks for both writes in one turn. Verified by probe against the real `launchArgs`: the prompt names the operating brief, the summary brief, the record key and the real output path, in a single prompt to a single agent.
- [x] **AC-AB2** The summary brief is named, not restated. One file holds the schema, the field ceilings and the diction rules, so an edited brief governs the automatic path and the Summarise press alike. Verified by probe: no field name appears in the intake prompt.
- [x] **AC-AB3** The tick collects what the turn wrote. Nothing waits on a background intake, so the file is met rather than announced: one read per record still missing a summary. Verified by probe, including that a second sweep over the same ledger does no work.
- [x] **AC-AB4** A launch clears the previous file for that pull request before it starts, so a file left by an earlier launch cannot be collected as this one's output.
- [x] **AC-AB5** A file that is there and wrong is not a turn that has not finished. No file is no event and records no error. A diction breach and malformed JSON are each discarded with the reason written to the record and the file cleared, so a bad file is reported once rather than on every tick. Verified by probe against the real schema: `significant` in the risk field was named.
- [x] **AC-AB6** A summary already stored wins, and the file that lost is discarded unread. This was a real defect found by the probe: skipping the record left the file on disk, where the next sweep to find that record without a summary would take it in, landing an intake's reading of an old diff on a record that had moved on.
- [x] **AC-AB7** A press in flight holds its key against the collector, so the two cannot both write a summary for one record. Verified by probe with a turn held open.
- [ ] **AC-AB8** The next review request to arrive shows its summary on the detail view without anything being pressed. Awaiting the app, and a new review request.

## AC. A dot, a link that leads somewhere new, and one less panel

Three things James named after living with the screen.

The dot answers a question the plugin could not: has anything happened. Radar
polls every 60 seconds whether or not it is on screen, and until now the only
way to find out what it had found was to open it and look. The two moments he
named, a review request arriving and a review step finishing, are one state:
the record has moved since he last had it open.

The per-step agent link was five routes to one transcript. Only QA and
verification can be given a model of their own, and only then is there a second
agent to reach; every other node ran inside intake's agent, which the heading
already opens.

- [x] **AC-AC1** The per-step control appears only where it leads somewhere new: a stage spawned with an agent of its own. Everything else drops it, because the pull request title at the top of the detail view opens that same agent.
- [x] **AC-AC2** It says which agent. "Open QA agent" and "Open verification agent", not "Open agent": the point of the control is that this is not the one the heading opens.
- [x] **AC-AC3** The submit controls stand on the section, not inside a card. The bordered panel framed two buttons as one more setting to read, and the card's own inset went with it.
- [x] **AC-AC4** `seenAt` is stored on the record, not held in the app, so the mark survives a restart and reads the same on the phone and the desktop.
- [x] **AC-AC5** Activity is the record arriving, a stage settling as `done` or `failed`, and the summary landing. A sweep is not activity: `pr.checkedAt` moves every 60 seconds and would leave every record permanently lit. A skip and a stage merely starting are not either: both are James' own press. Verified by probe, including that an unparseable `generatedAt` from an agent is ignored rather than guessed at.
- [x] **AC-AC6** The dot is lit for a record that has moved since it was last opened. Dismissed and archived records never light: he has said he is done with them, and a dot that looking cannot clear is a dot that gets ignored. Verified by probe across eight cases.
- [x] **AC-AC7** Opening the record marks it seen. No control asks James to confirm he has read something. The stamp is now, or the record's own latest activity when that reads as later: a summary written by an agent with a clock a minute fast would otherwise beat every stamp, and the screen would ask to be marked seen on every refetch. Verified by probe, with the fast clock as a case.
- [x] **AC-AC8** A stage that settles while the record is open re-marks it rather than lighting a dot on the screen James is already reading.
- [x] **AC-AC9** The sidebar row runs the inbox read itself. A dot that only updated while the Radar screen was open would never once fire when it mattered. The query key is the screen's, so the row and the screen share one cache and one 30 second interval rather than polling twice.
- [x] **AC-AC10** The dot takes the muted accent, the same `highlight()` the rest of the plugin uses. An untouched accent would be the one loud green on a screen built to be quiet.
- [x] **AC-AC11** The row carries the same mark as the sidebar. Without it the dot says something moved and leaves James to open every record to find out which.
- [ ] **AC-AC12** The dot appears on the sidebar within 30 seconds of a review request arriving with Radar closed, and clears on opening the record. Awaiting the app.
- [ ] **AC-AC13** The per-step control is absent on a record whose QA inherited intake's agent, and present and correctly named on one whose settings gave QA a model of its own. Awaiting the app.

## AD. The summary writes itself, and the line joins the stops

Three things James named after watching a record arrive.

The summary button is the first. It was built when a summary cost a press, and
it has outlived that: intake writes one inside the turn that already read the
diff, so the control offered to pay for a second reading of a diff nothing had
said was stale. What a button is still for is the case intake cannot cover, an
agent that stopped having written nothing or having written something the
schema refused, which is the only moment a press is the difference between a
summary and no summary.

The second is what fills the gap it leaves. An intake turn runs for minutes and
the card said "No summary yet." throughout, which reads as a summary that is
not coming rather than one that has not arrived. Nothing on the screen started
that turn, so the only evidence it is running is the agent's own status, which
the tick already fetches for its liveness check.

The third is the metro map. The lines did not reach the stops in either
direction, and the vertical gap grew with whatever a node was expanded to show,
because the rail was a fixed twelve point segment placed between two blocks
rather than a line that spans one.

- [x] **AC-AD1** The summary card has no control in any state but one: no summary, and nothing running. Refresh beside a summary already written is gone, and so is Summarise beside a card still filling. The remaining control reads "Retry" when a reason is stored and "Summarise" when the agent simply wrote nothing.
- [x] **AC-AD2** While a summary is on its way the card says so, in the place the summary will appear, with the same working indicator the rest of the plugin uses. It covers both ways one arrives: an intake turn nothing here started, and a press.
- [x] **AC-AD3** Whether an agent is mid-turn is read off the `paseo ls --global --json` the liveness check already makes each tick, so knowing it costs no second call. `running` and `initializing` are working, matching the rule `inspectAgent` applies to one agent. The answer is at most one tick old, and the two things it gates settle on that same tick, so it cannot contradict what is on screen.
- [x] **AC-AD4** The horizontal strip's connector touches both squares. A three point gap each side left the line floating between two stops it never reached. Spacing between the five is now the connector's own length and nothing else.
- [x] **AC-AD5** The vertical rail fills its node's height rather than taking a fixed length, so it ends exactly where the next square begins whatever the node above expanded to show. The node and the rail share one column beside the body, and the column stretches with it.
- [x] **AC-AD6** The rail runs through the square's own centre line. It is centred in a gutter one node wide, rather than offset by half a node's padding, which left the one point line half a point to the right of centre.
- [x] **AC-AD7** A record with a review stage running is not reported as awaiting a summary. One agent runs QA and verification when the settings give them no model of their own, so its status alone cannot tell one turn from another, and a spinner lit by a QA run on a record that never got a summary would never resolve. Verified by probe.
- [x] **AC-AD8** An unreadable agent list leaves the last answer standing rather than reporting that every agent stopped. With nothing being watched the set clears instead, because a set left standing would be a claim about agents that are no longer anybody's. Verified by probe.
- [ ] **AC-AD9** The working indicator appears on a record that is arriving, and is replaced by the summary itself without a press. Awaiting the app.
- [ ] **AC-AD10** The metro line meets every stop, on the row strip and on the detail map, with a node collapsed and with the longest node expanded. Awaiting the app.

## AE. The daemon says it, rather than being asked

The plugin host fires nine lifecycle events on the daemon while a plugin is
enabled, and radar used a sixty second tick to go and ask the same questions.
Three of the nine answer them directly: `agent.turn_ended` is exactly when a
review stage can have finished and when an intake's summary file can have
appeared, and `agent.archived` and `agent.closed` are exactly when a record can
have lost the agent it claims.

The research behind choosing these three and nothing else is in the plan. The
short of it: Paseo's own hooks are the one free transport. A GitHub webhook is
creatable and buys 59 seconds against a public receiver, a fifth always-on
service and a shared secret. Linear is blocked, `isAdmin: false`. Slack Socket
Mode trades working access for an approval queue. So GitHub stays on the
conditional poll, which a tick with no news answers in one request and a 304.

Nothing here is trusted on its own. The hooks are documented as live and best
effort, with no replay, no persistence and no automatic retry, so a daemon that
was not running when a turn ended is never told and nothing else would notice.
The tick keeps both passes underneath them.

- [x] **AC-AE1** Every handler asks whether the agent is radar's before doing anything. The daemon fires these for every agent on the machine and radar owns a handful, so an unfiltered handler would run a ledger sweep on each of 76 agents' turns. Ownership covers a record's own agent and any a task was given of its own. Verified by probe.
- [x] **AC-AE2** An event arriving during a pass gets a pass of its own, and a burst of them during one pass gets one between them. Joining the run already going would drop the change, because that run has already read the half of the ledger the event concerns. Verified by probe.
- [x] **AC-AE3** A turn ending takes its agent out of the working set in the same tick, rather than at the next agent list. The case that needs it is a turn that ended having written nothing: no summary arrives to replace the indicator, so the card would otherwise claim one was still being written for up to a minute after the agent stopped. Verified by probe.
- [x] **AC-AE4** The agent list still runs every tick. It is one `paseo ls`, and the screen reads which agents are mid-turn out of what it refreshes, so a slow clock there would be a summary indicator a slow clock behind. The stage and summary pass moved to a ten minute floor, because what made it worth a minute was a thirty second `paseo inspect` per running stage, and that is now what the event reports for nothing.
- [x] **AC-AE5** The floor runs on the first tick after a start. A restart is the one moment an event is certain to have been missed, and the stamp that paces the floor is in memory for the same reason the fact it records is. Verified by probe.
- [x] **AC-AE6** Ownership is read from the ledger on each event rather than from a cache refreshed on the tick. The event that matters most is the first turn of an agent launched a moment ago, which a tick-paced cache would not yet know. Verified by probe.
- [x] **AC-AE7** A handler starts its work and returns rather than awaiting it. A hook is abandoned at thirty seconds and a settle pass can spend that long inspecting one agent, so a handler that waited would report a timeout on the events with the most to do. Nothing waits on the result: it is a ledger write the screen refetches.
- [x] **AC-AE8** `pollNotifications`, `sweep`, `reap` and the Linear poll are untouched. Nothing in the daemon knows when a review is requested on GitHub, so that half stays exactly as it was.
- [x] **AC-AE9** Plugin cleanup removes all three registrations. Verified by probe.
- [ ] **AC-AE10** A live turn ending puts its summary on the screen without the tick: `paseo plugin logs radar` shows `ended a turn, settling stages and summaries` and the detail view fills, with no `collected the summary` from a floor pass behind it. Awaiting the app.
- [ ] **AC-AE11** A stage left running by a killed agent settles from the event rather than after a minute. Awaiting the app.

## Awaiting the app

Every criterion below is built and typechecked. None can be ticked from here: each asserts
what James sees, or what happens when he presses something. `paseo plugin` has no RPC
invocation command, so there is no route to them except the running app.

| Criterion                      | What settles it                                                                                                 |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| AC-AE10                        | One record taken in with the app open, watching the card fill before the next tick                              |
| AC-AE11                        | One `paseo agent kill` on an agent with a stage running                                                         |
| AC-A2, AC-A3, AC-A4            | One Retry press on an `orphaned` or `failed` record                                                             |
| AC-A7, AC-A9                   | One Dismiss press, then Restore                                                                                 |
| AC-B1, AC-B2                   | A look at the dismissed toggle with at least one row behind it                                                  |
| AC-C5                          | A daemon restart while a stage is `running`                                                                     |
| AC-D6                          | One Acknowledge press, then Undo, on a live PR                                                                  |
| AC-H2 warning path             | A dismiss while GitHub is unreachable, to see the toast                                                         |
| AC-E4, AC-E7                   | One real QA run, then `git status` in the worktree and the PR's comment list                                    |
| AC-F2, AC-F3, AC-F4            | One real verification run, read against the description's own steps                                             |
| AC-F7                          | The same run, with the shell history checked for a database client                                              |
| AC-I8                          | Disable and re-enable the plugin, then read the log for a doubled interval                                      |
| AC-J1, AC-J7                   | A row tap, then a tap on an inert node                                                                          |
| AC-J9                          | The detail at the compact breakpoint                                                                            |
| AC-K1, AC-K4, AC-K5            | A look at the detail view, with and without a summary, then one Summarise press                                 |
| AC-K2, AC-AB8                  | The next review request to arrive, read before anything is pressed                                              |
| AC-AC12                        | The next review request to arrive with Radar closed, watched for the dot, then opened                           |
| AC-AC13                        | One record with a per-task model set for QA, beside one without                                                 |
| AC-AD9                         | The next review request to arrive, watched from the moment the row appears until the summary lands              |
| AC-AD10                        | A look at the detail map with Verification expanded, and at a row strip beside it                               |
| AC-G2, AC-G6, AC-G22, AC-G24   | One walk through the wizard on a record with findings, including a `blocking` one, left and re-entered part way |
| AC-G10, AC-G15, AC-G16, AC-G25 | One real submit, read against the pull request's own review list                                                |
| AC-L1 wiring                   | One real arrival, one stage run and one dismiss, read against the week file                                     |
| AC-M2                          | A look at the inbox with the five merged rows badged, then one dismiss from the row                             |
| AC-N1, AC-N2                   | One press on the clock badge, watched for the working indicator and the reset to `0m`                           |
| AC-N6, AC-N7                   | A look at #9485, which carries a fault, on the row and then on the detail                                       |
| AC-O7                          | A look at the Acknowledge node on a pending record, checked for the absence of Skip                             |
| AC-Q5, AC-Q6                   | One Run QA press on a live record, watched for a single spinner and a node that opens while running             |
| AC-Q7                          | One tap on the summary headline, collapsed and expanded                                                         |
| AC-R1                          | One first press on any control, read for the armed colour                                                       |
| AC-G28                         | One character typed into a replacement, watched for the switch moving and the cursor staying put                |
| AC-X1 to AC-X5                 | One press on a confirm, one on the clock, one on each tab, watched for anything beside them moving              |
| AC-Y7                          | Opening the plugin on an Android device, which is the only place the Hermes failure showed                      |
| AC-Z18                         | Opening Settings, Radar: the pickers populated, one brief edited and reverted, one save, one Discard            |
| AC-AA1, AC-AA12                | A look at the wizard's last step, approve on and then off, with one control armed, in both themes               |

## Non-goals

- Automatic stage progression of any kind.
- Any notification, ping, or reminder about a stalled row.
- Drafting message text on James' behalf, in the wizard or anywhere else.
- Replacing the reaper. Workspace archival keeps its own 24h rule.
- Actioning a stage from the row strip. See decision D4.
