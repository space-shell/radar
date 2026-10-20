/**
 * Runs the work once at a time.
 *
 * A second call while one is in flight waits for that one and reports that it
 * joined, rather than starting a second. The sweep needs this because two
 * concurrent reconciles would each read the same pull request as new before
 * either had written a record for it, and the clock badge puts a second caller
 * one press away. R2.
 *
 * A failure propagates to every caller waiting on it, and clears the slot, so the
 * next press tries again rather than inheriting a dead promise.
 */
export function singleFlight(
  work: () => Promise<void>,
): () => Promise<boolean> {
  let running: Promise<void> | null = null;

  return async () => {
    if (running) {
      await running;
      return true;
    }

    running = work().finally(() => {
      running = null;
    });
    await running;
    return false;
  };
}

/**
 * Runs the work once at a time, and once more afterwards if anything asked while
 * it was running.
 *
 * `singleFlight` joins the run already going, which is right for a press: the
 * caller wants the answer that run is producing. It is wrong for an event. An
 * event says something changed now, and a run already half way through has read
 * the half that covers it, so joining would drop the change. The trailing run is
 * what makes an event arriving mid pass still get seen, and collapsing every
 * event that arrives during one pass into that one trailing run is what stops a
 * burst of them queueing a pass each. AC-AE2.
 */
export function coalesce(work: () => Promise<void>): () => Promise<void> {
  let running: Promise<void> | null = null;
  let again = false;

  const cycle = async (): Promise<void> => {
    try {
      for (;;) {
        // Cleared before the pass, not after: anything asked from here on is
        // asking about state this pass may already have read past.
        again = false;
        await work();
        // Read before the slot clears, with no await between the two, so an ask
        // cannot land in the gap and find neither a run to join nor one to start.
        if (!again) return;
      }
    } finally {
      running = null;
    }
  };

  return async () => {
    if (running) {
      again = true;
      await running;
      return;
    }
    running = cycle();
    await running;
  };
}
