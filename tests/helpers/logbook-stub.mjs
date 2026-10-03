// The console logbook's context calls (ctx.today, ctx.daily, ctx.dailyMet, ctx.feat), as the host
// gives them to a game, recorded on ctx.book. Add them before the game is made: AppGuard wraps the
// context calls that exist when it is built.
export function withLogbook(ctx, { picked = true, done = false } = {}) {
  const book = { picked, done, goal: "", own: false, met: 0, feats: [] };
  ctx.book = book;
  ctx.today = () => (book.picked ? { goal: book.goal || "Finish a run", done: book.done, own: book.own } : null);
  ctx.daily = (text) => { if (book.picked && !book.done) { book.goal = String(text); book.own = true; } };
  ctx.dailyMet = () => { if (book.picked && !book.done) { book.done = true; book.met++; } };
  ctx.feat = (id, name) => {
    if (book.feats.some(([i]) => i === id)) return false;
    book.feats.push([id, name]);
    return true;
  };
  return ctx;
}
