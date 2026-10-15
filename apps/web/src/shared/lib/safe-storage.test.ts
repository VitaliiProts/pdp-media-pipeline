import { safeStorage } from './safe-storage';

describe('safeStorage', () => {
  it('reads, writes and removes like localStorage', () => {
    safeStorage.set('k', 'v');
    expect(window.localStorage.getItem('k')).toBe('v');
    expect(safeStorage.get('k')).toBe('v');
    safeStorage.remove('k');
    expect(safeStorage.get('k')).toBeNull();
  });

  it('swallows the errors of blocked storage', () => {
    const blocked = () => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    };
    const spies = [
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked),
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked),
      vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(blocked),
    ];
    onTestFinished(() => spies.forEach((spy) => spy.mockRestore()));

    expect(safeStorage.get('k')).toBeNull();
    expect(() => safeStorage.set('k', 'v')).not.toThrow();
    expect(() => safeStorage.remove('k')).not.toThrow();
  });
});
