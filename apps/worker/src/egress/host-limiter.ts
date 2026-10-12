import { Semaphore } from '@pdp/messaging';

/**
 * Caps concurrent outbound requests per host, so jobs that fetch sources by URL
 * (Stage 3) cannot pile onto one slow or hostile server. Idle hosts are dropped,
 * so the map does not grow with every host ever seen.
 */
export class HostConcurrencyLimiter {
  private readonly hosts = new Map<string, Semaphore>();

  constructor(private readonly perHost: number) {}

  async run<T>(url: string | URL, task: () => Promise<T>): Promise<T> {
    const host = new URL(url).host.toLowerCase();
    let semaphore = this.hosts.get(host);
    if (!semaphore) {
      semaphore = new Semaphore(this.perHost);
      this.hosts.set(host, semaphore);
    }

    await semaphore.acquire();
    try {
      return await task();
    } finally {
      semaphore.release();
      if (semaphore.active === 0 && semaphore.waiting === 0) this.hosts.delete(host);
    }
  }

  get trackedHosts(): number {
    return this.hosts.size;
  }
}
