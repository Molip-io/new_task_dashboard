export function createExpiringCache({ ttlMs = 60_000, now = () => Date.now() } = {}) {
  let value = null;
  let expiresAt = 0;

  return {
    get() {
      return value && now() < expiresAt ? value : null;
    },
    set(next) {
      value = next;
      expiresAt = now() + ttlMs;
      return next;
    },
    clear() {
      value = null;
      expiresAt = 0;
    },
  };
}
