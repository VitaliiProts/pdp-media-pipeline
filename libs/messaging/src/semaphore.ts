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

  /** Waits for at least one free slot, then reserves every free slot and returns how many. */
  async reserveAll(): Promise<number> {
    while (this.available <= 0) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    const n = this.available;
    this.inUse += n;
    return n;
  }

  release(n = 1): void {
    this.inUse -= n;
    if (this.inUse < 0) throw new Error('semaphore released more than reserved');
    for (let i = 0; i < n; i++) this.waiters.shift()?.();
  }
}
