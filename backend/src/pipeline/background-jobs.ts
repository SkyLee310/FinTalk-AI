/**
 * Tracks work that outlives the request which started it.
 *
 * Capture answers 202 and keeps processing, so at any moment there may be a
 * transaction in flight that no request is waiting on. Two things go wrong
 * without a handle on it, and they turned out to be the same missing thing:
 *
 *  - On shutdown the container is killed mid-transaction, leaving the meeting in
 *    PROCESSING for ever with no request left to fail it.
 *  - In tests, teardown truncates the tables while a pipeline still holds locks
 *    on them. TRUNCATE wants an AccessExclusiveLock, the pipeline wants an
 *    AccessShareLock on a table TRUNCATE already holds, and Postgres reports a
 *    deadlock — which is how this was found.
 *
 * Both need a way to wait for in-flight work, which is all this is.
 */
export class BackgroundJobs {
  private readonly inFlight = new Set<Promise<unknown>>();

  /**
   * Starts a job without waiting for it, but keeps a handle so drain() can.
   *
   * The failure handler is required rather than optional: a tracked promise must
   * never reject on its own, or drain() would raise an error that belongs to a
   * request already answered, at whatever unrelated moment the drain happens.
   */
  run(job: Promise<unknown>, onError: (error: unknown) => void): void {
    const tracked = job.catch(onError).finally(() => {
      this.inFlight.delete(tracked);
    });

    this.inFlight.add(tracked);
  }

  /** Resolves once every job started so far has settled. */
  async drain(): Promise<void> {
    // A job may start another, so the set is re-read rather than snapshotted.
    while (this.inFlight.size > 0) {
      await Promise.all([...this.inFlight]);
    }
  }

  /** In-flight count, for assertions and for logging at shutdown. */
  get size(): number {
    return this.inFlight.size;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Exposed so a test can wait for capture work before touching the tables. */
    readonly backgroundJobs: BackgroundJobs;
  }
}
