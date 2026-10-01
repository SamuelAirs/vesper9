// RESONANCE — placeholder instrument. Its author replaces this whole file.
export class Resonance {
  constructor(ctx) {
    this.ctx = ctx;
    this.navigation = true;
    ctx.content('<div class="utility-panel"><h2>RESONANCE</h2><p>This instrument has not been installed yet.</p></div>');
    ctx.actions([{ label: "RETURN TO DASHBOARD", run: ctx.home }]);
  }
}
