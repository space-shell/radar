import { useRpc } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import {
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
  type Mutation,
} from "@tanstack/react-query";
import {
  checkAnchors,
  readFeedback,
  saveDraft,
  submitFeedback,
  type Draft,
  type ReviewEvent,
} from "../shared/feedback";
import {
  addPullRequest,
  markSeen,
  readInbox,
  retryIntake,
  runStageAction,
  runSummary,
  setDismissed,
  setStage,
  sweepNow,
  undoStageAction,
} from "../shared/inbox";
import { readThreads, setThreadResolved } from "../shared/threads";
import { AGENT_STAGES, STAGE_LABELS, type ReviewStage } from "../shared/review";
import { shortKey } from "../shared/format";

const INBOX_QUERY = ["radar", "inbox"];
/** Keyed so the mutation cache, not the observer, is the source of what is running. R5. */
const RETRY_MUTATION = ["radar", "retry"];
const DISMISS_MUTATION = ["radar", "dismiss"];
const STAGE_MUTATION = ["radar", "stage"];
const ACTION_MUTATION = ["radar", "action"];
const SUMMARY_MUTATION = ["radar", "summary"];
const SWEEP_MUTATION = ["radar", "sweep"];
const ADD_MUTATION = ["radar", "add"];
const feedbackQuery = (key: string) => ["radar", "feedback", key];
const threadsQuery = (key: string) => ["radar", "threads", key];
const THREAD_MUTATION = ["radar", "thread"];

export interface DismissInput {
  key: string;
  dismissed: boolean;
}

export interface StageInput {
  key: string;
  stage: ReviewStage;
  status: "pending" | "skipped";
}

export interface ActionInput {
  key: string;
  stage: ReviewStage;
  /** `undo` takes the stage's effect back rather than performing it. AC-D6. */
  direction: "run" | "undo";
}

/**
 * The one read. The inbox and the detail view share its cache, so the two can never
 * show a record in two different states at the same moment. AC-J12.
 */
export function useInbox() {
  const read = useRpc(readInbox);
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: INBOX_QUERY,
    queryFn: () => read({}),
    // Faster while a pull request is arriving, because that is the one moment
    // James is watching the list rather than reading it. Back to the resting
    // rate as soon as the row lands. AC-AK12.
    refetchInterval: (query) =>
      query.state.data?.takingIn.length ? 5_000 : 30_000,
  });

  return {
    ...query,
    refresh: () => queryClient.invalidateQueries({ queryKey: INBOX_QUERY }),
  };
}

/**
 * Stamps the open record as looked at, which is what clears its dot.
 *
 * Silent in both directions. There is no press behind it, so a success toast
 * would announce something James did not do, and a failure costs him a dot that
 * stays lit on a record he has read: visible, harmless, and corrected by the
 * next time he opens it. AC-AC7.
 */
export function useMarkSeen(refresh: () => void) {
  const mark = useRpc(markSeen);
  return useMutation({
    mutationFn: (key: string) => mark({ key }),
    onSuccess: refresh,
  });
}

/**
 * An RPC that resolves `{ ok: false }` is a failure the row cannot always show, and a
 * thrown one showed nothing at all. Both reach a toast. R7.
 */
export function useRetry(refresh: () => void) {
  const retry = useRpc(retryIntake);
  const toast = useToast();

  return useMutation({
    mutationKey: RETRY_MUTATION,
    mutationFn: (key: string) => retry({ key }),
    onSuccess: (result, key) => {
      if (!result.ok) {
        toast.error(
          `Retry failed for ${shortKey(key)}: ${result.error ?? "no reason given"}`,
        );
        return;
      }
      toast.show(
        `${shortKey(key)} ${result.adopted ? "adopted its existing agent" : "relaunched"}`,
        { variant: "success" },
      );
    },
    onError: (caught, key) =>
      toast.error(`Retry failed for ${shortKey(key)}: ${String(caught)}`),
    onSettled: refresh,
  });
}

/** No success toast: the row moving between Active and Dismissed is the feedback. */
export function useDismiss(refresh: () => void) {
  const dismiss = useRpc(setDismissed);
  const toast = useToast();

  return useMutation({
    mutationKey: DISMISS_MUTATION,
    mutationFn: (input: DismissInput) => dismiss(input),
    onSuccess: (result, input) => {
      const verb = input.dismissed ? "Dismiss" : "Restore";
      if (!result.ok) {
        toast.error(
          `${verb} failed for ${shortKey(input.key)}: ${result.error ?? "no reason given"}`,
        );
        return;
      }
      // The row moved, so the usual silence would read as a clean press. It was not.
      if (result.warning) {
        toast.error(`${shortKey(input.key)} dismissed, but ${result.warning}`);
      }
    },
    onError: (caught, input) =>
      toast.error(
        `${input.dismissed ? "Dismiss" : "Restore"} failed for ${shortKey(input.key)}: ${String(caught)}`,
      ),
    onSettled: refresh,
  });
}

/** Skip and reopen, the two stage transitions with no side effects. */
export function useStage(refresh: () => void) {
  const stage = useRpc(setStage);
  const toast = useToast();

  return useMutation({
    mutationKey: STAGE_MUTATION,
    mutationFn: (input: StageInput) => stage(input),
    onSuccess: (result, input) => {
      if (result.ok) return;
      toast.error(
        `${STAGE_LABELS[input.stage]} on ${shortKey(input.key)} did not move: ${result.error ?? "no reason given"}`,
      );
    },
    onError: (caught, input) =>
      toast.error(
        `${STAGE_LABELS[input.stage]} on ${shortKey(input.key)} did not move: ${String(caught)}`,
      ),
    onSettled: refresh,
  });
}

/**
 * One useMutation tracks only its most recent call, so acting on a second row dropped
 * the first row's indicator while its work carried on. The cache keeps every pending
 * mutation, so it is read instead. R5.
 */
export function useRetryingKeys(): (string | undefined)[] {
  return useMutationState({
    filters: { mutationKey: RETRY_MUTATION, status: "pending" },
    select: (mutation: Mutation<unknown, Error, string>) =>
      mutation.state.variables,
  });
}

export function useDismissingKeys(): (string | undefined)[] {
  return useMutationState({
    filters: { mutationKey: DISMISS_MUTATION, status: "pending" },
    select: (mutation: Mutation<unknown, Error, DismissInput>) =>
      mutation.state.variables?.key,
  });
}

/**
 * Which stage transition is in flight, down to the transition.
 *
 * Keyed by what was asked for, not only by the stage: a node offers Skip and Run
 * at once, and a key that named the stage alone lit both of their spinners from
 * whichever one was pressed. AC-Q5.
 */
export function useStagingKeys(): (string | undefined)[] {
  return useMutationState({
    filters: { mutationKey: STAGE_MUTATION, status: "pending" },
    select: (mutation: Mutation<unknown, Error, StageInput>) => {
      const input = mutation.state.variables;
      return input && `${input.key}:${input.stage}:${input.status}`;
    },
  });
}

/**
 * The side-effecting half: a node's own action, and taking it back. Separate from
 * useStage because that one only moves a flag, while this one reaches GitHub.
 */
export function useStageAction(refresh: () => void) {
  const run = useRpc(runStageAction);
  const undo = useRpc(undoStageAction);
  const toast = useToast();

  return useMutation({
    mutationKey: ACTION_MUTATION,
    mutationFn: ({ key, stage, direction }: ActionInput) =>
      direction === "run" ? run({ key, stage }) : undo({ key, stage }),
    onSuccess: (result, input) => {
      const what = `${STAGE_LABELS[input.stage]} on ${shortKey(input.key)}`;
      if (!result.ok) {
        toast.error(`${what} failed: ${result.error ?? "no reason given"}`);
        return;
      }
      /*
       * A stage that sends an agent a turn answers the press the moment it has
       * claimed the stage, so "done" was a green toast beside a node whose work
       * had not begun. The queue widens that gap on purpose: the press may be
       * waiting for the agent to finish what James is typing into it. AC-AF27.
       */
      const started = AGENT_STAGES.includes(input.stage);
      toast.show(
        input.direction === "run"
          ? `${what} ${started ? "started" : "done"}`
          : `${what} undone`,
        {
          variant: "success",
        },
      );
    },
    onError: (caught, input) =>
      toast.error(
        `${STAGE_LABELS[input.stage]} on ${shortKey(input.key)} failed: ${String(caught)}`,
      ),
    onSettled: refresh,
  });
}

/** Keyed by direction as well as stage, for the reason useStagingKeys is. AC-Q5. */
export function useActingKeys(): (string | undefined)[] {
  return useMutationState({
    filters: { mutationKey: ACTION_MUTATION, status: "pending" },
    select: (mutation: Mutation<unknown, Error, ActionInput>) => {
      const input = mutation.state.variables;
      return input && `${input.key}:${input.stage}:${input.direction}`;
    },
  });
}

/**
 * The detail view's summary. No success toast: the card filling in is the
 * feedback, and the four fields are the result.
 *
 * `ok` here means the turn started. A refusal to start is a toast, because the
 * press did nothing and nothing on screen would say so. A failure of the turn
 * itself arrives minutes later on the record, where the card shows it: the
 * reason matters, and a toast fired at a window James has since left does not
 * carry it. AC-K3, AC-Q4.
 */
export function useSummarise(refresh: () => void) {
  const summarise = useRpc(runSummary);
  const toast = useToast();

  return useMutation({
    mutationKey: SUMMARY_MUTATION,
    mutationFn: (key: string) => summarise({ key }),
    onSuccess: (result, key) => {
      if (result.ok) return;
      toast.error(
        `Summary failed for ${shortKey(key)}: ${result.error ?? "no reason given"}`,
      );
    },
    onError: (caught, key) =>
      toast.error(`Summary failed for ${shortKey(key)}: ${String(caught)}`),
    onSettled: refresh,
  });
}

/**
 * The press, not the turn. It covers the moment between pressing and the inbox
 * reporting the turn as running, after which the server's own list takes over.
 */
export function useSummarisingKeys(): (string | undefined)[] {
  return useMutationState({
    filters: { mutationKey: SUMMARY_MUTATION, status: "pending" },
    select: (mutation: Mutation<unknown, Error, string>) =>
      mutation.state.variables,
  });
}

/**
 * The clock badge's press. No success toast: the badge resetting to `0m` and the
 * rows redrawing is the feedback. A sweep reaches GitHub and can take half a
 * minute, so the badge shows it is working for as long as it runs. AC-N2.
 */
export function useSweep(refresh: () => void) {
  const sweep = useRpc(sweepNow);
  const toast = useToast();

  return useMutation({
    mutationKey: SWEEP_MUTATION,
    mutationFn: () => sweep({}),
    onSuccess: (result) => {
      if (result.ok) return;
      toast.error(`The sweep failed: ${result.error ?? "no reason given"}`);
    },
    onError: (caught) => toast.error(`The sweep failed: ${String(caught)}`),
    onSettled: refresh,
  });
}

/**
 * Takes in a pull request James pasted.
 *
 * The toast carries the whole of the failure, because every way this refuses is
 * something about the string he pasted and he cannot fix what he cannot read.
 * A record already in the inbox is a success with nothing to say, so the caller
 * takes him to the row instead. AC-AK5.
 */
export function useAddPullRequest(refresh: () => void) {
  const add = useRpc(addPullRequest);
  const toast = useToast();

  return useMutation({
    mutationKey: ADD_MUTATION,
    mutationFn: (link: string) => add({ link }),
    onSuccess: (result) => {
      if (!result.ok) {
        toast.error(result.error ?? "The pull request could not be added");
        return;
      }
      if (result.already === "restored" && result.key) {
        toast.show(`${shortKey(result.key)} restored to the inbox`, {
          variant: "success",
        });
        return;
      }
      if (result.already) return;
      if (result.key) toast.show(`Taking in ${shortKey(result.key)}`);
    },
    onError: (caught) =>
      toast.error(`The pull request could not be added: ${String(caught)}`),
    onSettled: refresh,
  });
}

/**
 * The wizard's own read: the agent's findings, the verification list, and the
 * draft as the server holds it. Separate from the inbox query because it reads a
 * file the inbox never touches, and because it must not refetch on an interval
 * while James is typing into it.
 */
export function useFeedback(key: string) {
  const read = useRpc(readFeedback);
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: feedbackQuery(key),
    queryFn: () => read({ key }),
    refetchOnWindowFocus: false,
  });

  return {
    ...query,
    refresh: () =>
      queryClient.invalidateQueries({ queryKey: feedbackQuery(key) }),
  };
}

/**
 * Saves the draft on each discrete press and on each step change. No toast on
 * success: the wizard moving on is the feedback. A failure is raised, because a
 * draft James believes is saved and is not would cost him the typing. AC-G6.
 */
export function useSaveDraft(key: string) {
  const save = useRpc(saveDraft);
  const toast = useToast();

  return useMutation({
    mutationFn: (draft: Draft) => save({ key, draft }),
    onSuccess: (result) => {
      if (result.ok) return;
      toast.error(
        `The draft did not save: ${result.error ?? "no reason given"}`,
      );
    },
    onError: (caught) =>
      toast.error(`The draft did not save: ${String(caught)}`),
  });
}

/** Validates the included findings against the live diff, on reaching the preview. */
export function useCheckAnchors(key: string) {
  const check = useRpc(checkAnchors);
  return useMutation({ mutationFn: () => check({ key }) });
}

/**
 * The one outward press in the wizard. Everything before it is local. AC-G9.
 */
export function useSubmitReview(key: string, refresh: () => void) {
  const submit = useRpc(submitFeedback);
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (event: ReviewEvent) => submit({ key, event }),
    onSuccess: (result) => {
      if (!result.ok) {
        toast.error(
          `The review was not submitted: ${result.error ?? "no reason given"}`,
        );
        return;
      }
      const count =
        result.comments === 1
          ? "1 comment"
          : `${result.comments ?? 0} comments`;
      toast.show(`Review submitted, ${count}`, { variant: "success" });
      // The review went out. Anything after it that did not is still a failure.
      if (result.warning) toast.error(result.warning);
      if (result.excluded.length > 0) {
        toast.error(
          `${result.excluded.length} finding${result.excluded.length === 1 ? "" : "s"} dropped: the diff moved since the preview`,
        );
      }
    },
    onError: (caught) =>
      toast.error(`The review was not submitted: ${String(caught)}`),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: feedbackQuery(key) });
      refresh();
    },
  });
}

/**
 * The pull request's review threads, read live.
 *
 * Nothing is stored for these, so there is no cache to go stale against: the
 * query is the read. It does not refetch on focus for the same reason the
 * feedback query does not, which is that a list reordering under a half armed
 * Resolve press would resolve the wrong thread.
 */
export function useThreads(key: string) {
  const read = useRpc(readThreads);
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: threadsQuery(key),
    queryFn: () => read({ key }),
    refetchOnWindowFocus: false,
  });

  return {
    ...query,
    refresh: () =>
      queryClient.invalidateQueries({ queryKey: threadsQuery(key) }),
  };
}

export interface ThreadInput {
  id: string;
  resolved: boolean;
  /** What the toast calls it, so a failure names the file rather than a node id. */
  label: string;
}

/** An outward GitHub write, so it is a confirm press on the screen. AC-AP8. */
export function useResolveThread(key: string) {
  const resolve = useRpc(setThreadResolved);
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationKey: THREAD_MUTATION,
    mutationFn: (input: ThreadInput) =>
      resolve({ key, id: input.id, resolved: input.resolved }),
    onSuccess: (result, input) => {
      const verb = input.resolved ? "resolve" : "reopen";
      if (!result.ok) {
        toast.error(
          `Could not ${verb} ${input.label}: ${result.error ?? "no reason given"}`,
        );
        return;
      }
      toast.show(`${input.label} ${input.resolved ? "resolved" : "reopened"}`, {
        variant: "success",
      });
    },
    onError: (caught, input) =>
      toast.error(
        `Could not ${input.resolved ? "resolve" : "reopen"} ${input.label}: ${String(caught)}`,
      ),
    onSettled: () =>
      void queryClient.invalidateQueries({ queryKey: threadsQuery(key) }),
  });
}

/** Which threads have a write in flight, so each row can show its own. R5. */
export function useResolvingThreads(): (string | undefined)[] {
  return useMutationState({
    filters: { mutationKey: THREAD_MUTATION, status: "pending" },
    select: (mutation: Mutation<unknown, Error, ThreadInput>) =>
      mutation.state.variables?.id,
  });
}
