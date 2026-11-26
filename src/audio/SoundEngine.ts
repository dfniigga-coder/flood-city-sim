/**
 * Procedural Web Audio synthesizer for rain, rushing floodwaters,
 * dam breach explosions, delayed thunderclaps, and distant emergency sirens.
 * Zero external audio assets required.
 */
export class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private rainGain: GainNode | null = null;
  private floodGain: GainNode | null = null;
  private floodFilter: BiquadFilterNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  public enabled = true;

  private ensureContext(): boolean {
    if (!this.enabled) return false;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return false;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.55;
      this.masterGain.connect(this.ctx.destination);

      // Build 3-second seamless pink/white noise buffer
      const sr = this.ctx.sampleRate;
      const len = sr * 3;
      this.noiseBuffer = this.ctx.createBuffer(1, len, sr);
      const data = this.noiseBuffer.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.997 * b0 + white * 0.029;
        b1 = 0.985 * b1 + white * 0.032;
        b2 = 0.950 * b2 + white * 0.048;
        data[i] = (b0 + b1 + b2 + white * 0.18) * 0.45;
      }

      // Rain bed
      const rainSrc = this.ctx.createBufferSource();
      rainSrc.buffer = this.noiseBuffer;
      rainSrc.loop = true;
      const rainHP = this.ctx.createBiquadFilter();
      rainHP.type = 'bandpass';
      rainHP.frequency.value = 1800;
      rainHP.Q.value = 0.55;
      this.rainGain = this.ctx.createGain();
      this.rainGain.gain.value = 0.0;
      rainSrc.connect(rainHP).connect(this.rainGain).connect(this.masterGain);
      rainSrc.start();

      // Flood roar bed
      const floodSrc = this.ctx.createBufferSource();
      floodSrc.buffer = this.noiseBuffer;
      floodSrc.loop = true;
      this.floodFilter = this.ctx.createBiquadFilter();
      this.floodFilter.type = 'lowpass';
      this.floodFilter.frequency.value = 340;
      this.floodGain = this.ctx.createGain();
      this.floodGain.gain.value = 0.0;
      floodSrc.connect(this.floodFilter).connect(this.floodGain).connect(this.masterGain);
      floodSrc.start();
    }

    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return true;
  }

  public unlock(): void {
    this.ensureContext();
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(enabled ? 0.55 : 0.0, this.ctx.currentTime, 0.08);
    }
    if (enabled) {
      this.ensureContext();
    }
  }

  public updateAmbience(stormIntensity: number, totalFlux: number, cameraHeight: number): void {
    if (!this.ctx || !this.rainGain || !this.floodGain || !this.floodFilter || !this.enabled) return;
    if (this.ctx.state !== 'running') return;

    const now = this.ctx.currentTime;
    const distAtten = 1 / (1 + Math.max(0, cameraHeight - 18) * 0.014);
    const targetRain = stormIntensity * 0.24 * distAtten;
    const targetFlood = Math.min(0.45, totalFlux * 0.0018) * distAtten;

    this.rainGain.gain.setTargetAtTime(targetRain, now, 0.15);
    this.floodGain.gain.setTargetAtTime(targetFlood, now, 0.15);
    this.floodFilter.frequency.setTargetAtTime(220 + Math.min(700, totalFlux * 1.4), now, 0.15);
  }

  public playDamBreach(): void {
    if (!this.ensureContext() || !this.ctx || !this.masterGain || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;

    // Sub-bass explosion boom
    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(115, now);
    osc.frequency.exponentialRampToValueAtTime(28, now + 1.8);
    oscGain.gain.setValueAtTime(0.65, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 2.1);

    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 180;
    osc.connect(lp).connect(oscGain).connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 2.2);

    // Concrete collapse rumble burst
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'lowpass';
    bp.frequency.setValueAtTime(950, now);
    bp.frequency.exponentialRampToValueAtTime(140, now + 2.6);
    const nGain = this.ctx.createGain();
    nGain.gain.setValueAtTime(0.8, now);
    nGain.gain.exponentialRampToValueAtTime(0.01, now + 2.8);
    src.connect(bp).connect(nGain).connect(this.masterGain);
    src.start(now);
    src.stop(now + 2.9);

    this.playSiren();
  }

  public playThunder(delaySec = 0.25): void {
    if (!this.ensureContext() || !this.ctx || !this.masterGain || !this.noiseBuffer) return;
    const start = this.ctx.currentTime + delaySec;

    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(680, start);
    lp.frequency.exponentialRampToValueAtTime(75, start + 2.2);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.001, start);
    gain.gain.linearRampToValueAtTime(0.55, start + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 2.4);

    src.connect(lp).connect(gain).connect(this.masterGain);
    src.start(start);
    src.stop(start + 2.5);
  }

  public playSiren(): void {
    if (!this.ensureContext() || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 620;

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(420, now);
    osc.frequency.linearRampToValueAtTime(720, now + 1.1);
    osc.frequency.linearRampToValueAtTime(420, now + 2.3);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.08, now + 0.4);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 2.5);

    osc.connect(bp).connect(gain).connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 2.6);
  }
}
