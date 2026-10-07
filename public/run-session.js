const KEY = 'agent-studio.viewed-run';
const SAFE_ID = /^run_[A-Za-z0-9_-]{1,80}$/;
export function readRunSession(storage) {
  try {
    const id = storage.getItem(KEY);
    if (!id) return { id: null, invalid: false };
    if (!SAFE_ID.test(id)) { storage.removeItem(KEY); return { id: null, invalid: true }; }
    return { id, invalid: false };
  } catch { return { id: null, invalid: false }; }
}
export function rememberRun(storage, id) {
  try { if (id == null) storage.removeItem(KEY); else if (SAFE_ID.test(id)) storage.setItem(KEY, id); } catch { /* storage disabled: backend still owns the run */ }
}
