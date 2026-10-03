const SHAKE_HZ = 140; // tones below this can register as a tap on the case (98 and 110 Hz did; 147 Hz never)
const SHAKE_TAIL_MS = 250; // the knock arrives about 100 ms after the sound, plus output latency

export class Synth {
  constructor() {
    this.context = null;
    this.enabled = true;
    this.volume = 0.25;
    this.sustained = null;
    this.shakeUntil = 0;
  }
  // A low tone through the deck's speaker shakes the case hard enough for the node to hear a tap
  // (scripts/tone-sweep.py on the two-microphone case: 98 and 110 Hz registered, 147 Hz and up never).
  // Until when such a tone, and its echo in the knock pipeline, may still arrive as a knock.
  noteShake(frequency, until) {
    if (frequency < SHAKE_HZ) this.shakeUntil = Math.max(this.shakeUntil, until + SHAKE_TAIL_MS);
  }
  shaking(now = performance.now()) {
    return (!!this.sustained && this.sustainedHz < SHAKE_HZ) || now < this.shakeUntil;
  }
  async unlock() {
    try {
      if (!this.context)
        this.context = new (window.AudioContext || window.webkitAudioContext)();
      if (this.context.state === "suspended") await this.context.resume();
    } catch {}
  }
  tone(frequency = 440, duration = 0.1, type = "sine") {
    if (!this.enabled || !this.context || this.context.state !== "running")
      return;
    const c = this.context,
      o = c.createOscillator(),
      a = c.createGain();
    o.type = type;
    o.frequency.value = frequency;
    a.gain.setValueAtTime(0, c.currentTime);
    a.gain.linearRampToValueAtTime(this.volume * 0.25, c.currentTime + 0.008);
    a.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + duration);
    o.connect(a).connect(c.destination);
    o.start();
    o.stop(c.currentTime + duration + 0.02);
    this.noteShake(frequency, performance.now() + duration * 1000);
  }
  startTone(frequency = 550) {
    this.stopTone();
    if (!this.enabled || !this.context || this.context.state !== "running")
      return;
    const c = this.context,
      o = c.createOscillator(),
      a = c.createGain();
    o.frequency.value = frequency;
    a.gain.value = this.volume * 0.2;
    o.connect(a).connect(c.destination);
    o.start();
    this.sustained = o;
    this.sustainedHz = frequency;
  }
  stopTone() {
    if (this.sustained) {
      try {
        this.sustained.stop();
      } catch {}
      this.sustained = null;
      this.noteShake(this.sustainedHz, performance.now());
    }
  }
  chime() {
    this.tone(523, 0.18);
    setTimeout(() => this.tone(784, 0.3), 130);
  }
}

// Desktop simulator only. Hardware mode consumes the node's I2S audio.
// Resample with a persistent phase and linear interpolation, preserving chunk boundaries.
export class BrowserMicrophone {
  constructor(bridge) {
    this.bridge = bridge;
    this.stream = null;
    this.context = null;
    this.node = null;
    this.generation = 0;
  }
  async start() {
    if (this.stream) return;
    const generation = ++this.generation;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
      video: false,
    });
    if (generation !== this.generation) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    this.stream = stream;
    this.context = new AudioContext();
    await this.context.resume();
    const source = this.context.createMediaStreamSource(stream),
      processor = this.context.createScriptProcessor(2048, 1, 1),
      mute = this.context.createGain();
    mute.gain.value = 0;
    let carry = new Float32Array(0),
      position = 0;
    const step = this.context.sampleRate / 16000;
    processor.onaudioprocess = (event) => {
      const incoming = event.inputBuffer.getChannelData(0),
        data = new Float32Array(carry.length + incoming.length);
      data.set(carry);
      data.set(incoming, carry.length);
      const output = [];
      while (position + 1 < data.length) {
        const i = Math.floor(position),
          f = position - i,
          s = data[i] * (1 - f) + data[i + 1] * f;
        output.push(Math.round(Math.max(-1, Math.min(1, s)) * 32767));
        position += step;
      }
      const consumed = Math.floor(position);
      carry = data.slice(Math.min(consumed, data.length));
      position -= consumed;
      const bytes = new ArrayBuffer(output.length * 2),
        view = new DataView(bytes);
      output.forEach((sample, i) => view.setInt16(i * 2, sample, true));
      this.bridge.sendAudio(bytes);
    };
    source.connect(processor).connect(mute).connect(this.context.destination);
    this.node = processor;
  }
  stop() {
    this.generation++;
    if (this.node) {
      this.node.onaudioprocess = null;
      this.node.disconnect();
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.context?.close().catch(() => {});
    this.stream = null;
    this.context = null;
    this.node = null;
  }
}
