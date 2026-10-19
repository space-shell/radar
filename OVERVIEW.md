Radar turns a GitHub review request into a workspace that is already checked out at
the pull request, with an agent's reading of the diff waiting in it, and keeps a
ledger of what arrived and what was done about it.

Nothing progresses on its own. The daemon only takes work in and reports what it
finds; acknowledging, reviewing, verifying and replying are each a press.

## How it works

A poll of your GitHub notifications every 60 seconds, conditional on
`If-Modified-Since`, so a tick with nothing new is one request that returns 304. A
full search runs every ten minutes, or immediately when a notification says a review
was requested, or when you press the clock badge on the inbox.

A new review request maps its repository to a local clone, creates a worktree
workspace checked out at the pull request, and launches one agent to read the diff
and say what it found, in one message. No agent is ever spawned to detect anything,
and nothing else runs until you press something: the detail view's four-field
summary is a second turn, and it costs one only when you ask for it.

Each record then carries five nodes: acknowledge, QA, verification, feedback and
dismiss. Acknowledge posts the eyes reaction, which is the only thing the plugin
writes to GitHub without you pressing something on that record. QA and verification
run an agent in the record's own workspace and leave their results in a file outside
every checkout. Feedback is a wizard over those findings that submits one review.

One GraphQL query per sweep reads what GitHub says about every tracked pull request,
so a row can read "merged" or "approved by a teammate" before you open it.

A workspace is archived 24 hours after its pull request closes and its agent goes
idle, which is what stops automatic creation compounding.

A row whose agent has disappeared is checked against the pull request before it is
called broken. Paseo can archive a worktree workspace itself when the pull request
merges, and the agent goes with it, so a finished pull request reads `archived` with
no fault. Only a row whose pull request is still open, or whose state cannot be read
at all, carries the red mark and the Retry it implies.

Three of the screen's journeys are state machines rather than booleans, in
`shared/machines`: `confirm.ts` is the two-press arm and its four second window,
`view.ts` is the inbox moving between list, detail and wizard, and `wizard.ts` is
the walk through the findings to the preview. `stage.ts` is the fourth, and the
odd one: the server owns a stage's status, so that machine never runs, it only
answers which controls a node offers. Each is a plain file you can read to see
what the screen will do, and `probes/machines.mjs` asserts it without a renderer.

Controls hold one width across every state they can show. A confirm that grows a
question mark on its first press, a tab that goes bold when selected and a clock that
swaps its reading for a working indicator each used to shove whatever sat beside them.
`client/steady.tsx` reserves the widest variant in a box of zero height, so the width is
decided by layout rather than measured after the fact.

xstate reaches the screen through `shared/vendor/xstate.mjs` and
`client/vendor/xstate-react.mjs` rather than from `node_modules`. Hermes, the engine the
Android app runs, has no ES6 class syntax, and plugin client bundles bypass the Metro
transform that lowers it for the rest of the app, so a bundle carrying a `class` fails to
load on a phone while working on the desktop. `scripts/vendor.mjs` bundles both packages
with the same esbuild the daemon uses and downlevels them to ES5 with `tsc`, which is the
only thing in the toolchain that removes a class. Run it again after any xstate upgrade;
hand edits to the two generated files are lost. Delete all of it the day Paseo lowers
classes itself.

The second half is the radar itself. With a Linear key configured, the plugin reads
your Linear notifications every two minutes and writes one ledger line per issue
event: who did what, to which issue, with the link back. It also asks Linear which
issues are still assigned to you and not done, which is the Linear half of the
standing list. It records what happened and never what to say about it.

## Setup

The plugin shells out to `paseo`, `gh` and `git`, and authenticates as whoever `gh`
holds a token for. The plugin subprocess does not reliably inherit a PATH holding
them, so the paths are configuration.

Settings are edited in the app, under Settings, Radar. They are stored by the host
rather than by this plugin, so they follow the host and survive a reinstall of the
plugin directory.

`~/.local/state/radar/config.json` still works and is what the plugin acts on until
something is saved on that screen. Once anything there differs from its defaults, the
screen wins and the file is ignored. The screen offers a one-press import of the file,
after which the file is dead weight.

| Setting                   | Default        | What it does                                                                                                                                                  |
| ------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dry run                   | on             | Logs the launch it would run and creates nothing. Turn it off to let intake create workspaces                                                                 |
| Notification poll         | `60`           | The notification poll floor in seconds. GitHub's own `X-Poll-Interval` wins when it asks for longer                                                           |
| Full search               | `600`          | Seconds between full searches, which catch a review request that sent no notification                                                                         |
| Checkout roots            | `~/work`       | Directories scanned one level down. Every git repository found maps its origin to its path                                                                    |
| Development environment   | none           | The shell command that enters it, named in the prompt of every agent the plugin launches                                                                      |
| Agent, per task           | `claude/claude-opus-5`, thinking `xhigh`, mode `auto` | Which model answers intake, QA, verification and the summary. A task set to intake's own model runs on intake's agent               |
| Brief, per task           | the shipped file | What the agent is told to do. Empty means the brief in `briefs/`, which is shown greyed behind the field                                                     |
| Linear workspace          | none           | The workspace slug a bare issue key belongs to. A pull request body carrying a full Linear URL links without this                                             |
| Linear team keys          | none           | The team prefixes worth linking, so a capitalised word cannot become a dead link                                                                              |
| Linear API key command    | none           | The command that prints a Linear personal API key, for example `security find-generic-password -s linear-radar -w`. Empty leaves the Linear half off           |
| Linear poll               | `120`          | Seconds between Linear notification reads. Linear advertises no interval of its own                                                                           |
| paseo, gh, git            | the bare names | Absolute paths when PATH does not hold them                                                                                                                   |

Four tasks, one agent. A task runs on intake's agent unless it is given a model intake
is not running, so the usual settings cost one agent per pull request. A task given a
different model gets an agent of its own, in the pull request's own workspace, created
the first time that task runs and not before.

An edited brief is written to `~/.local/state/radar/briefs/`, not over the file in the
plugin directory. That directory is a git checkout: editing in place would be reverted
by the next pull, and would make the pull a conflict.

State, the standing list and the weekly ledger live under `~/.local/state/radar`,
outside the plugin directory, so reloading or reinstalling the plugin cannot clear
them.

## What it writes, and where

To GitHub: the eyes reaction on acknowledge, its removal on undo or dismiss, and one
review when you submit the feedback wizard. Nothing else, and nothing at all from a
timer.

To disk: `seen.json`, `OPEN.md`, a weekly ledger file, and one summary or findings
file per pull request. Nothing is ever written inside a checkout.

To Linear: nothing. The key is read-only as far as this plugin is concerned, and the
one thing it must never do is reply on your behalf.

The Linear key itself is never written to disk by the plugin, never logged and never
put in an error message. The config names a command that prints it, not the key.

## Limits

Detection stops when the Paseo daemon stops, which is correct: there is nowhere to
put a workspace that nothing can open.

Only repositories with a local clone under a configured root can be taken in. An
unmapped repository is recorded and shown on the row rather than dropped.

Reading the Linear issue behind a pull request works from the body alone, with no
credential. The Linear half of the radar is the part that needs one, and it stays off
until the Linear API key command names something that prints a key.

## Checking it

`npm run probe` runs every probe in `probes/`, each in its own process against a
throwaway `HOME`. That redirect is the safety property: the state directory is derived
from `HOME`, so a probe writes its state, its ledger and its `OPEN.md` into a temporary
directory and cannot reach the live install. A probe started any other way exits before
it writes anything: the runner seals the temporary `HOME` it made, and `probes/guard.mjs`
refuses to run against a `HOME` carrying no seal. It also means `gh` finds no token there,
which is why the two probes that read the real API skip themselves unless
`RADAR_PROBE_REPO=owner/name` and `RADAR_PROBE_PRS=1,2,3` name something to read.

Naming a repository is also what lends them a credential. The runner reads `gh auth
token` once, from the real `HOME`, and passes it down as `GH_TOKEN`, which is the
variable `gh` and `server/github.ts` both prefer over the stored one. A run that names
no repository carries no token at all, so an ordinary run cannot reach GitHub even by
mistake. Those two probes are GET only.

Three probes assert nothing and report instead: their output is the result, so the
runner prints it. The rest count their own checks and say so.

The one check the probes cannot make is that the client bundle parses on Hermes. It is a
build artifact, not a module, and the engine is not Node. `node_modules/react-native/sdks/hermesc`
holds the compiler the app's own Hermes was built from, which is what the vendoring was
verified against.

`npm run typecheck` is the other half. There is no watch mode and no framework: a
probe is a script that prints `pass` or `FAIL`, which is enough for a plugin this size
and leaves nothing to configure.
