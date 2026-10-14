// The squelch: opens when the signal level stays above the threshold for `attackMs`, and closes
// once it has been below it for `hangMs`. Pure logic, shared by the app and the command line version.
export class Gate {
  constructor({ threshold = 0.02, attackMs = 120, hangMs = 1500, always = false } = {}) {
    this.threshold = threshold; this.attackMs = attackMs; this.hangMs = hangMs; this.always = always;
    this.open = !!always; this._above = null; this._below = null;
  }
  configure(o) { Object.assign(this, o); if (this.always) { this.open = true; this._above = this._below = null; } }
  // level: 0..1 RMS; now: milliseconds. Returns "open", "close" when the state changes, else null.
  update(level, now) {
    if (this.always) { if (!this.open) { this.open = true; return "open"; } return null; }
    if (level >= this.threshold) {
      this._below = null;
      if (!this.open) {
        if (this._above == null) this._above = now;
        if (now - this._above >= this.attackMs) { this.open = true; this._above = null; return "open"; }
      }
    } else {
      this._above = null;
      if (this.open) {
        if (this._below == null) this._below = now;
        if (now - this._below >= this.hangMs) { this.open = false; this._below = null; return "close"; }
      }
    }
    return null;
  }
  reset() { this.open = !!this.always; this._above = this._below = null; }
}
