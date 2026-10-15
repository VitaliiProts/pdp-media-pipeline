/** jsdom has no IntersectionObserver; tests reveal the observed element by hand. */
export class FakeIntersectionObserver implements IntersectionObserver {
  private static instances: FakeIntersectionObserver[] = [];
  readonly root = null;
  readonly rootMargin: string;
  readonly scrollMargin = '0px';
  readonly thresholds: readonly number[] = [];
  private targets: Element[] = [];

  constructor(
    private readonly callback: IntersectionObserverCallback,
    options: IntersectionObserverInit = {},
  ) {
    this.rootMargin = options.rootMargin ?? '0px';
    FakeIntersectionObserver.instances.push(this);
  }

  static latest(): FakeIntersectionObserver | undefined {
    return FakeIntersectionObserver.instances.findLast((observer) => observer.targets.length > 0);
  }

  static reset(): void {
    FakeIntersectionObserver.instances = [];
  }

  observe(target: Element): void {
    this.targets.push(target);
  }

  unobserve(target: Element): void {
    this.targets = this.targets.filter((t) => t !== target);
  }

  disconnect(): void {
    this.targets = [];
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  reveal(): void {
    const entries = this.targets.map((target) => {
      const rect = target.getBoundingClientRect();
      return {
        target,
        isIntersecting: true,
        intersectionRatio: 1,
        time: 0,
        boundingClientRect: rect,
        intersectionRect: rect,
        rootBounds: null,
      };
    });
    this.callback(entries, this);
  }
}
