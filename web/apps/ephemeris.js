// EPHEMERIS — placeholder instrument. Its author replaces this whole file.
export class Ephemeris {
  constructor(ctx) {
    this.ctx = ctx;
    this.navigation = true;
    ctx.content('<div class="utility-panel"><h2>EPHEMERIS</h2><p>This instrument has not been installed yet.</p></div>');
    ctx.actions([{ label: "RETURN TO DASHBOARD", run: ctx.home }]);
  }
}
