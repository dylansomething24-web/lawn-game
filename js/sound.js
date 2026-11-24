// All sound is made live with Web Audio: no audio files to load.
const Sound = {
    ctx: null, on: true, master: null, eng: null, started: false,

    init() {
        if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        const c = this.ctx = new AC();
        this.master = c.createGain(); this.master.gain.value = this.on ? 0.7 : 0; this.master.connect(c.destination);

        // Engine: two detuned low oscillators, a lowpass, and a fast wobble for the chug.
        const o1 = c.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 46;
        const o2 = c.createOscillator(); o2.type = 'square'; o2.frequency.value = 92.7;
        const o2g = c.createGain(); o2g.gain.value = 0.35;
        const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 2;
        const wob = c.createGain(); wob.gain.value = 0.7;
        const lfo = c.createOscillator(); lfo.frequency.value = 21;
        const lfoG = c.createGain(); lfoG.gain.value = 0.3;
        lfo.connect(lfoG); lfoG.connect(wob.gain);
        const level = c.createGain(); level.gain.value = 0;
        o1.connect(lp); o2.connect(o2g); o2g.connect(lp); lp.connect(wob); wob.connect(level); level.connect(this.master);
        o1.start(); o2.start(); lfo.start();
        this.eng = { o1, o2, lp, lfo, level };
    },

    toggle() {
        this.on = !this.on;
        if (this.master) this.master.gain.setTargetAtTime(this.on ? 0.7 : 0, this.ctx.currentTime, 0.05);
        return this.on;
    },

    // mode: 'off' | 'mower' | 'trimmer'; busy = moving
    engine(mode, busy) {
        if (!this.eng) return;
        const t = this.ctx.currentTime, e = this.eng;
        let lvl = 0, f = 46, cut = 420, lf = 21;
        if (mode === 'mower')   { lvl = busy ? 0.16 : 0.07; f = busy ? 52 : 44; cut = busy ? 620 : 380; lf = busy ? 26 : 18; }
        if (mode === 'trimmer') { lvl = busy ? 0.07 : 0.035; f = busy ? 150 : 120; cut = 2400; lf = 40; }
        if (!this.started) lvl = 0;
        e.level.gain.setTargetAtTime(lvl, t, 0.08);
        e.o1.frequency.setTargetAtTime(f, t, 0.12);
        e.o2.frequency.setTargetAtTime(f * 2.015, t, 0.12);
        e.lp.frequency.setTargetAtTime(cut, t, 0.1);
        e.lfo.frequency.setTargetAtTime(lf, t, 0.1);
    },

    noiseBurst(at, dur, freq, gain) {
        const c = this.ctx, n = Math.floor(c.sampleRate * dur), buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
        const src = c.createBufferSource(); src.buffer = buf;
        const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 0.8;
        const g = c.createGain(); g.gain.value = gain;
        src.connect(f); f.connect(g); g.connect(this.master); src.start(at);
    },

    pullStart() {
        if (!this.ctx || this.started) return;
        const t = this.ctx.currentTime;
        this.noiseBurst(t, 0.18, 300, 0.5);
        this.noiseBurst(t + 0.28, 0.2, 260, 0.6);
        this.started = true;
    },

    tone(freq, at, dur, type, gain) {
        const c = this.ctx, o = c.createOscillator(), g = c.createGain();
        o.type = type; o.frequency.value = freq;
        g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(gain, at + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
        o.connect(g); g.connect(this.master); o.start(at); o.stop(at + dur + 0.05);
    },

    ding() {
        if (!this.ctx) return;
        const t = this.ctx.currentTime;
        this.tone(880, t, 0.5, 'sine', 0.3);
        this.tone(1318.5, t + 0.12, 0.7, 'sine', 0.28);
        this.tone(1760, t + 0.24, 0.9, 'sine', 0.18);
    },

    bump() {
        if (!this.ctx) return;
        const c = this.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain();
        o.type = 'sine'; o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.15);
        g.gain.setValueAtTime(0.4, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
        o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.2);
    },

    tick() {
        if (!this.ctx) return;
        this.tone(1200, this.ctx.currentTime, 0.05, 'triangle', 0.08);
    },
};
