/**
 * FIFO: `release` hands the slot straight to the longest waiter. Otherwise a loop that
 * releases and immediately acquires again would take its own slot back before the woken
 * waiter runs, and with one slot shared by two pull loops the second would never get it.
 */
export class Semaphore {
  private inUse = 0;
  private waiters: (() => void)[] = [];

  constructor(readonly capacity: number) {
    if (capacity < 1) throw new Error('semaphore capacity must be >= 1');
  }

  get available(): number {
    return this.capacity - this.inUse;
  }

  get active(): number {
    return this.inUse;
  }

  get waiting(): number {
    return this.waiters.length;
  }

  /** Waits for a free slot and takes it. */
  async acquire(): Promise<void> {
    if (this.inUse < this.capacity && this.waiters.length === 0) {
      this.inUse++;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  release(n = 1): void {
    for (let i = 0; i < n; i++) {
      if (this.inUse <= 0) throw new Error('semaphore released more than reserved');
      const next = this.waiters.shift();
      // The slot passes to `next` as is, so `inUse` stays the same.
      if (next) next();
      else this.inUse--;
    }
  }
}
