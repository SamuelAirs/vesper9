// Small shared pieces for cartridges, so a new app is one self-contained file.

// The field record shown by the system menu: runs counted, best milestone kept,
// and the last result. `result` may carry any keys; give them display names with
// a "record" map in the cartridge's catalog entry.
export function recordRun(ctx, result) {
  const previous = ctx.progress?.() || {};
  return ctx.saveProgress?.({ schema: 1, runs: (previous.runs || 0) + 1, last: result,
    milestone: Math.max(previous.milestone || 0, result.milestone || 0) })?.catch?.(ctx.error);
}
