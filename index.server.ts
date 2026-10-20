import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  pollNotifications,
  pullRequestBody,
  searchReviewRequests,
  type ReviewRequest,
} from "./server/github";
import { linearRef, type LinearNaming } from "./server/linear-ref";
import { sweepLinear } from "./server/radar";
import { discoverCheckouts } from "./server/repos";
import {
  briefPaths,
  launchIntake,
  launchArgs,
  resolveLaunch,
  type Briefs,
} from "./server/intake";
import { loadConfig } from "./server/settings";
import { loadState, updateState } from "./server/state";
import type { IntakeRecord } from "./shared/inbox";
import {
  baseAgent,
  radarSettings,
  readLegacyConfig,
  readProviders,
  readShippedPrompt,
} from "./shared/settings";
import { readProviderOptions } from "./server/providers";
import { readShippedBrief } from "./server/briefs";
import { attachSettings, readLegacyFile } from "./server/settings";
import { configPath } from "./server/state";
import {
  markSeen,
  pullRequestUrl,
  readInbox,
  retryIntake,
  runStageAction,
  runSummary,
  setDismissed,
  setStage,
  sweepNow,
  undoStageAction,
} from "./shared/inbox";
import { dismissRecord, retryRecord } from "./server/actions";
import { markRecordSeen, readInboxState } from "./server/inbox";
import { note, writeOpen } from "./server/ledger";
import { setStageStatus } from "./server/stages";
import { runStageFor, undoStageFor } from "./server/stage-actions";
import { adoptFindings } from "./server/qa";
import { reap } from "./server/reap";
import { reconcileAgents } from "./server/reconcile";
import { attachHooks, settleDue } from "./server/hooks";
import { setupCommand } from "./server/setup";
import { singleFlight } from "./server/single-flight";
import { refreshStatuses } from "./server/status";
import { runSummary as runSummaryFor } from "./server/summary";
import {
  checkAnchors,
  readFeedback,
  saveDraft,
  submitFeedback,
} from "./shared/feedback";
import {
  checkDraftAnchors,
  readFeedbackState,
  storeDraft,
  submitReview,
} from "./server/feedback";
import { log } from "./server/log";

const MIN_POLL_SECONDS = 60;
/** Each lookup is a 30s `gh pr view` and the tick is serial, so the sweep is capped. R11. */
const MAX_LINEAR_LOOKUPS = 5;
const MAX_LINEAR_ATTEMPTS = 3;

/** How this machine names Linear issues. Read per sweep, so an edit takes effect. */
async function linearNaming(): Promise<LinearNaming> {
  const { linearWorkspace, linearTeamKeys } = await loadConfig();
  return { workspace: linearWorkspace, teamKeys: linearTeamKeys };
}

/**
 * Takes in one pull request. The launch runs outside the write lock because it
 * can take two minutes; only the resulting record is written under it. R2.
 */
async function intake(
  request: ReviewRequest,
  checkouts: Map<string, string>,
  briefs: Briefs,
  naming: LinearNaming,
  setup: string | null,
  dryRun: boolean,
): Promise<void> {
  const checkout = checkouts.get(request.repo);
  const record: IntakeRecord = {
    key: request.key,
    repo: request.repo,
    number: request.number,
    title: request.title,
    firstSeen: new Date().toISOString(),
    state: "created",
    linearUrl: linearRef(request.body, naming),
  };

  if (!checkout) {
    record.state = "unmapped";
    log(`unmapped repo ${request.repo} for PR #${request.number}, skipping`);
  } else if (dryRun) {
    record.state = "dry-run";
    log(
      `would launch: paseo ${launchArgs(
        request,
        checkout,
        briefs,
        setup,
        baseAgent(await loadConfig()),
      )
        .slice(0, -1)
        .join(" ")}`,
    );
  } else {
    try {
      const { agentId, workspaceId } = await launchIntake(
        request,
        checkout,
        briefs,
        setup,
      );
      if (agentId) {
        record.agentId = agentId;
        record.workspaceId = workspaceId;
        log(`launched ${request.key} as agent ${agentId}`);
      } else {
        record.state = "failed";
        log(`launch for ${request.key} produced no agent`);
      }
    } catch (error) {
      record.state = "failed";
      log(`launch failed for ${request.key}: ${String(error)}`);
    }
  }

  const taken = await updateState((state) => {
    // Re-check inside the lock: another path may have taken this one in meanwhile.
    if (state.intake.some((existing) => existing.key === record.key))
      return false;
    state.intake.push(record);
    if (!state.seenPullRequests.includes(record.key))
      state.seenPullRequests.push(record.key);
    return true;
  });

  // One line per arrival, and only for the arrival that actually landed, so a
  // record taken in twice cannot read as two review requests.
  if (taken) {
    note({
      source: "github",
      subject: record.key,
      what:
        record.state === "created"
          ? `review requested, ${record.title}`
          : `review requested, ${record.title} (${record.state})`,
      url: pullRequestUrl(record),
    });
  }
}

/**
 * Resolves Linear issues for records taken in before bodies were stored.
 *
 * Bounded twice over, because every lookup is a 30s `gh pr view` inside a serial
 * tick: at most MAX_LINEAR_LOOKUPS per search, and a record that fails
 * MAX_LINEAR_ATTEMPTS times is recorded as having no issue rather than retried
 * on every search for the life of the daemon. R11.
 */
export async function backfillLinear(): Promise<void> {
  const snapshot = await loadState();
  const naming = await linearNaming();
  const outstanding = snapshot.intake
    .filter((record) => record.linearUrl === undefined)
    .slice(0, MAX_LINEAR_LOOKUPS);
  if (outstanding.length === 0) return;

  const resolved = new Map<string, string | null>();
  const failed = new Set<string>();

  for (const record of outstanding) {
    try {
      resolved.set(
        record.key,
        linearRef(await pullRequestBody(record.repo, record.number), naming),
      );
    } catch (error) {
      failed.add(record.key);
      log(`cannot read ${record.key} body: ${String(error)}`);
    }
  }

  await updateState((state) => {
    for (const record of state.intake) {
      if (record.linearUrl !== undefined) continue;

      if (failed.has(record.key)) {
        const attempts = (record.linearAttempts ?? 0) + 1;
        record.linearAttempts = attempts;
        if (attempts >= MAX_LINEAR_ATTEMPTS) {
          // Giving up is recorded as "looked up, none found", which is what the
          // screen already renders. The log is the only place the difference lives.
          record.linearUrl = null;
          log(`giving up on ${record.key} after ${attempts} failed body reads`);
        }
        continue;
      }

      const url = resolved.get(record.key);
      if (url === undefined) continue;
      record.linearUrl = url;
      delete record.linearAttempts;
      if (url) log(`linked ${record.key} to ${url}`);
    }
  });
}

/** Finds the agent for a record that was launched before its id could be read. */
async function backfill(): Promise<void> {
  const snapshot = await loadState();
  const found = new Map<string, { agentId?: string; workspaceId?: string }>();

  for (const record of snapshot.intake) {
    if (record.state !== "created" || record.agentId) continue;
    found.set(record.key, await resolveLaunch(record));
  }

  if (found.size === 0) return;

  await updateState((state) => {
    for (const record of state.intake) {
      const result = found.get(record.key);
      if (!result || record.state !== "created" || record.agentId) continue;

      if (result.agentId) {
        record.agentId = result.agentId;
        record.workspaceId = result.workspaceId;
        log(`backfilled ${record.key} as agent ${result.agentId}`);
      } else {
        record.state = "failed";
        log(`no agent found for ${record.key}, marking failed`);
      }
    }
  });
}

async function reconcile(dryRun: boolean): Promise<void> {
  const open = await searchReviewRequests();
  const snapshot = await loadState();
  const seen = new Set(snapshot.seenPullRequests);
  const fresh = open.filter((request) => !seen.has(request.key));

  if (fresh.length > 0) {
    const checkouts = await discoverCheckouts();
    const briefs = await briefPaths();
    const naming = await linearNaming();
    const setup = await setupCommand();
    for (const request of fresh) {
      await intake(request, checkouts, briefs, naming, setup, dryRun);
    }
  }

  await backfill();
  await backfillLinear();
  // Before the statuses, so a stage settled from a file is what the screen reads
  // on this tick rather than the one after it.
  await adoptFindings().catch((error) =>
    log(`findings not adopted: ${String(error)}`),
  );

  // Before OPEN.md, so the standing list cannot call a merged pull request open.
  // One query for the whole inbox, and a failure costs the badges, not the sweep.
  await refreshStatuses().catch((error) =>
    log(`statuses not read: ${String(error)}`),
  );

  await updateState((state) => {
    state.lastSearchAt = new Date().toISOString();
  });

  // On the search tick rather than every poll: the standing list only changes
  // when a record does, and its ages are read in days.
  await writeOpen().catch((error) =>
    log(`OPEN.md not written: ${String(error)}`),
  );
  log(`search: ${open.length} open review requests, ${fresh.length} new`);
}

/**
 * The one way a sweep starts, whether the interval asked for it or James pressed
 * the clock. The config is read inside, so a dry run toggled between sweeps takes
 * effect on the next one.
 */
const sweep = singleFlight(async () => {
  const config = await loadConfig();
  await reconcile(config.dryRun);
});

/**
 * The clock badge's press. It reconciles and nothing else: reaping archives a
 * workspace, which is not what a refresh means, and it keeps its own 24h rule
 * on the tick. AC-N3.
 */
async function sweepOnDemand(): Promise<{
  ok: boolean;
  error?: string;
  joined: boolean;
}> {
  try {
    return { ok: true, joined: await sweep() };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    log(`sweep on demand failed: ${detail}`);
    return { ok: false, error: detail, joined: false };
  }
}

/**
 * The Linear half, on its own clock. Separate from the search interval because the
 * two answer to different things: GitHub advertises a poll interval and Linear does
 * not, and a notification inbox is worth reading more often than a repository search.
 *
 * The timestamp moves whether or not the sweep succeeded. A workspace that is down,
 * or a key that has been revoked, must not turn a two minute poll into one per tick.
 */
async function linearDue(seconds: number): Promise<void> {
  const { linearSweptAt } = await loadState();
  const since = linearSweptAt
    ? (Date.now() - Date.parse(linearSweptAt)) / 1000
    : Number.POSITIVE_INFINITY;
  if (since < seconds) return;

  try {
    await sweepLinear();
  } catch (error) {
    log(`linear not read: ${String(error)}`);
  }
  await updateState((state) => {
    state.linearSweptAt = new Date().toISOString();
  });
}

async function tick(): Promise<number> {
  const config = await loadConfig();

  // Every tick, because it is one `paseo ls` and because the screen reads which
  // agents are mid turn out of what it refreshes. A slow clock here would be a
  // summary indicator a slow clock behind. The hooks only sharpen it. AC-AE4.
  await reconcileAgents();

  // Stages and summaries are the hooks' work now: a turn ending is exactly when
  // either can have changed, and the daemon says so for free. This is the floor
  // under them, for the events a stopped daemon never heard. AC-AE5.
  await settleDue();

  const before = await loadState();
  const hint = await pollNotifications(before.githubLastModified);
  await updateState((state) => {
    state.githubLastModified = hint.lastModified;
  });

  const { lastSearchAt } = await loadState();
  const sinceSearch = lastSearchAt
    ? (Date.now() - Date.parse(lastSearchAt)) / 1000
    : Number.POSITIVE_INFINITY;
  const due = sinceSearch >= config.searchIntervalSeconds;

  if (hint.reviewRequested || due) {
    await sweep();
  }

  if (due) {
    await reap(config.dryRun);
  }

  await linearDue(config.linearPollSeconds);

  return Math.max(
    hint.pollSeconds ?? config.notificationPollSeconds,
    MIN_POLL_SECONDS,
  );
}

export default function contribute(server: PluginServerContext) {
  // Before anything reads configuration, so the first tick acts on the settings
  // document rather than on the defaults it would otherwise find.
  attachSettings(server.registerSettings(radarSettings));

  server.handle(readInbox, readInboxState);
  server.handle(markSeen, ({ key }) => markRecordSeen(key));
  server.handle(readProviders, (_input, { paseo }) =>
    readProviderOptions(paseo),
  );
  server.handle(readShippedPrompt, async ({ task }) => {
    try {
      return { text: await readShippedBrief(task), error: null };
    } catch (error) {
      return { text: "", error: String(error) };
    }
  });
  server.handle(readLegacyConfig, async () => {
    try {
      const values = await readLegacyFile();
      return { values, path: configPath, error: null };
    } catch (error) {
      return { values: null, path: configPath, error: String(error) };
    }
  });
  server.handle(sweepNow, () => sweepOnDemand());
  server.handle(retryIntake, ({ key }) => retryRecord(key));
  server.handle(setDismissed, ({ key, dismissed }) =>
    dismissRecord(key, dismissed),
  );
  server.handle(setStage, ({ key, stage, status }) =>
    setStageStatus(key, stage, status),
  );
  server.handle(runStageAction, ({ key, stage }, { paseo }) =>
    runStageFor(key, stage, paseo),
  );
  server.handle(undoStageAction, ({ key, stage }) => undoStageFor(key, stage));
  server.handle(runSummary, ({ key }, { paseo }) => runSummaryFor(key, paseo));
  server.handle(readFeedback, ({ key }) => readFeedbackState(key));
  server.handle(saveDraft, ({ key, draft }) => storeDraft(key, draft));
  server.handle(checkAnchors, ({ key }) => checkDraftAnchors(key));
  server.handle(submitFeedback, ({ key, event }) => submitReview(key, event));

  // Registered before the first tick, so a turn that ends while it runs is heard.
  const detachHooks = attachHooks(server);

  let timer: NodeJS.Timeout | undefined;
  let stopped = false;

  const schedule = (seconds: number) => {
    if (stopped) return;
    timer = setTimeout(run, seconds * 1000);
  };

  const run = async () => {
    let next = MIN_POLL_SECONDS;
    try {
      next = await tick();
    } catch (error) {
      log(`tick failed: ${String(error)}`);
    }
    schedule(next);
  };

  log("started");
  void run();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    detachHooks();
    log("stopped");
  };
}
