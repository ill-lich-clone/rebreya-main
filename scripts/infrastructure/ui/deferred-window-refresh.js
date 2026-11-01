const pending = new WeakMap();

/** Coalesce hidden-window refreshes and apply the latest one after restoration. */
export function deferRefreshUntilMaximized(app, refresh) {
  if (!app || typeof app.maximize !== "function" || typeof refresh !== "function") return false;
  const existing = pending.get(app);
  if (existing) { existing.refresh = refresh; return true; }
  const original = app.maximize;
  const state = { refresh };
  const wrapped = async function (...args) {
    const result = await original.apply(this, args);
    if (pending.get(app) !== state || app.minimized === true || app._minimized === true) return result;
    pending.delete(app);
    if (app.maximize === wrapped) app.maximize = original;
    if (app.rendered !== false) await state.refresh();
    return result;
  };
  try { app.maximize = wrapped; } catch { return false; }
  if (app.maximize !== wrapped) return false;
  pending.set(app, state);
  return true;
}
