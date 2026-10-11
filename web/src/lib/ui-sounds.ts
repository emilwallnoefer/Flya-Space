"use client";

const UI_SOUNDS_STORAGE_KEY = "ma_ui_sounds_enabled";

// Sounds are opt-in: nothing plays until the user switches them on in
// Settings → Interface sounds (the choice is stored on the device).
const UI_SOUNDS_DEFAULT = false;

function readStoredUiSoundsEnabled(): boolean {
  if (typeof window === "undefined") return UI_SOUNDS_DEFAULT;
  try {
    const v = window.localStorage.getItem(UI_SOUNDS_STORAGE_KEY);
    if (v === null) return UI_SOUNDS_DEFAULT;
    return v === "1" || v === "true";
  } catch {
    return UI_SOUNDS_DEFAULT;
  }
}

let soundsEnabledCache: boolean | null = null;

/** Whether UI sounds are allowed (default off). Synced with localStorage. */
export function getUiSoundsEnabled(): boolean {
  if (soundsEnabledCache === null && typeof window !== "undefined") {
    soundsEnabledCache = readStoredUiSoundsEnabled();
  }
  if (soundsEnabledCache === null) return UI_SOUNDS_DEFAULT;
  return soundsEnabledCache;
}

/** Persist preference and stop active sounds when turning off. */
export function setUiSoundsEnabled(enabled: boolean): void {
  soundsEnabledCache = enabled;
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(UI_SOUNDS_STORAGE_KEY, enabled ? "1" : "0");
    }
  } catch {
    // Ignore quota / private mode.
  }
  if (!enabled && typeof window !== "undefined") {
    for (const key of Object.keys(SOUND_CONFIG) as UiSoundKey[]) {
      stopUiSound(key, { fadeOutMs: 100 });
    }
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("ma-ui-sounds-changed", { detail: { enabled } }));
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e: StorageEvent) => {
    if (e.key !== UI_SOUNDS_STORAGE_KEY) return;
    soundsEnabledCache = readStoredUiSoundsEnabled();
    window.dispatchEvent(
      new CustomEvent("ma-ui-sounds-changed", { detail: { enabled: soundsEnabledCache } }),
    );
  });
}

export type UiSoundKey =
  | "switchWhoosh"
  | "generateReady"
  | "mailSend"
  | "fillSwoosh"
  | "saveConfirm"
  | "resetTap"
  | "weekReadyGlow"
  | "daysAppearStart"
  | "dayLoggerSlide"
  | "previewWrite";

type SoundConfig = {
  src: string;
  volume: number;
  cooldownMs?: number;
  loop?: boolean;
};

const SOUND_VERSION = "v8-20260317n";

const SOUND_CONFIG: Record<UiSoundKey, SoundConfig> = {
  switchWhoosh: { src: `/sounds/switch-clean-air-v8.wav?v=${SOUND_VERSION}`, volume: 0.52, cooldownMs: 120 },
  generateReady: { src: `/sounds/generate-wind-v7.wav?v=${SOUND_VERSION}`, volume: 0.5, cooldownMs: 120 },
  mailSend: { src: `/sounds/mail-send-wind-v7.wav?v=${SOUND_VERSION}`, volume: 0.52, cooldownMs: 140 },
  fillSwoosh: { src: `/sounds/fill-wind-v7.wav?v=${SOUND_VERSION}`, volume: 0.5, cooldownMs: 140 },
  saveConfirm: { src: `/sounds/save-day-paper-v1.wav?v=${SOUND_VERSION}`, volume: 0.52, cooldownMs: 120 },
  resetTap: { src: `/sounds/reset-thud-v5.wav?v=${SOUND_VERSION}`, volume: 0.56, cooldownMs: 100 },
  weekReadyGlow: { src: `/sounds/week-glow-whoosh-v1.wav?v=${SOUND_VERSION}`, volume: 0.34, loop: true },
  daysAppearStart: { src: `/sounds/days-appear-rise-v1.wav?v=${SOUND_VERSION}`, volume: 0.26, cooldownMs: 120 },
  dayLoggerSlide: { src: `/sounds/day-logger-slide-v1.wav?v=${SOUND_VERSION}`, volume: 0.23, cooldownMs: 80 },
  previewWrite: { src: `/sounds/live-preview-write-full-v1.wav?v=${SOUND_VERSION}`, volume: 0.2, loop: false },
};

const cache = new Map<UiSoundKey, HTMLAudioElement>();
const lastPlayedAt = new Map<UiSoundKey, number>();
const fadeIntervals = new Map<UiSoundKey, number>();
const layeredAudios = new Map<UiSoundKey, HTMLAudioElement[]>();
const layeredTimeouts = new Map<UiSoundKey, number[]>();
const layeredIntervals = new Map<UiSoundKey, number[]>();
const SOUND_DURATION_FALLBACK_MS: Partial<Record<UiSoundKey, number>> = {
  previewWrite: 3474,
};

function canPlay() {
  return typeof window !== "undefined" && typeof Audio !== "undefined";
}

function getAudio(sound: UiSoundKey) {
  const existing = cache.get(sound);
  const config = SOUND_CONFIG[sound];
  if (existing) {
    if (existing.src.includes(config.src)) return existing;
    existing.src = config.src;
    existing.load();
    existing.volume = config.volume;
    existing.loop = Boolean(config.loop);
    return existing;
  }
  const audio = new Audio(config.src);
  audio.preload = "auto";
  audio.volume = config.volume;
  audio.loop = Boolean(config.loop);
  cache.set(sound, audio);
  return audio;
}

function clearFadeInterval(sound: UiSoundKey) {
  const intervalId = fadeIntervals.get(sound);
  if (intervalId != null) {
    window.clearInterval(intervalId);
    fadeIntervals.delete(sound);
  }
}

function pushLayeredTimeout(sound: UiSoundKey, timeoutId: number) {
  const list = layeredTimeouts.get(sound) ?? [];
  list.push(timeoutId);
  layeredTimeouts.set(sound, list);
}

function pushLayeredInterval(sound: UiSoundKey, intervalId: number) {
  const list = layeredIntervals.get(sound) ?? [];
  list.push(intervalId);
  layeredIntervals.set(sound, list);
}

function clearLayeredTimers(sound: UiSoundKey) {
  const timeouts = layeredTimeouts.get(sound) ?? [];
  for (const timeoutId of timeouts) window.clearTimeout(timeoutId);
  layeredTimeouts.delete(sound);

  const intervals = layeredIntervals.get(sound) ?? [];
  for (const intervalId of intervals) window.clearInterval(intervalId);
  layeredIntervals.delete(sound);
}

function clearLayeredAudios(sound: UiSoundKey) {
  const config = SOUND_CONFIG[sound];
  const audios = layeredAudios.get(sound) ?? [];
  for (const audio of audios) {
    try {
      audio.pause();
      audio.currentTime = 0;
      audio.volume = config.volume;
    } catch {
      // Ignore cleanup failures.
    }
  }
  layeredAudios.delete(sound);
}

function getKnownDurationMs(sound: UiSoundKey) {
  const audio = getAudio(sound);
  if (Number.isFinite(audio.duration) && audio.duration > 0) {
    return audio.duration * 1000;
  }
  return SOUND_DURATION_FALLBACK_MS[sound] ?? 1200;
}

function fadeAudioVolume(
  sound: UiSoundKey,
  audio: HTMLAudioElement,
  from: number,
  to: number,
  durationMs: number,
  onDone?: () => void,
) {
  if (durationMs <= 0) {
    audio.volume = to;
    onDone?.();
    return;
  }
  audio.volume = from;
  const startedAt = performance.now();
  const intervalId = window.setInterval(() => {
    const progress = Math.min(1, (performance.now() - startedAt) / durationMs);
    audio.volume = from + (to - from) * progress;
    if (progress >= 1) {
      window.clearInterval(intervalId);
      const intervals = layeredIntervals.get(sound) ?? [];
      layeredIntervals.set(
        sound,
        intervals.filter((id) => id !== intervalId),
      );
      onDone?.();
    }
  }, 20);
  pushLayeredInterval(sound, intervalId);
}

export function playUiSound(sound: UiSoundKey) {
  if (!canPlay() || !getUiSoundsEnabled()) return;
  const now = Date.now();
  const cooldown = SOUND_CONFIG[sound].cooldownMs ?? 0;
  const prev = lastPlayedAt.get(sound) ?? 0;
  if (now - prev < cooldown) return;
  lastPlayedAt.set(sound, now);

  try {
    const audio = getAudio(sound);
    audio.currentTime = 0;
    void audio.play().catch(() => {
      // Ignore autoplay/user-gesture restriction noise.
    });
  } catch {
    // Keep UI functional even if audio fails.
  }
}

export function startUiSound(sound: UiSoundKey, options?: { fadeInMs?: number; restart?: boolean }) {
  if (!canPlay() || !getUiSoundsEnabled()) return;
  try {
    clearLayeredTimers(sound);
    clearLayeredAudios(sound);
    const audio = getAudio(sound);
    const targetVolume = SOUND_CONFIG[sound].volume;
    const shouldRestart = options?.restart ?? true;
    const fadeInMs = Math.max(0, options?.fadeInMs ?? 0);
    clearFadeInterval(sound);
    if (shouldRestart) audio.currentTime = 0;
    if (fadeInMs <= 0) {
      audio.volume = targetVolume;
      void audio.play().catch(() => {
        // Ignore autoplay/user-gesture restriction noise.
      });
      return;
    }
    audio.volume = 0;
    void audio.play().catch(() => {
      // Ignore autoplay/user-gesture restriction noise.
    });
    const startedAt = performance.now();
    const intervalId = window.setInterval(() => {
      const progress = Math.min(1, (performance.now() - startedAt) / fadeInMs);
      audio.volume = targetVolume * progress;
      if (progress >= 1) {
        clearFadeInterval(sound);
      }
    }, 20);
    fadeIntervals.set(sound, intervalId);
  } catch {
    // Keep UI functional even if audio fails.
  }
}

export function stopUiSound(sound: UiSoundKey, options?: { fadeOutMs?: number }) {
  if (!canPlay()) return;
  clearLayeredTimers(sound);
  const layered = layeredAudios.get(sound) ?? [];
  const fadeOutMs = Math.max(0, options?.fadeOutMs ?? 0);
  if (layered.length > 0) {
    if (fadeOutMs <= 0) {
      clearLayeredAudios(sound);
    } else {
      for (const audio of layered) {
        fadeAudioVolume(sound, audio, audio.volume, 0, fadeOutMs, () => {
          try {
            audio.pause();
            audio.currentTime = 0;
            audio.volume = SOUND_CONFIG[sound].volume;
          } catch {
            // Ignore cleanup failures.
          }
        });
      }
      const cleanupTimeoutId = window.setTimeout(() => {
        clearLayeredAudios(sound);
      }, fadeOutMs + 40);
      pushLayeredTimeout(sound, cleanupTimeoutId);
    }
  }

  const audio = cache.get(sound);
  if (!audio) return;
  try {
    clearFadeInterval(sound);
    if (fadeOutMs <= 0) {
      audio.pause();
      audio.currentTime = 0;
      return;
    }
    const startVolume = audio.volume;
    const startedAt = performance.now();
    const intervalId = window.setInterval(() => {
      const progress = Math.min(1, (performance.now() - startedAt) / fadeOutMs);
      audio.volume = startVolume * (1 - progress);
      if (progress >= 1) {
        clearFadeInterval(sound);
        audio.pause();
        audio.currentTime = 0;
        audio.volume = SOUND_CONFIG[sound].volume;
      }
    }, 20);
    fadeIntervals.set(sound, intervalId);
  } catch {
    // Ignore stop failures to keep UI responsive.
  }
}

export function playUiSoundWithCrossfadeFill(
  sound: UiSoundKey,
  durationMs: number,
  options?: { fadeInMs?: number; fadeOutMs?: number; crossfadeMs?: number },
) {
  if (!canPlay() || !getUiSoundsEnabled()) return;
  const totalMs = Math.max(0, Math.round(durationMs));
  if (totalMs <= 0) return;

  const config = SOUND_CONFIG[sound];
  const fadeInMs = Math.max(0, options?.fadeInMs ?? 120);
  const fadeOutMs = Math.max(0, options?.fadeOutMs ?? 200);
  const requestedCrossfadeMs = Math.max(60, options?.crossfadeMs ?? 1000);
  const clipMs = Math.max(240, getKnownDurationMs(sound));
  const crossfadeMs = Math.min(requestedCrossfadeMs, Math.max(60, clipMs - 140));

  clearFadeInterval(sound);
  clearLayeredTimers(sound);
  clearLayeredAudios(sound);
  const baseAudio = cache.get(sound);
  if (baseAudio) {
    try {
      baseAudio.pause();
      baseAudio.currentTime = 0;
    } catch {
      // Ignore stop failures.
    }
  }

  const activeAudios: HTMLAudioElement[] = [];
  layeredAudios.set(sound, activeAudios);

  const endAlignedStartMs = Math.max(0, totalMs - clipMs);
  const strideMs = Math.max(120, clipMs - crossfadeMs);
  const startTimes: number[] = [0];
  let cursor = 0;
  while (cursor + strideMs < endAlignedStartMs) {
    cursor += strideMs;
    startTimes.push(cursor);
  }
  if (endAlignedStartMs > 0 && startTimes[startTimes.length - 1] !== endAlignedStartMs) {
    startTimes.push(endAlignedStartMs);
  }

  const launchSegment = (segmentStartMs: number, index: number) => {
    const nextStartMs = startTimes[index + 1];
    const audio = new Audio(config.src);
    audio.preload = "auto";
    audio.loop = false;
    audio.volume = 0;
    activeAudios.push(audio);
    void audio.play().catch(() => {
      // Ignore autoplay/user-gesture restriction noise.
    });

    const localFadeInMs = index === 0 ? fadeInMs : Math.min(crossfadeMs, 180);
    fadeAudioVolume(sound, audio, 0, config.volume, localFadeInMs);

    if (nextStartMs != null) {
      const deltaToNext = Math.max(0, nextStartMs - segmentStartMs);
      const localCrossfade = Math.min(crossfadeMs, Math.max(0, clipMs - deltaToNext));
      if (localCrossfade > 0) {
        const fadeTimeoutId = window.setTimeout(() => {
          fadeAudioVolume(sound, audio, audio.volume, 0, localCrossfade, () => {
            try {
              audio.pause();
              audio.currentTime = 0;
              audio.volume = config.volume;
            } catch {
              // Ignore cleanup failures.
            }
          });
        }, deltaToNext);
        pushLayeredTimeout(sound, fadeTimeoutId);
      }
    } else {
      const fadeStartAbsoluteMs = Math.max(segmentStartMs, totalMs - fadeOutMs);
      const fadeDelayMs = Math.max(0, fadeStartAbsoluteMs - segmentStartMs);
      const fadeTimeoutId = window.setTimeout(() => {
        fadeAudioVolume(sound, audio, audio.volume, 0, fadeOutMs, () => {
          try {
            audio.pause();
            audio.currentTime = 0;
            audio.volume = config.volume;
          } catch {
            // Ignore cleanup failures.
          }
        });
      }, fadeDelayMs);
      pushLayeredTimeout(sound, fadeTimeoutId);
    }
  };

  // Start first segment immediately to avoid autoplay race.
  launchSegment(startTimes[0], 0);

  for (let index = 1; index < startTimes.length; index += 1) {
    const segmentStartMs = startTimes[index];
    const startTimeoutId = window.setTimeout(() => {
      launchSegment(segmentStartMs, index);
    }, segmentStartMs);
    pushLayeredTimeout(sound, startTimeoutId);
  }

  const cleanupTimeoutId = window.setTimeout(() => {
    clearLayeredTimers(sound);
    clearLayeredAudios(sound);
  }, totalMs + fadeOutMs + 80);
  pushLayeredTimeout(sound, cleanupTimeoutId);
}
