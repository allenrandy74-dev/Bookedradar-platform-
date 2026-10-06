// In-memory atomic adapter for existing isolated behavior tests only.
// Production/restart tests use JsonStateStore on disk.
export function attemptStore() {
  const records = new Map();
  return {
    async claimAttempt(key, intent) {
      const record = records.get(key);
      if (record) {
        for (const field of ['tenantId','callId','target','kind','fingerprint']) {
          if (record[field] !== intent[field]) throw Error('attempt_intent_conflict');
        }
        return { claimed: false, record: structuredClone(record) };
      }
      const next = { ...intent, claimToken: key, status: 'pending' }; records.set(key, next);
      return { claimed: true, record: structuredClone(next) };
    },
    async finishAttempt(key, patch) { const next = { ...records.get(key), ...patch }; records.set(key, next); return structuredClone(next); },
  };
}
