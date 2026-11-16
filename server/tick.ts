import { log } from "./log";

/**
 * One stage of a tick, which cannot take the rest of the tick down with it.
 *
 * Every stage of a tick is independent: a GitHub notification poll that aborts
 * says nothing about whether the reap should run. Unguarded, one of them
 * throwing reached `tick`'s own catch and skipped every stage after it, which
 * is how eleven `AbortError`s in one morning cost eleven sweeps, eleven reaps
 * and eleven Linear polls rather than eleven notification polls. AC-AS4.
 *
 * The failure is logged and then dropped. A stage that needs to be retried
 * says so through state it owns, not by taking its siblings down.
 */
export async function stage(
  what: string,
  work: () => Promise<unknown>,
): Promise<void> {
  try {
    await work();
  } catch (error) {
    log(`${what} failed: ${String(error)}`);
  }
}
