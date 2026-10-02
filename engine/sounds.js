export function createSounds() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const ctx = AudioContextClass ? new AudioContextClass() : null;
  const masterGain = ctx ? ctx.createGain() : null;
  const ENEMY_HIT_SOUND = "./assets/impact.ogg";
  const JUMP_SOUND = "./assets/jump.ogg";
  const DEATH_SOUND = "./assets/death.ogg";
  const HIT_SOUND = "./assets/damage.ogg";
  const HEADSHOT_SOUND = "./assets/headshot.ogg";
  const DOUBLE_KILL_SOUND = "./assets/doublekill.ogg";
  const TRIPLE_KILL_SOUND = "./assets/triplekill.ogg";
  const MULTIKILL_SOUND = "./assets/multikill.ogg";

  if (masterGain) {
    masterGain.gain.value = 1.0;
    masterGain.connect(ctx.destination);
  }

  function resume() {
    if (ctx && ctx.state === "suspended") ctx.resume();
  }

  function now() {
    return ctx ? ctx.currentTime : 0;
  }

  function playShoot(asset) {
    if (!ctx) return;
    resume();
    if (asset && asset.fireSound) playFromAsset(asset.fireSound, 1.0);
  }

  let explosionNoise = null;

  // Shared procedural blast sound: no additional audio asset is required.
  function playExplosion(distance = 0) {
    if (!ctx) return;
    resume();
    const t = now();
    const volume = 0.75 / (1 + Math.max(0, distance) / 18);
    if (!explosionNoise) explosionNoise = createNoiseBuffer(0.65);

    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    source.buffer = explosionNoise;
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(2200, t);
    filter.frequency.exponentialRampToValueAtTime(100, t + 0.6);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.001, volume), t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.65);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
    source.start(t);
    source.stop(t + 0.65);

    const low = ctx.createOscillator();
    const lowGain = ctx.createGain();
    low.type = "sine";
    low.frequency.setValueAtTime(100, t);
    low.frequency.exponentialRampToValueAtTime(30, t + 0.45);
    lowGain.gain.setValueAtTime(Math.max(0.001, volume * 0.85), t);
    lowGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    low.connect(lowGain);
    lowGain.connect(masterGain);
    low.onended = () => { low.disconnect(); lowGain.disconnect(); };
    low.start(t);
    low.stop(t + 0.5);
  }

  function playReload() {
    if (!ctx) return;
    resume();

    const t = now();
    playClick(t, 1.0, 900, 0.08);
    playClick(t + 0.28, 1.0, 650, 0.08);
    playClick(t + 0.58, 1.0, 1200, 0.1);
  }

  // Brief ascending confirmation, generated locally with no new audio asset.
  function playUpgrade(level = 1) {
    if (!ctx) return;
    resume();
    const start = now();
    const notes = level >= 3 ? [523.25, 659.25, 783.99, 1046.5] : [523.25, 659.25, 783.99];
    notes.forEach((frequency, index) => {
      const t = start + index * 0.065;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.12, t + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      oscillator.connect(gain);
      gain.connect(masterGain);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      oscillator.start(t);
      oscillator.stop(t + 0.19);
    });
  }

  function playEmpty() {
    if (!ctx) return;
    resume();
    playClick(now(), 1.0, 1400, 0.05);
  }

  function playEnemyHit() {
    if (!ctx) return;
    resume();
    playFromAsset(ENEMY_HIT_SOUND, 1.0);
  }

  function playEnemyDie() {}

  function playHeadshot() {
    if (!ctx) return;
    resume();
    playFromAsset(HEADSHOT_SOUND, 1.0);
  }

  function playDoubleKill() {
    if (!ctx) return;
    resume();
    playFromAsset(DOUBLE_KILL_SOUND, 1.0);
  }

  function playTripleKill() {
    if (!ctx) return;
    resume();
    playFromAsset(TRIPLE_KILL_SOUND, 1.0);
  }

  function playMultiKill() {
    if (!ctx) return;
    resume();
    playFromAsset(MULTIKILL_SOUND, 1.0);
  }

  // UPDATED: use base64 hit sound instead of oscillator
  function playPlayerHit() {
    if (!ctx) return;
    resume();
    playFromAsset(HIT_SOUND, 1.0);
  }

  function playFootstep(walking = false, speed01 = 1) {
    if (!ctx) return;
    resume();

    const t = now();

    const low = ctx.createOscillator();
    const lowGain = ctx.createGain();
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    source.buffer = createNoiseBuffer(0.095);

    filter.type = "bandpass";
    filter.frequency.setValueAtTime(walking ? 150 : 230, t);
    filter.Q.setValueAtTime(0.9, t);

    const volume = 1.0;

    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(volume * Math.max(0.65, speed01), t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.11);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);

    source.start(t);
    source.stop(t + 0.12);

    low.type = "sine";
    low.frequency.setValueAtTime(walking ? 85 : 105, t);
    low.frequency.exponentialRampToValueAtTime(walking ? 55 : 70, t + 0.06);

    lowGain.gain.setValueAtTime(0.6, t);
    lowGain.gain.exponentialRampToValueAtTime(0.001, t + 0.075);

    low.connect(lowGain);
    lowGain.connect(masterGain);

    low.start(t);
    low.stop(t + 0.085);
  }

  function playJump() {
    if (!ctx) return;
    resume();
    playFromAsset(JUMP_SOUND, 1.0);
  }

  function playPlayerDie() {
    if (!ctx) return;
    resume();
    playFromAsset(DEATH_SOUND, 1.0);
  }

  function playClick(startTime, volume, frequency, duration) {
    if (!ctx) return;

    const noise = createNoiseBuffer(duration);
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    source.buffer = noise;

    filter.type = "highpass";
    filter.frequency.setValueAtTime(frequency, startTime);

    gain.gain.setValueAtTime(volume, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);

    source.start(startTime);
    source.stop(startTime + duration);
  }

  function playFromAsset(src, volume = 1.0) {
    if (!src || src.includes("YOUR_")) return;

    const audio = new Audio(src);
    audio.volume = volume;
    audio.currentTime = 0;
    audio.play().catch(() => {});
  }

  function createNoiseBuffer(duration) {
    const sampleRate = ctx.sampleRate;
    const length = Math.max(1, Math.floor(sampleRate * duration));
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    return buffer;
  }

  return {
    resume,
    playShoot,
    playExplosion,
    playReload,
    playUpgrade,
    playEmpty,
    playEnemyHit,
    playEnemyDie,
    playHeadshot,
    playDoubleKill,
    playTripleKill,
    playMultiKill,
    playPlayerHit,
    playFootstep,
    playJump,
    playPlayerDie
  };
}