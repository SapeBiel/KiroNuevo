// Efectos de sonido sintetizados con Web Audio (sin archivos externos).

export class Sfx {
  constructor(enabled = true) {
    this.enabled = enabled;
    this.context = null;
    this.master = null;
  }

  /** Debe llamarse tras un gesto del usuario para cumplir las políticas del navegador. */
  unlock() {
    if (!this.context) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      this.context = new AudioCtx();
      this.master = this.context.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(this.context.destination);
    }
    if (this.context.state === 'suspended') this.context.resume();
  }

  setEnabled(value) {
    this.enabled = value;
    if (!value) this.stopScreech();
  }

  tone(freq, duration, { type = 'sine', volume = 0.4, delay = 0, slideTo = null } = {}) {
    if (!this.enabled || !this.context) return;
    const ctx = this.context;
    const start = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, start + duration);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(start);
    osc.stop(start + duration + 0.05);
  }

  noise(duration, volume = 0.3) {
    if (!this.enabled || !this.context) return;
    const ctx = this.context;
    const length = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    gain.gain.value = volume;
    source.buffer = buffer;
    source.connect(gain);
    gain.connect(this.master);
    source.start();
  }

  /** Chirrido de neumáticos en bucle (ruido filtrado) mientras dura el derrape. */
  startScreech() {
    if (!this.enabled || !this.context || this.screech) return;
    const ctx = this.context;
    const length = Math.floor(ctx.sampleRate * 0.5);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1900;
    filter.Q.value = 6;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.16, ctx.currentTime + 0.08);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    source.start();
    this.screech = { source, gain, filter };
  }

  stopScreech() {
    if (!this.screech || !this.context) return;
    const { source, gain } = this.screech;
    const now = this.context.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);
    source.stop(now + 0.2);
    this.screech = null;
  }

  /** El chirrido sube de tono cuanto más cruzado va el vehículo (slip 0..1). */
  setScreechIntensity(slip) {
    if (!this.screech || !this.context) return;
    this.screech.filter.frequency.setTargetAtTime(1500 + slip * 1400, this.context.currentTime, 0.05);
  }

  play(name) {
    switch (name) {
      case 'boost':
        this.noise(0.35, 0.22);
        this.tone(220, 0.4, { type: 'sawtooth', volume: 0.22, slideTo: 660 });
        break;
      case 'click': this.tone(660, 0.06, { type: 'triangle', volume: 0.25 }); break;
      case 'load': this.tone(420, 0.09, { type: 'square', volume: 0.18 }); this.tone(640, 0.12, { type: 'square', volume: 0.18, delay: 0.08 }); break;
      case 'deliver':
        [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.18, { type: 'triangle', volume: 0.4, delay: i * 0.07 }));
        break;
      case 'coin': this.tone(988, 0.07, { type: 'square', volume: 0.12 }); this.tone(1319, 0.18, { type: 'square', volume: 0.12, delay: 0.07 }); break;
      case 'buy': this.tone(520, 0.1, { type: 'triangle', volume: 0.35, slideTo: 780 }); this.tone(780, 0.16, { type: 'triangle', volume: 0.3, delay: 0.09 }); break;
      case 'hire': [392, 494, 587].forEach((f, i) => this.tone(f, 0.22, { type: 'triangle', volume: 0.3, delay: i * 0.06 })); break;
      case 'error': this.tone(170, 0.18, { type: 'sawtooth', volume: 0.2, slideTo: 110 }); break;
      case 'crash': this.noise(0.22, 0.35); this.tone(90, 0.2, { type: 'square', volume: 0.25, slideTo: 50 }); break;
      case 'jump': this.tone(300, 0.12, { type: 'triangle', volume: 0.12, slideTo: 520 }); break;
      // Farola derribada: golpe metálico y cristal de la bombilla
      case 'lamp':
        this.tone(520, 0.28, { type: 'triangle', volume: 0.22, slideTo: 260 });
        this.tone(1760, 0.08, { type: 'square', volume: 0.08, delay: 0.03 });
        this.noise(0.12, 0.18);
        this.tone(140, 0.18, { type: 'square', volume: 0.16, delay: 0.5, slideTo: 70 });
        break;
      case 'order': this.tone(880, 0.09, { type: 'sine', volume: 0.22 }); break;
      case 'urgent': this.tone(900, 0.1, { type: 'square', volume: 0.2 }); this.tone(900, 0.1, { type: 'square', volume: 0.2, delay: 0.16 }); break;
      case 'levelUp':
        [392, 523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.3, { type: 'triangle', volume: 0.4, delay: i * 0.1 }));
        break;
      case 'achievement': [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, 0.4, { type: 'sine', volume: 0.3, delay: i * 0.08 })); break;
      default: break;
    }
  }
}
