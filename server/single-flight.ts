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
