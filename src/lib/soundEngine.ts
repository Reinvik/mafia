// ─────────────────────────────────────────────────────────────────────────────
// MOTOR DE AUDIO DE BAJA LATENCIA (Web Audio API + Preload Buffer Pool)
// Diseñado para respuesta táctil de 0ms en móvil y escritorio
// ─────────────────────────────────────────────────────────────────────────────

class SoundEngine {
  private ctx: AudioContext | null = null;
  private buffers: Map<string, AudioBuffer> = new Map();
  private htmlAudioFallback: Map<string, HTMLAudioElement> = new Map();
  private muted: boolean = false;
  private initialized: boolean = false;

  constructor() {
    if (typeof window !== 'undefined') {
      this.muted = localStorage.getItem('mafia_sound_muted') === 'true';
      this.preloadAssets();
      // Desbloquear AudioContext en el primer toque/clic del usuario
      const unlock = () => {
        this.initContext();
        window.removeEventListener('pointerdown', unlock);
        window.removeEventListener('keydown', unlock);
      };
      window.addEventListener('pointerdown', unlock, { passive: true });
      window.addEventListener('keydown', unlock, { passive: true });
    }
  }

  private initContext(): AudioContext | null {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    if (!this.initialized && this.ctx) {
      this.initialized = true;
      this.decodeAsset('/click-clack.mp3');
      this.decodeAsset('/gunshot.mp3');
    }
    return this.ctx;
  }

  private preloadAssets() {
    ['/click-clack.mp3', '/gunshot.mp3'].forEach((url) => {
      try {
        const audio = new Audio(url);
        audio.preload = 'auto';
        audio.load();
        this.htmlAudioFallback.set(url, audio);
      } catch {
        // Ignorar en entornos sin soporte de Audio
      }
    });
  }

  private async decodeAsset(url: string) {
    if (this.buffers.has(url)) return;
    try {
      const ctx = this.initContext();
      if (!ctx) return;
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      this.buffers.set(url, audioBuffer);
    } catch {
      // Fallback silencioso a HTMLAudioElement o síntesis WebAudio
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public toggleMute(): boolean {
    this.muted = !this.muted;
    if (typeof window !== 'undefined') {
      localStorage.setItem('mafia_sound_muted', String(this.muted));
    }
    if (!this.muted) {
      this.playClick();
    }
    return this.muted;
  }

  private playBufferOrFallback(url: string, volume = 1.0, fallbackFn?: () => void) {
    if (this.muted) return;
    const ctx = this.initContext();
    const buffer = this.buffers.get(url);

    if (ctx && buffer && ctx.state === 'running') {
      try {
        const source = ctx.createBufferSource();
        const gainNode = ctx.createGain();
        source.buffer = buffer;
        gainNode.gain.value = volume;
        source.connect(gainNode);
        gainNode.connect(ctx.destination);
        source.start(0);
        return;
      } catch {
        // Continuar al fallback
      }
    }

    // Fallback instantáneo clonando el elemento precargado
    const baseAudio = this.htmlAudioFallback.get(url);
    if (baseAudio) {
      try {
        const clone = baseAudio.cloneNode() as HTMLAudioElement;
        clone.volume = volume;
        clone.play().catch(() => {
          fallbackFn?.();
        });
        // Asegurar decodificación para la próxima vez
        this.decodeAsset(url);
        return;
      } catch {
        fallbackFn?.();
      }
    } else {
      fallbackFn?.();
    }
  }

  // 1. Clic de interfaz táctil (0ms latencia, sintetizado)
  public playClick() {
    if (this.muted) return;
    const ctx = this.initContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(900, now);
      osc.frequency.exponentialRampToValueAtTime(220, now + 0.035);

      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.04);
    } catch {
      // Ignorar
    }
  }

  // 2. Sonido de Ficha / Armar jugada (click-clack instantáneo)
  public playLockIn(volume = 0.85) {
    if (this.muted) return;
    // Toque táctil inmediato + buffer de click-clack
    this.playClick();
    this.playBufferOrFallback('/click-clack.mp3', volume);
  }

  // 3. Disparo de Traición (gunshot instantáneo)
  public playGunshot() {
    if (this.muted) return;
    this.playBufferOrFallback('/gunshot.mp3', 1.0, () => {
      // Síntesis de respaldo por si falla la carga del archivo
      const ctx = this.initContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(160, now);
      osc.frequency.exponentialRampToValueAtTime(30, now + 0.25);
      gain.gain.setValueAtTime(0.5, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.26);
    });
  }

  // 4. Éxito de Cooperación (Acorde armónico de casino, 0ms red)
  public playCooperateSuccess() {
    if (this.muted) return;
    const ctx = this.initContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        const start = now + idx * 0.055;
        osc.frequency.setValueAtTime(freq, start);

        gain.gain.setValueAtTime(0.001, start);
        gain.gain.linearRampToValueAtTime(0.15, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.45);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.46);
      });
    } catch {
      // Ignorar
    }
  }

  // 5. Sonido de Dinero / Fichas de Casino (0ms red)
  public playCash() {
    if (this.muted) return;
    const ctx = this.initContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const freqs = [1318.5, 1567.98, 2093.0]; // E6, G6, C7 (tintineo de fichas/monedas)
      freqs.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        const start = now + i * 0.06;
        osc.frequency.setValueAtTime(freq, start);

        gain.gain.setValueAtTime(0.14, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.22);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.24);
      });
    } catch {
      // Ignorar
    }
  }

  // 6. Tick de reloj para los últimos segundos de tensión
  public playTick(urgent = false) {
    if (this.muted) return;
    const ctx = this.initContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(urgent ? 880 : 620, now);
      osc.frequency.exponentialRampToValueAtTime(urgent ? 440 : 310, now + 0.04);

      gain.gain.setValueAtTime(urgent ? 0.12 : 0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.05);
    } catch {
      // Ignorar
    }
  }
}

export const soundEngine = new SoundEngine();
