/** Tiny WebAudio synth – no audio files needed. */
class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  enabled = true;

  /** Must be called from a user gesture (browser autoplay policy). */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      const len = Math.floor(this.ctx.sampleRate * 0.6);
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.setEnabled(this.enabled);
    } catch {
      this.ctx = null;
    }
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? 0.45 : 0;
  }

  private get ok() {
    return !!this.ctx && this.enabled && this.ctx.state === 'running';
  }

  private tone(t: number, f0: number, f1: number, dur: number, type: OscillatorType, vol: number) {
    const c = this.ctx!;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(1e-4, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(1e-4, t + dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private hiss(t: number, dur: number, freq: number, vol: number) {
    const c = this.ctx!;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(freq * 3, t + dur);
    f.Q.value = 1.2;
    const g = c.createGain();
    g.gain.setValueAtTime(1e-4, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.03);
    g.gain.exponentialRampToValueAtTime(1e-4, t + dur);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  place(p: 'X' | 'O') {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    if (p === 'X') {
      this.tone(t, 540, 1080, 0.1, 'square', 0.1);
      this.tone(t + 0.035, 800, 1500, 0.08, 'triangle', 0.09);
    } else {
      this.tone(t, 900, 450, 0.13, 'sine', 0.2);
      this.tone(t + 0.03, 640, 320, 0.11, 'triangle', 0.09);
    }
  }

  click() {
    if (this.ok) this.tone(this.ctx!.currentTime, 1200, 900, 0.05, 'triangle', 0.08);
  }

  nope() {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    this.tone(t, 180, 140, 0.12, 'sawtooth', 0.06);
  }

  hint() {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    [988, 1319].forEach((f, i) => this.tone(t + i * 0.08, f, f, 0.18, 'triangle', 0.1));
  }

  win() {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(t + i * 0.09, f, f * 1.01, 0.22, 'square', 0.08));
    this.tone(t + 0.45, 1568, 2093, 0.45, 'triangle', 0.13);
    this.hiss(t + 0.4, 0.5, 2000, 0.1);
  }

  lose() {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    [392, 330, 262].forEach((f, i) => this.tone(t + i * 0.16, f, f * 0.9, 0.24, 'sawtooth', 0.05));
  }

  draw() {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    this.tone(t, 440, 440, 0.16, 'triangle', 0.13);
    this.tone(t + 0.16, 440, 392, 0.22, 'triangle', 0.13);
  }
}

export const sfx = new Sfx();
