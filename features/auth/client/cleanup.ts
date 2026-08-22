export function runCleanupCallbacks(callbacks: Set<() => void>): void {
  for (const cb of callbacks) {
    try {
      cb();
    } catch {
      // individual cleanup failure must not block others
    }
  }
}

export type CleanupRegistry = {
  register: (callback: () => void) => () => void;
  runAll: () => void;
};

export function createCleanupRegistry(): CleanupRegistry {
  const callbacks = new Set<() => void>();

  return {
    register(callback: () => void) {
      callbacks.add(callback);
      return () => {
        callbacks.delete(callback);
      };
    },
    runAll() {
      runCleanupCallbacks(callbacks);
    },
  };
}
