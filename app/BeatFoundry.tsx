"use client";

import { ChangeEvent, DragEvent, useCallback, useEffect, useRef, useState } from "react";

type Hit = { time: number; strength: number; waveform: number[] };
type SoundDNA = {
  waveform: number[];
  hits: Hit[];
  pitchHz: number;
  pitchConfidence: number;
  note: string;
  brightness: string;
  decay: number;
  bpm: number;
};
type InstrumentId = "foundation" | "kick" | "clap" | "hat" | "bass" | "synth";
type Groove = "straight" | "pocket" | "sparse";
type SynthShape = "pluck" | "pad" | "arp";
type MusicalMode = "minor" | "major" | "suspended" | "percussive";
type ArrangementShape = "steady" | "build" | "rise_fall";
type LayerSource = "seed" | "support";
type LayerLevels = Record<InstrumentId, number>;
type SeedVoiceCharacter = "hook" | "melody" | "low_pulse" | "high_spark" | "texture" | "echo";
type NoteEvent = { bars: number[]; step: number; pitches: number[]; duration: number; velocity: number };
type SongSection = { name: string; start_bar: number; end_bar: number; energy: number };
type SeedVoice = {
  id: string;
  name: string;
  character: SeedVoiceCharacter;
  start_bar: number;
  end_bar: number;
  pattern: number[];
  pitch_pattern: number[];
  events: NoteEvent[];
  speed: number;
  level: number;
  reason: string;
};
type ArrangementPlan = {
  bars: number;
  seed_repetitions: number;
  literal_seed_bars: number[];
  bpm: number;
  groove: Groove;
  synth_shape: SynthShape;
  musical_mode: MusicalMode;
  arrangement_shape: ArrangementShape;
  progression: number[];
  sections: SongSection[];
  seed_presence: number;
  layer_levels: LayerLevels;
  style_name: string;
  sound_design: SoundDesign;
  instruments: Array<Exclude<InstrumentId, "foundation">>;
  patterns: Record<InstrumentId, number[]>;
  instrument_events: Record<InstrumentId, NoteEvent[]>;
  seed_voices: SeedVoice[];
  explanation: string;
};
type StudioMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  changes?: string[];
  version?: number;
};
type SpeechResultEvent = {
  results: { length: number; [index: number]: { 0: { transcript: string }; isFinal: boolean } };
};
type PromptRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};
type SoundDesign = { kick_depth: number; brightness: number; swing: number; space: number };
type AudioReview = { score: number; peak: number; rms: number; lowEnergy: number; highEnergy: number; repetition: number; dynamicRange: number; issues: string[] };
type Layer = {
  id: string;
  kind: InstrumentId | "seed_voice";
  name: string;
  role: string;
  derivation: string;
  color: string;
  pattern: number[];
  events?: NoteEvent[];
  activeBars?: number[];
  source: LayerSource;
  voice?: SeedVoice;
  muted: boolean;
  removed: boolean;
};

const NOTES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const COLORS: Record<InstrumentId, string> = {
  foundation: "#ffb44a",
  kick: "#ff766f",
  clap: "#a99bf7",
  hat: "#5ed3c5",
  bass: "#9adf64",
  synth: "#f2d56b",
};
const VOICE_COLORS = ["#ffca70", "#f58da8", "#73d8cd", "#bd9cf2", "#8fcce8", "#d9e57a"];
const DEFAULT_LEVELS: LayerLevels = { foundation: 0.82, kick: 0.72, clap: 0.42, hat: 0.3, bass: 0.58, synth: 0.38 };

const INSTRUMENTS: Array<{ id: Exclude<InstrumentId, "foundation">; number: string; name: string; role: string; source: LayerSource; derivation: string }> = [
  { id: "kick", number: "01", name: "Seed kick", role: "Low-end pulse", source: "seed", derivation: "Seed body resynthesized low · transient shortened into a kick" },
  { id: "clap", number: "02", name: "Clap", role: "Backbeat accent", source: "seed", derivation: "Seed doubled · mid-band attack stacked twice" },
  { id: "hat", number: "03", name: "Hi-hat", role: "Top-line motion", source: "seed", derivation: "Seed sped up 2.7× · high frequencies isolated" },
  { id: "bass", number: "04", name: "Seed bass", role: "Harmonic foundation", source: "seed", derivation: "Seed tonal body looped and filtered into a stable bass voice" },
  { id: "synth", number: "05", name: "Seed instrument", role: "Melody or atmosphere", source: "seed", derivation: "Seed body becomes a pluck, arp or slow pad timbre" },
];

const sourceFor = (): LayerSource => "seed";
const derivationFor = (id: InstrumentId, shape: SynthShape) => {
  if (id === "foundation") return "Cleanest impact · silence removed · original timbre";
  if (id === "synth" && shape === "pad") return "Seed tonal body sustained and softened into a slow pad";
  const instrument = INSTRUMENTS.find((item) => item.id === id);
  return instrument?.derivation ?? "Supports the selected seed";
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
const rateFromSemitones = (semitones: number) => Math.pow(2, semitones / 12);
const messageId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const MODE_SCALES: Record<MusicalMode, number[]> = {
  minor: [0, 3, 5, 7, 10],
  major: [0, 2, 4, 7, 9],
  suspended: [0, 2, 5, 7, 10],
  percussive: [0, 7],
};

function quantizePitch(value: number, mode: MusicalMode, min = -12, max = 12) {
  const target = clamp(Math.round(value), min, max);
  const candidates: number[] = [];
  for (let octave = -3; octave <= 3; octave += 1) {
    MODE_SCALES[mode].forEach((step) => {
      const candidate = octave * 12 + step;
      if (candidate >= min && candidate <= max) candidates.push(candidate);
    });
  }
  return candidates.reduce((best, candidate) => Math.abs(candidate - target) < Math.abs(best - target) ? candidate : best, candidates[0] ?? 0);
}

function createMixBus(ctx: BaseAudioContext, output: AudioNode, space: number) {
  const input = ctx.createGain(); const highpass = ctx.createBiquadFilter(); const dry = ctx.createGain(); const compressor = ctx.createDynamicsCompressor();
  highpass.type = "highpass"; highpass.frequency.value = 28; highpass.Q.value = 0.6;
  input.gain.value = 0.64; dry.gain.value = 0.96;
  compressor.threshold.value = -17; compressor.knee.value = 18; compressor.ratio.value = 3; compressor.attack.value = 0.012; compressor.release.value = 0.26;
  input.connect(highpass); highpass.connect(dry); dry.connect(compressor); compressor.connect(output);
  if (space > 0.18) {
    const convolver = ctx.createConvolver(); const wetFilter = ctx.createBiquadFilter(); const wet = ctx.createGain();
    const length = Math.floor(ctx.sampleRate * (0.42 + space * 0.72)); const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let channel = 0; channel < 2; channel += 1) {
      const data = impulse.getChannelData(channel); let state = 1949 + channel * 7919;
      for (let index = 0; index < length; index += 1) { state = (state * 16807) % 2147483647; const noise = (state / 1073741823.5) - 1; data[index] = noise * Math.pow(1 - index / length, 2.7); }
    }
    convolver.buffer = impulse; wetFilter.type = "lowpass"; wetFilter.frequency.value = 3800; wet.gain.value = 0.035 + space * 0.055;
    highpass.connect(convolver); convolver.connect(wetFilter); wetFilter.connect(wet); wet.connect(compressor);
  }
  return input;
}

function planChanges(previous: ArrangementPlan | null, next: ArrangementPlan) {
  const changes: string[] = [];
  if (!previous) {
    changes.push(`${next.bars} bars`, `${next.bpm} BPM`);
    if (next.literal_seed_bars.length) changes.push(`${next.seed_repetitions} literal hits in ${next.literal_seed_bars.length} bar${next.literal_seed_bars.length === 1 ? "" : "s"}`);
    else changes.push("No repeated literal hit");
    if (next.seed_voices?.length) changes.push(`${next.seed_voices.length} pitched seed voice${next.seed_voices.length === 1 ? "" : "s"}`);
    if (next.instruments.length) changes.push(`Added ${next.instruments.join(", ")}`);
    return changes.slice(0, 6);
  }
  if (previous.bars !== next.bars) changes.push(`Bars ${previous.bars} → ${next.bars}`);
  if (previous.seed_repetitions !== next.seed_repetitions) changes.push(`Seed hits ${previous.seed_repetitions} → ${next.seed_repetitions}`);
  if (JSON.stringify(previous.literal_seed_bars ?? []) !== JSON.stringify(next.literal_seed_bars ?? [])) changes.push(`Literal seed bars → ${next.literal_seed_bars.length ? next.literal_seed_bars.join(", ") : "none"}`);
  if (previous.bpm !== next.bpm) changes.push(`Tempo ${previous.bpm} → ${next.bpm} BPM`);
  if (previous.groove !== next.groove) changes.push(`Groove ${previous.groove} → ${next.groove}`);
  if (previous.synth_shape !== next.synth_shape) changes.push(`Synth ${previous.synth_shape} → ${next.synth_shape}`);
  if (previous.musical_mode !== next.musical_mode) changes.push(`Harmony ${previous.musical_mode} → ${next.musical_mode}`);
  if (previous.arrangement_shape !== next.arrangement_shape) changes.push(`Shape ${previous.arrangement_shape} → ${next.arrangement_shape}`);
  const previousVoices = previous.seed_voices ?? [];
  const nextVoices = next.seed_voices ?? [];
  const addedVoices = nextVoices.filter((voice) => !previousVoices.some((item) => item.id === voice.id));
  const removedVoices = previousVoices.filter((voice) => !nextVoices.some((item) => item.id === voice.id));
  const repitchedVoices = nextVoices.filter((voice) => {
    const before = previousVoices.find((item) => item.id === voice.id);
    return before && JSON.stringify(before.pitch_pattern) !== JSON.stringify(voice.pitch_pattern);
  });
  if (addedVoices.length) changes.push(`AI added ${addedVoices.map((voice) => voice.name).join(", ")}`);
  if (repitchedVoices.length) changes.push(`Repitched ${repitchedVoices.map((voice) => voice.name).join(", ")}`);
  if (removedVoices.length) changes.push(`Simplified ${removedVoices.map((voice) => voice.name).join(", ")}`);
  const beforePresence = Math.round((previous.seed_presence ?? 0.8) * 100); const afterPresence = Math.round((next.seed_presence ?? 0.8) * 100);
  if (beforePresence !== afterPresence) changes.push(`Original hit ${beforePresence} → ${afterPresence}`);
  (["kick_depth", "brightness", "swing", "space"] as const).forEach((key) => {
    const before = Math.round(previous.sound_design[key] * 100);
    const after = Math.round(next.sound_design[key] * 100);
    if (before !== after) changes.push(`${key.replace("_", " ")} ${before} → ${after}`);
  });
  const added = next.instruments.filter((id) => !previous.instruments.includes(id));
  const removed = previous.instruments.filter((id) => !next.instruments.includes(id));
  if (added.length) changes.push(`Added ${added.join(", ")}`);
  if (removed.length) changes.push(`Removed ${removed.join(", ")}`);
  if (previous.style_name !== next.style_name && changes.length < 6) changes.push(`Feel → ${next.style_name}`);
  return changes.slice(0, 8);
}

function waveformOf(data: Float32Array, bars = 96) {
  const values: number[] = [];
  const size = Math.max(1, Math.floor(data.length / bars));
  for (let bar = 0; bar < bars; bar += 1) {
    let peak = 0;
    for (let index = bar * size; index < Math.min(data.length, (bar + 1) * size); index += 1) peak = Math.max(peak, Math.abs(data[index]));
    values.push(peak);
  }
  const max = Math.max(...values, 0.001);
  return values.map((value) => clamp(value / max, 0.06, 1));
}

function detectPitch(data: Float32Array, sampleRate: number) {
  let peakIndex = 0;
  let peak = 0;
  for (let index = 0; index < data.length; index += 1) {
    if (Math.abs(data[index]) > peak) { peak = Math.abs(data[index]); peakIndex = index; }
  }
  const stride = Math.max(1, Math.floor(sampleRate / 11025));
  const analysisStart = Math.min(data.length - 1, peakIndex + Math.floor(sampleRate * 0.003));
  const length = Math.min(4200, Math.floor((data.length - analysisStart) / stride));
  const sample = new Float32Array(Math.max(128, length));
  let mean = 0;
  for (let index = 0; index < sample.length; index += 1) { sample[index] = data[analysisStart + index * stride] || 0; mean += sample[index]; }
  mean /= sample.length;
  for (let index = 0; index < sample.length; index += 1) sample[index] -= mean;
  const rate = sampleRate / stride;
  const minLag = Math.max(2, Math.floor(rate / 1200));
  const maxLag = Math.min(Math.floor(rate / 55), sample.length - 2);
  const scores = new Float32Array(maxLag + 1);
  let bestLag = 0; let best = 0;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let correlation = 0;
    let energyA = 0;
    let energyB = 0;
    for (let index = 0; index < sample.length - lag; index += 1) {
      correlation += sample[index] * sample[index + lag];
      energyA += sample[index] ** 2;
      energyB += sample[index + lag] ** 2;
    }
    const normalized = correlation / Math.sqrt(Math.max(0.000001, energyA * energyB));
    scores[lag] = normalized;
    if (normalized > best) { best = normalized; bestLag = lag; }
  }
  // Autocorrelation has equally strong peaks at 2x, 3x, etc. the true period.
  // Pick the earliest strong local peak instead of the global maximum so a
  // decaying 660 Hz impact cannot be misread as a 55-70 Hz subharmonic.
  const peakThreshold = Math.max(0.32, best * 0.86);
  for (let lag = minLag + 1; lag < maxLag; lag += 1) {
    if (scores[lag] >= peakThreshold && scores[lag] >= scores[lag - 1] && scores[lag] > scores[lag + 1]) { bestLag = lag; best = scores[lag]; break; }
  }
  if (!bestLag || best < 0.28) return { frequency: 220, confidence: clamp(best, 0, 1) };
  const left = scores[Math.max(minLag, bestLag - 1)]; const center = scores[bestLag]; const right = scores[Math.min(maxLag, bestLag + 1)];
  const denominator = left - 2 * center + right;
  const refinedLag = bestLag + (Math.abs(denominator) > 0.000001 ? clamp(0.5 * (left - right) / denominator, -0.5, 0.5) : 0);
  return { frequency: clamp(rate / refinedLag, 55, 1200), confidence: clamp(best, 0, 1) };
}

function analyze(buffer: AudioBuffer): SoundDNA {
  const data = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;
  let globalPeak = 0;
  let rms = 0;
  let crossings = 0;
  for (let index = 1; index < data.length; index += 1) {
    globalPeak = Math.max(globalPeak, Math.abs(data[index]));
    rms += data[index] ** 2;
    if ((data[index - 1] < 0 && data[index] >= 0) || (data[index - 1] >= 0 && data[index] < 0)) crossings += 1;
  }
  rms = Math.sqrt(rms / Math.max(1, data.length));
  const frameSize = Math.max(128, Math.floor(sampleRate * 0.012));
  const envelope: number[] = [];
  for (let start = 0; start < data.length; start += frameSize) {
    let framePeak = 0;
    for (let index = start; index < Math.min(data.length, start + frameSize); index += 1) framePeak = Math.max(framePeak, Math.abs(data[index]));
    envelope.push(framePeak);
  }
  const threshold = Math.max(rms * 2.15, globalPeak * 0.2);
  const candidates: Array<{ frame: number; strength: number }> = [];
  for (let frame = 1; frame < envelope.length - 1; frame += 1) {
    if (envelope[frame] >= threshold && envelope[frame] > envelope[frame - 1] && envelope[frame] >= envelope[frame + 1]) {
      const previous = candidates[candidates.length - 1];
      const gap = previous ? (frame - previous.frame) * frameSize / sampleRate : 99;
      if (gap > 0.14) candidates.push({ frame, strength: envelope[frame] / Math.max(globalPeak, 0.001) });
      else if (previous && envelope[frame] > previous.strength * globalPeak) candidates[candidates.length - 1] = { frame, strength: envelope[frame] / Math.max(globalPeak, 0.001) };
    }
  }
  if (!candidates.length) {
    let strongest = 0;
    for (let frame = 1; frame < envelope.length; frame += 1) if (envelope[frame] > envelope[strongest]) strongest = frame;
    candidates.push({ frame: strongest, strength: 1 });
  }
  const hits = candidates.slice(0, 6).map((candidate) => {
    const time = candidate.frame * frameSize / sampleRate;
    const start = Math.max(0, Math.floor((time - 0.015) * sampleRate));
    const end = Math.min(data.length, start + Math.floor(sampleRate * 0.48));
    return { time, strength: candidate.strength, waveform: waveformOf(data.slice(start, end), 54) };
  });
  const detectedPitch = detectPitch(data, sampleRate);
  const pitchHz = detectedPitch.frequency;
  const midi = Math.round(69 + 12 * Math.log2(pitchHz / 440));
  const intervals = hits.slice(1).map((hit, index) => hit.time - hits[index].time).sort((a, b) => a - b);
  let bpm = intervals.length ? 60 / intervals[Math.floor(intervals.length / 2)] : 100;
  while (bpm < 72) bpm *= 2;
  while (bpm > 132) bpm /= 2;
  return {
    waveform: waveformOf(data),
    hits,
    pitchHz,
    pitchConfidence: detectedPitch.confidence,
    note: NOTES[((midi % 12) + 12) % 12],
    brightness: crossings / data.length > 0.1 ? "bright transient" : "rounded transient",
    decay: 0.32,
    bpm: Math.round(clamp(bpm, 72, 132)),
  };
}

function extractHit(context: BaseAudioContext, source: AudioBuffer, time: number, nextTime?: number) {
  const start = Math.max(0, Math.floor((time - 0.009) * source.sampleRate));
  const beforeNext = nextTime ? Math.max(0.075, nextTime - time - 0.025) : 0.42;
  const maximum = Math.min(Math.floor(source.sampleRate * Math.min(0.42, beforeNext)), source.length - start);
  const analysis = source.getChannelData(0); let peak = 0;
  for (let index = start; index < start + maximum; index += 1) peak = Math.max(peak, Math.abs(analysis[index]));
  const frame = Math.max(32, Math.floor(source.sampleRate * 0.006)); let quietFrames = 0; let duration = maximum;
  for (let offset = Math.floor(source.sampleRate * 0.07); offset < maximum - frame; offset += frame) {
    let energy = 0; for (let index = 0; index < frame; index += 1) energy += analysis[start + offset + index] ** 2;
    const rms = Math.sqrt(energy / frame); quietFrames = rms < Math.max(0.0015, peak * 0.028) ? quietFrames + 1 : 0;
    if (quietFrames >= 3) { duration = Math.max(Math.floor(source.sampleRate * 0.085), offset - frame * 2); break; }
  }
  const output = context.createBuffer(source.numberOfChannels, Math.max(1, duration), source.sampleRate);
  const fadeIn = Math.max(1, Math.floor(source.sampleRate * 0.002)); const fadeOut = Math.max(1, Math.min(duration - 1, Math.floor(source.sampleRate * 0.014)));
  for (let channel = 0; channel < source.numberOfChannels; channel += 1) {
    const data = source.getChannelData(channel).slice(start, start + duration);
    for (let index = 0; index < Math.min(fadeIn, data.length); index += 1) data[index] *= index / fadeIn;
    for (let index = 0; index < Math.min(fadeOut, data.length); index += 1) data[data.length - 1 - index] *= index / fadeOut;
    output.copyToChannel(data, channel);
  }
  return output;
}

function patternFor(id: InstrumentId, groove: Groove, synthShape: SynthShape): number[] {
  if (id === "foundation") return groove === "pocket" ? [0, 3, 7, 10, 14] : groove === "sparse" ? [0, 8] : [0, 4, 8, 12];
  if (id === "kick") return groove === "sparse" ? [0, 10] : groove === "pocket" ? [0, 7, 10] : [0, 4, 8, 12];
  if (id === "clap") return groove === "pocket" ? [4, 11] : [4, 12];
  if (id === "hat") return groove === "sparse" ? [2, 6, 14] : groove === "pocket" ? [2, 5, 8, 11, 14] : [2, 6, 10, 14];
  if (id === "bass") return groove === "pocket" ? [0, 6, 9, 14] : [0, 8, 12];
  return synthShape === "pad" ? [0, 8] : synthShape === "arp" ? [0, 3, 6, 9, 12, 15] : [0, 4, 7, 11, 14];
}

function repetitionPattern(count: number) {
  const safeCount = clamp(Math.round(count), 0, 12);
  if (!safeCount) return [];
  return Array.from(new Set(Array.from({ length: safeCount }, (_, index) => Math.floor((index * 16) / safeCount))));
}

function eventsFromPattern(id: InstrumentId, pattern: number[], bars: number, mode: MusicalMode, shape: SynthShape, activeBars?: number[]) {
  const playableBars = activeBars?.length ? activeBars : Array.from({ length: bars }, (_, index) => index + 1);
  const cadenceBars = playableBars.filter((bar) => bar % 4 === 0 || bar === bars);
  return pattern.map((step, index): NoteEvent => {
    const eventBars = index === pattern.length - 1 && playableBars.length > 3
      ? playableBars.filter((bar) => !cadenceBars.includes(bar))
      : playableBars;
    const pitch = id === "bass" ? quantizePitch(index % 3 === 2 ? -5 : -12, mode, -24, -5) : 0;
    const pitches = id === "synth" && shape === "pad"
      ? mode === "major" ? [0, 4, 7] : mode === "suspended" ? [0, 5, 7] : [0, 3, 7]
      : [pitch];
    return {
      bars: eventBars.length ? eventBars : playableBars,
      step,
      pitches,
      duration: id === "synth" && shape === "pad" ? 8 : id === "bass" ? 3 : 1,
      velocity: clamp((id === "hat" ? 0.42 : id === "synth" ? 0.52 : 0.72) + (step === 0 ? 0.08 : 0) - index * 0.025, 0.2, 0.92),
    };
  });
}

function normalizeNoteEvents(
  events: NoteEvent[] | undefined,
  bars: number,
  mode: MusicalMode,
  kind: InstrumentId | "seed_voice",
  fallbackPattern: number[],
  shape: SynthShape,
  activeBars?: number[],
  character?: SeedVoiceCharacter,
) {
  const fallbackKind = kind === "seed_voice" ? "synth" : kind;
  const source = events?.length ? events : eventsFromPattern(fallbackKind, fallbackPattern, bars, mode, shape, activeBars);
  const maxPerBar = kind === "hat" ? 8 : kind === "clap" ? 2 : kind === "synth" && shape === "pad" ? 2 : kind === "seed_voice" ? 6 : 4;
  const perBar = new Map<number, number>();
  const normalized: NoteEvent[] = [];
  source.slice(0, 24).forEach((event) => {
    const eventBars = Array.from(new Set((event.bars?.length ? event.bars : activeBars ?? [1]).map((bar) => clamp(Math.round(bar), 1, bars)))).sort((a, b) => a - b)
      .filter((bar) => (perBar.get(bar) ?? 0) < maxPerBar);
    if (!eventBars.length) return;
    eventBars.forEach((bar) => perBar.set(bar, (perBar.get(bar) ?? 0) + 1));
    let pitchRange: [number, number] = [-12, 18];
    if (kind === "bass") pitchRange = [-24, -5];
    if (character === "low_pulse") pitchRange = [-19, -5];
    if (character === "high_spark") pitchRange = [7, 19];
    const isPercussion = kind === "foundation" || kind === "kick" || kind === "clap" || kind === "hat";
    const pitches = isPercussion ? [0] : Array.from(new Set((event.pitches?.length ? event.pitches : [0]).map((pitch) => quantizePitch(pitch, mode, pitchRange[0], pitchRange[1])))).slice(0, kind === "synth" && shape === "pad" ? 4 : 2);
    const durationLimit = kind === "synth" && shape === "pad" ? 16 : kind === "bass" || kind === "seed_voice" ? 8 : 3;
    normalized.push({
      bars: eventBars,
      step: clamp(Math.round(event.step), 0, 15),
      pitches,
      duration: clamp(Math.round(event.duration ?? 1), 1, durationLimit),
      velocity: clamp(event.velocity ?? 0.7, 0.15, 1),
    });
  });
  if (kind === "synth" && shape === "pad") {
    normalized.sort((a, b) => (Math.min(...a.bars) - Math.min(...b.bars)) || a.step - b.step);
    let previousChord: number[] | null = null;
    normalized.forEach((event) => {
      const chord = [...event.pitches].sort((a, b) => a - b).map((pitch, index) => {
        if (!previousChord?.length) return pitch;
        const target = previousChord[Math.min(index, previousChord.length - 1)];
        return [pitch - 12, pitch, pitch + 12].filter((candidate) => candidate >= -12 && candidate <= 18).reduce((best, candidate) => Math.abs(candidate - target) < Math.abs(best - target) ? candidate : best, pitch);
      });
      event.pitches = Array.from(new Set(chord)); previousChord = event.pitches;
    });
  }
  return normalized;
}

function eventPattern(events: NoteEvent[], fallback: number[] = []) {
  const steps = Array.from(new Set(events.map((event) => event.step))).sort((a, b) => a - b);
  return steps.length ? steps : fallback;
}

function layerPlaysInBar(id: InstrumentId, bar: number, totalBars: number, shape: ArrangementShape) {
  if (id === "foundation" || shape === "steady" || totalBars < 3) return true;
  const progress = bar / Math.max(1, totalBars - 1);
  if (shape === "build") {
    if (id === "kick") return true;
    if (id === "bass") return progress >= 0.16;
    if (id === "synth") return progress >= 0.34;
    return progress >= 0.55;
  }
  if (id === "kick" || id === "bass") return true;
  if (id === "synth") return progress >= 0.2 && progress <= 0.86;
  return progress >= 0.32 && progress <= 0.76;
}

function layerActiveAtBar(layer: Layer, bar: number, totalBars: number, shape: ArrangementShape) {
  if (layer.events) return layer.events.some((event) => event.bars.includes(bar + 1));
  if (layer.activeBars) return layer.activeBars.includes(bar + 1);
  if (layer.voice) return bar + 1 >= layer.voice.start_bar && bar + 1 <= layer.voice.end_bar;
  return layerPlaysInBar(layer.kind as InstrumentId, bar, totalBars, shape);
}

function Wave({ values, color, active = false }: { values: number[]; color: string; active?: boolean }) {
  return <div className={`waveform ${active ? "waveform--active" : ""}`}>{values.map((value, index) => <i key={index} style={{ height: `${Math.max(7, value * 92)}%`, background: color, animationDelay: `${-index * 0.018}s` }} />)}</div>;
}

function TimelineEventCell({ layer, bar, active, playing }: { layer: Layer; bar: number; active: boolean; playing: boolean }) {
  const events = (layer.events ?? []).filter((event) => event.bars.includes(bar + 1));
  return <i className={`${active ? "active" : ""} ${playing ? "playing" : ""}`} style={active ? { background: `${layer.color}22`, borderColor: layer.color } : undefined}>{events.flatMap((event, eventIndex) => event.pitches.map((pitch, pitchIndex) => <b key={`${eventIndex}-${pitchIndex}`} style={{ left: `${5 + (event.step / 15) * 88}%`, bottom: `${clamp(((pitch + 24) / 48) * 82 + 7, 7, 89)}%`, background: layer.color }} />)).slice(0, 14)}</i>;
}

function encodeWav(buffer: AudioBuffer) {
  const channels = buffer.numberOfChannels;
  const blockAlign = channels * 2;
  const result = new ArrayBuffer(44 + buffer.length * blockAlign);
  const view = new DataView(result);
  const text = (offset: number, value: string) => { for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index)); };
  text(0, "RIFF"); view.setUint32(4, 36 + buffer.length * blockAlign, true); text(8, "WAVE"); text(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true); view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * blockAlign, true); view.setUint16(32, blockAlign, true); view.setUint16(34, 16, true); text(36, "data"); view.setUint32(40, buffer.length * blockAlign, true);
  let offset = 44;
  for (let index = 0; index < buffer.length; index += 1) for (let channel = 0; channel < channels; channel += 1) {
    const sample = clamp(buffer.getChannelData(channel)[index], -1, 1);
    view.setInt16(offset, sample < 0 ? sample * 32768 : sample * 32767, true); offset += 2;
  }
  return result;
}

function reviewRenderedAudio(buffer: AudioBuffer, bars: number): AudioReview {
  const channel = buffer.getChannelData(0); const stride = Math.max(1, Math.floor(buffer.sampleRate / 22050));
  let peak = 0; let energy = 0; let lowEnergy = 0; let highEnergy = 0; let lowState = 0; let highState = 0; let samples = 0;
  const lowAlpha = 1 - Math.exp((-2 * Math.PI * 260) / (buffer.sampleRate / stride));
  const highAlpha = 1 - Math.exp((-2 * Math.PI * 4200) / (buffer.sampleRate / stride));
  for (let index = 0; index < channel.length; index += stride) {
    const sample = channel[index]; peak = Math.max(peak, Math.abs(sample)); energy += sample * sample; samples += 1;
    lowState += lowAlpha * (sample - lowState); highState += highAlpha * (sample - highState);
    lowEnergy += lowState * lowState; const high = sample - highState; highEnergy += high * high;
  }
  const rms = Math.sqrt(energy / Math.max(1, samples)); const totalEnergy = Math.max(0.000001, energy);
  const barRms: number[] = []; const profiles: number[][] = []; const barLength = Math.max(1, Math.floor(channel.length / Math.max(1, bars)));
  for (let bar = 0; bar < bars; bar += 1) {
    let barEnergy = 0; let count = 0; const profile: number[] = [];
    const segment = Math.max(1, Math.floor(barLength / 24));
    for (let part = 0; part < 24; part += 1) {
      let partPeak = 0;
      for (let index = bar * barLength + part * segment; index < Math.min(channel.length, bar * barLength + (part + 1) * segment); index += stride) {
        const sample = channel[index]; barEnergy += sample * sample; count += 1; partPeak = Math.max(partPeak, Math.abs(sample));
      }
      profile.push(partPeak);
    }
    barRms.push(Math.sqrt(barEnergy / Math.max(1, count))); profiles.push(profile);
  }
  const similarities: number[] = [];
  for (let bar = 1; bar < profiles.length; bar += 1) {
    let dot = 0; let a = 0; let b = 0;
    for (let index = 0; index < profiles[bar].length; index += 1) { dot += profiles[bar - 1][index] * profiles[bar][index]; a += profiles[bar - 1][index] ** 2; b += profiles[bar][index] ** 2; }
    similarities.push(dot / Math.sqrt(Math.max(0.000001, a * b)));
  }
  const repetition = similarities.length ? similarities.reduce((sum, value) => sum + value, 0) / similarities.length : 0;
  const loudestBar = Math.max(...barRms, 0.0001); const quietestBar = Math.min(...barRms); const dynamicRange = clamp((loudestBar - quietestBar) / loudestBar, 0, 1);
  const lowShare = clamp(lowEnergy / totalEnergy, 0, 1); const highShare = clamp(highEnergy / totalEnergy, 0, 1); const issues: string[] = [];
  if (peak > 0.985) issues.push("The master peak is too close to clipping.");
  if (rms < 0.025) issues.push("The arrangement is too quiet or contains too much empty output.");
  if (rms > 0.24) issues.push("The mix is overly dense and loud.");
  if (lowShare > 0.68) issues.push("Low-frequency energy is dominating the mix.");
  if (highShare > 0.34) issues.push("The top end is too sharp or noisy.");
  if (bars >= 4 && repetition > 0.94 && dynamicRange < 0.22) issues.push("Adjacent bars sound too similar and need a musical variation or rest.");
  const score = clamp(Math.round(100 - issues.length * 11 - Math.max(0, repetition - 0.9) * 80 - Math.max(0, peak - 0.94) * 120), 0, 100);
  return { score, peak, rms, lowEnergy: lowShare, highEnergy: highShare, repetition, dynamicRange, issues };
}

export function BeatFoundry() {
  const [dna, setDna] = useState<SoundDNA | null>(null);
  const [sourceName, setSourceName] = useState("");
  const [duration, setDuration] = useState(0);
  const [selectedHit, setSelectedHit] = useState(0);
  const [groove, setGroove] = useState<Groove>("pocket");
  const [synthShape, setSynthShape] = useState<SynthShape>("pluck");
  const [musicalMode, setMusicalMode] = useState<MusicalMode>("minor");
  const [arrangementShape, setArrangementShape] = useState<ArrangementShape>("steady");
  const [progression, setProgression] = useState<number[]>([0, -2, -4, -5]);
  const [seedPresence, setSeedPresence] = useState(0.82);
  const [layerLevels, setLayerLevels] = useState<LayerLevels>(DEFAULT_LEVELS);
  const [brief, setBrief] = useState("Make this feel like a catchy late-night idea where my little click is the thing I remember.");
  const [studioMessages, setStudioMessages] = useState<StudioMessage[]>([
    { id: "director-welcome", role: "assistant", text: "I’m your sound director. Describe the first version in plain language, then keep talking to me to change it—tempo, mood, density, instruments, or any detail you can hear." },
  ]);
  const [currentPlan, setCurrentPlan] = useState<ArrangementPlan | null>(null);
  const [planHistory, setPlanHistory] = useState<ArrangementPlan[]>([]);
  const [version, setVersion] = useState(0);
  const [dictating, setDictating] = useState(false);
  const [loopBars, setLoopBars] = useState(4);
  const [seedRepetitions, setSeedRepetitions] = useState(5);
  const [tempo, setTempo] = useState(100);
  const [customPatterns, setCustomPatterns] = useState<Partial<Record<InstrumentId, number[]>>>({});
  const [planning, setPlanning] = useState(false);
  const [planError, setPlanError] = useState("");
  const [styleName, setStyleName] = useState("Open pocket");
  const [soundDesign, setSoundDesign] = useState<SoundDesign>({ kick_depth: 0.72, brightness: 0.55, swing: 0.12, space: 0.7 });
  const [audioReview, setAudioReview] = useState<AudioReview | null>(null);
  const [layers, setLayers] = useState<Layer[]>([]);
  const [solo, setSolo] = useState<string | null>(null);
  const [audition, setAudition] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [step, setStep] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [recordTime, setRecordTime] = useState(0);
  const [analyzing, setAnalyzing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [decision, setDecision] = useState("The seed is ready. AI will compose notes, rhythms and sections while every timbre remains derived from this source.");

  const fileInput = useRef<HTMLInputElement>(null);
  const rawBuffer = useRef<AudioBuffer | null>(null);
  const seedBuffer = useRef<AudioBuffer | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const scheduler = useRef<number | null>(null);
  const nextNote = useRef(0);
  const stepRef = useRef(0);
  const activeSources = useRef<Set<AudioScheduledSourceNode>>(new Set());
  const recorder = useRef<MediaRecorder | null>(null);
  const mediaStream = useRef<MediaStream | null>(null);
  const recordTicker = useRef<number | null>(null);
  const recordStarted = useRef(0);
  const recognitionRef = useRef<PromptRecognition | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const layersRef = useRef<Layer[]>([]);
  const grooveRef = useRef<Groove>("pocket");
  const synthRef = useRef<SynthShape>("pluck");
  const soloRef = useRef<string | null>(null);
  const auditionRef = useRef<string | null>(null);
  const bpmRef = useRef(100);
  const barsRef = useRef(4);
  const repetitionsRef = useRef(5);
  const customPatternsRef = useRef<Partial<Record<InstrumentId, number[]>>>({});
  const soundDesignRef = useRef<SoundDesign>({ kick_depth: 0.72, brightness: 0.55, swing: 0.12, space: 0.7 });
  const musicalModeRef = useRef<MusicalMode>("minor");
  const arrangementShapeRef = useRef<ArrangementShape>("steady");
  const progressionRef = useRef<number[]>([0, -2, -4, -5]);
  const seedPresenceRef = useRef(0.82);
  const layerLevelsRef = useRef<LayerLevels>(DEFAULT_LEVELS);
  const rootHzRef = useRef(220);
  const seedSourceHzRef = useRef(220);
  const seedWaveCache = useRef<WeakMap<BaseAudioContext, PeriodicWave>>(new WeakMap());

  useEffect(() => { layersRef.current = layers; }, [layers]);
  useEffect(() => { grooveRef.current = groove; }, [groove]);
  useEffect(() => { synthRef.current = synthShape; }, [synthShape]);
  useEffect(() => { soloRef.current = solo; }, [solo]);
  useEffect(() => { auditionRef.current = audition; }, [audition]);
  useEffect(() => { bpmRef.current = tempo; }, [tempo]);
  useEffect(() => { barsRef.current = loopBars; }, [loopBars]);
  useEffect(() => { repetitionsRef.current = seedRepetitions; }, [seedRepetitions]);
  useEffect(() => { customPatternsRef.current = customPatterns; }, [customPatterns]);
  useEffect(() => { soundDesignRef.current = soundDesign; }, [soundDesign]);
  useEffect(() => { musicalModeRef.current = musicalMode; }, [musicalMode]);
  useEffect(() => { arrangementShapeRef.current = arrangementShape; }, [arrangementShape]);
  useEffect(() => { progressionRef.current = progression; }, [progression]);
  useEffect(() => { seedPresenceRef.current = seedPresence; }, [seedPresence]);
  useEffect(() => { layerLevelsRef.current = layerLevels; }, [layerLevels]);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [planning, studioMessages]);

  const ensureContext = useCallback(async () => {
    if (!contextRef.current || contextRef.current.state === "closed") contextRef.current = new AudioContext();
    if (contextRef.current.state === "suspended") await contextRef.current.resume();
    return contextRef.current;
  }, []);

  const stop = useCallback(() => {
    if (scheduler.current !== null) window.clearInterval(scheduler.current);
    scheduler.current = null;
    activeSources.current.forEach((source) => { try { source.stop(); } catch { /* ended */ } });
    activeSources.current.clear();
    setPlaying(false); setStep(0);
  }, []);

  const playSample = useCallback((
    ctx: BaseAudioContext, destination: AudioNode, buffer: AudioBuffer, when: number, rate: number, gainAmount: number,
    length: number, filterType: BiquadFilterType = "allpass", filterFrequency = 2000, loop = false, detune = 0,
  ) => {
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    source.buffer = buffer; source.playbackRate.setValueAtTime(rate, when); source.detune.setValueAtTime(detune, when); source.loop = loop;
    filter.type = filterType; filter.frequency.setValueAtTime(filterFrequency, when);
    gain.gain.setValueAtTime(0.0001, when); gain.gain.exponentialRampToValueAtTime(Math.max(0.001, gainAmount), when + Math.min(0.04, length * 0.15));
    gain.gain.exponentialRampToValueAtTime(0.0001, when + length);
    source.connect(filter); filter.connect(gain); gain.connect(destination); source.start(when); source.stop(when + length + 0.03);
    if (ctx instanceof AudioContext) { activeSources.current.add(source); source.onended = () => activeSources.current.delete(source); }
  }, []);

  const getSeedWave = useCallback((ctx: BaseAudioContext, buffer: AudioBuffer) => {
    const cached = seedWaveCache.current.get(ctx); if (cached) return cached;
    const data = buffer.getChannelData(0); let peakIndex = 0;
    for (let index = 1; index < data.length; index += 1) if (Math.abs(data[index]) > Math.abs(data[peakIndex])) peakIndex = index;
    const cycleLength = clamp(Math.round(buffer.sampleRate / clamp(seedSourceHzRef.current, 55, 1200)), 32, Math.min(1024, Math.max(32, data.length - 2)));
    let start = clamp(peakIndex + Math.floor(buffer.sampleRate * 0.004), 0, Math.max(0, data.length - cycleLength - 2));
    const searchEnd = Math.min(data.length - cycleLength - 2, start + cycleLength);
    for (let index = start + 1; index < searchEnd; index += 1) if (data[index - 1] <= 0 && data[index] > 0) { start = index; break; }
    const sampleCount = 256; const harmonics = Math.min(16, Math.max(4, Math.floor(cycleLength / 2)));
    const real = new Float32Array(harmonics + 1); const imag = new Float32Array(harmonics + 1);
    for (let harmonic = 1; harmonic <= harmonics; harmonic += 1) {
      let cosine = 0; let sine = 0;
      for (let index = 0; index < sampleCount; index += 1) {
        const position = start + (index / sampleCount) * cycleLength; const left = Math.floor(position); const fraction = position - left;
        const sample = (data[left] ?? 0) * (1 - fraction) + (data[left + 1] ?? 0) * fraction; const phase = (2 * Math.PI * harmonic * index) / sampleCount;
        cosine += sample * Math.cos(phase); sine += sample * Math.sin(phase);
      }
      const rolloff = 1 / Math.pow(harmonic, 0.42); real[harmonic] = ((cosine * 2) / sampleCount) * rolloff; imag[harmonic] = ((-sine * 2) / sampleCount) * rolloff;
    }
    const energy = real.reduce((sum, value, index) => sum + Math.abs(value) + Math.abs(imag[index]), 0); if (energy < 0.0001) imag[1] = Math.max(0.1, Math.abs(data[peakIndex] ?? 0));
    const wave = ctx.createPeriodicWave(real, imag, { disableNormalization: false }); seedWaveCache.current.set(ctx, wave); return wave;
  }, []);

  const playSeedKick = useCallback((ctx: BaseAudioContext, destination: AudioNode, buffer: AudioBuffer, when: number, depth: number, level: number) => {
    const oscillator = ctx.createOscillator(); const filter = ctx.createBiquadFilter(); const gain = ctx.createGain();
    oscillator.setPeriodicWave(getSeedWave(ctx, buffer)); oscillator.frequency.setValueAtTime(118 - depth * 22, when); oscillator.frequency.exponentialRampToValueAtTime(42 + (1 - depth) * 12, when + 0.17 + depth * 0.11);
    filter.type = "lowpass"; filter.frequency.setValueAtTime(190 + (1 - depth) * 90, when); filter.frequency.exponentialRampToValueAtTime(95, when + 0.3); filter.Q.setValueAtTime(0.8, when);
    gain.gain.setValueAtTime(Math.max(0.001, level * 0.72), when); gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.27 + depth * 0.22);
    oscillator.connect(filter); filter.connect(gain); gain.connect(destination); oscillator.start(when); oscillator.stop(when + 0.56);
    if (ctx instanceof AudioContext) { activeSources.current.add(oscillator); oscillator.onended = () => activeSources.current.delete(oscillator); }
  }, [getSeedWave]);

  const playSeedInstrument = useCallback((
    ctx: BaseAudioContext, destination: AudioNode, buffer: AudioBuffer, when: number, frequency: number, gainAmount: number,
    length: number, attack: number, filterFrequency: number, detune = 0,
  ) => {
    const oscillator = ctx.createOscillator(); const filter = ctx.createBiquadFilter(); const gain = ctx.createGain();
    oscillator.setPeriodicWave(getSeedWave(ctx, buffer)); oscillator.frequency.setValueAtTime(clamp(frequency, 32, 1600), when); oscillator.detune.setValueAtTime(detune, when);
    filter.type = "lowpass"; filter.frequency.setValueAtTime(clamp(filterFrequency, 100, 7000), when); filter.Q.setValueAtTime(0.7, when);
    const safeLength = Math.max(0.08, length); const safeAttack = Math.min(safeLength * 0.55, Math.max(0.004, attack)); const releaseStart = Math.max(when + safeAttack + 0.02, when + safeLength * 0.64);
    gain.gain.setValueAtTime(0.0001, when); gain.gain.exponentialRampToValueAtTime(Math.max(0.001, gainAmount), when + safeAttack); gain.gain.setValueAtTime(Math.max(0.001, gainAmount * 0.7), releaseStart); gain.gain.exponentialRampToValueAtTime(0.0001, when + safeLength);
    oscillator.connect(filter); filter.connect(gain); gain.connect(destination); oscillator.start(when); oscillator.stop(when + safeLength + 0.03);
    if (ctx instanceof AudioContext) { activeSources.current.add(oscillator); oscillator.onended = () => activeSources.current.delete(oscillator); }
  }, [getSeedWave]);

  const scheduleLayer = useCallback((layer: Layer, currentStep: number, when: number, ctx: BaseAudioContext, destination: AudioNode, buffer: AudioBuffer, sixteenth: number) => {
    const localStep = currentStep % 16; const bar = Math.floor(currentStep / 16) % Math.max(1, barsRef.current);
    const pattern = layer.pattern; const explicitEvents = layer.events?.filter((event) => event.step === localStep && event.bars.includes(bar + 1));
    if (layer.events && !explicitEvents?.length) return;
    if (!layer.events && layer.activeBars && !layer.activeBars.includes(bar + 1)) return;
    if (!layer.events && layer.voice && (bar + 1 < layer.voice.start_bar || bar + 1 > layer.voice.end_bar)) return;
    if (!layer.events && !layer.activeBars && !layer.voice && !layerPlaysInBar(layer.kind as InstrumentId, bar, barsRef.current, arrangementShapeRef.current)) return;
    if (!layer.events && !pattern.includes(localStep)) return;
    const design = soundDesignRef.current;
    const level = layer.voice ? clamp(layer.voice.level, 0.08, 0.7) : clamp(layerLevelsRef.current[layer.kind as InstrumentId] ?? 0.5, 0, 1);
    const rootShift = progressionRef.current[bar % Math.max(1, progressionRef.current.length)] ?? 0;
    const fallbackPitch = layer.voice ? layer.voice.pitch_pattern[Math.max(0, pattern.indexOf(localStep)) % layer.voice.pitch_pattern.length] ?? 0 : layer.kind === "bass" ? -12 + rootShift : rootShift;
    const events = explicitEvents?.length ? explicitEvents : [{ bars: [bar + 1], step: localStep, pitches: [fallbackPitch], duration: 1, velocity: 0.72 }];
    events.forEach((event, eventIndex) => {
      const humanSeed = ((currentStep * 17 + layer.id.length * 11 + eventIndex * 7) % 17 - 8) / 8;
      const jitter = grooveRef.current === "pocket" ? 0.012 : grooveRef.current === "sparse" ? 0.006 : 0.002;
      const eventWhen = Math.max(0, when + (localStep % 4 === 0 ? 0 : humanSeed * jitter));
      const accent = localStep === 0 ? 1.08 : localStep % 4 === 0 ? 1.02 : 0.97;
      const velocity = clamp(event.velocity * accent * (0.97 + Math.abs(humanSeed) * 0.04), 0.12, 1);
      const noteLength = Math.max(sixteenth * 0.35, sixteenth * event.duration);
      if (layer.voice) {
        const voice = layer.voice; const speedShift = 12 * Math.log2(voice.speed);
        event.pitches.forEach((pitchStep, pitchIndex) => {
          if (voice.character === "low_pulse" || voice.character === "texture") {
            const frequency = rootHzRef.current * rateFromSemitones(pitchStep + speedShift); const texture = voice.character === "texture";
            playSeedInstrument(ctx, destination, buffer, eventWhen, frequency, (texture ? 0.16 : 0.25) * level * velocity / Math.sqrt(event.pitches.length), noteLength, texture ? 0.16 + design.space * 0.22 : 0.01, texture ? 780 + design.brightness * 760 : 280 + design.brightness * 360, pitchIndex * 2 - 1);
            return;
          }
          const playbackRate = rateFromSemitones(clamp(pitchStep + speedShift, -24, 24));
          const filterType: BiquadFilterType = voice.character === "high_spark" ? "highpass" : voice.character === "melody" ? "lowpass" : voice.character === "echo" ? "bandpass" : "allpass";
          const filterFrequency = voice.character === "high_spark" ? 2300 + design.brightness * 2600 : voice.character === "texture" ? 950 + design.brightness * 900 : 1300 + design.brightness * 1900;
          const baseGain = voice.character === "high_spark" ? 0.22 : voice.character === "echo" ? 0.24 : 0.34;
          playSample(ctx, destination, buffer, eventWhen, playbackRate, baseGain * level * velocity / Math.sqrt(event.pitches.length), noteLength, filterType, filterFrequency);
          if (voice.character === "echo") playSample(ctx, destination, buffer, eventWhen + sixteenth * 0.68, playbackRate, baseGain * level * velocity * 0.34, noteLength * 0.72, "bandpass", filterFrequency * 0.86);
        });
        return;
      }
      if (layer.kind === "foundation") playSample(ctx, destination, buffer, eventWhen, rateFromSemitones(event.pitches[0] ?? 0), 0.46 * level * (0.72 + seedPresenceRef.current * 0.45) * velocity, noteLength, "lowpass", 1800 + design.brightness * 6200);
      if (layer.kind === "kick") {
        playSample(ctx, destination, buffer, eventWhen, 0.5, 0.13 * level * velocity, Math.min(noteLength, sixteenth * 0.5), "lowpass", 720);
        playSeedKick(ctx, destination, buffer, eventWhen, design.kick_depth, 0.72 * level * velocity);
      }
      if (layer.kind === "clap") {
        playSample(ctx, destination, buffer, eventWhen, 0.9 + design.brightness * 0.22, 0.29 * level * velocity, Math.min(noteLength, sixteenth), "bandpass", 900 + design.brightness * 1700);
        playSample(ctx, destination, buffer, eventWhen + 0.016, 1.08, 0.12 * level * velocity, Math.min(noteLength, sixteenth * 0.65), "highpass", 1100 + design.brightness * 1200);
      }
      if (layer.kind === "hat") playSample(ctx, destination, buffer, eventWhen, 2.2 + design.brightness * 1.25, 0.22 * level * velocity, Math.min(noteLength, sixteenth * 0.45), "highpass", 2400 + design.brightness * 3600);
      if (layer.kind === "bass") event.pitches.forEach((pitchStep, pitchIndex) => {
        const frequency = rootHzRef.current * rateFromSemitones(pitchStep);
        playSeedInstrument(ctx, destination, buffer, eventWhen, frequency, 0.27 * level * velocity / Math.sqrt(event.pitches.length), noteLength, 0.012, 230 + design.brightness * 360, pitchIndex * 2 - 1);
        playSeedInstrument(ctx, destination, buffer, eventWhen, frequency, 0.08 * level * velocity, noteLength, 0.018, 170 + design.brightness * 210, 3 - pitchIndex);
      });
      if (layer.kind === "synth") {
        if (synthRef.current === "pad") event.pitches.forEach((pitchStep, pitchIndex) => {
          const frequency = rootHzRef.current * rateFromSemitones(pitchStep); const gain = (0.16 * level * velocity) / Math.sqrt(event.pitches.length);
          playSeedInstrument(ctx, destination, buffer, eventWhen, frequency, gain, noteLength, 0.18 + design.space * 0.26, 650 + design.brightness * 980, -4 + pitchIndex * 2);
          playSeedInstrument(ctx, destination, buffer, eventWhen, frequency, gain * 0.28, noteLength, 0.24 + design.space * 0.28, 520 + design.brightness * 660, 4 - pitchIndex);
        });
        else event.pitches.forEach((pitchStep) => playSample(ctx, destination, buffer, eventWhen, rateFromSemitones(pitchStep), 0.2 * level * velocity / Math.sqrt(event.pitches.length), noteLength, "lowpass", 1250 + design.brightness * 2100));
      }
    });
  }, [playSample, playSeedInstrument, playSeedKick]);

  const start = useCallback(async () => {
    if (!seedBuffer.current) return;
    stop();
    const ctx = await ensureContext();
    const master = createMixBus(ctx, ctx.destination, soundDesignRef.current.space);
    nextNote.current = ctx.currentTime + 0.05; stepRef.current = 0;
    const tick = () => {
      const sixteenth = (60 / bpmRef.current) / 4;
      while (nextNote.current < ctx.currentTime + 0.12) {
        const current = stepRef.current;
        let audible = layersRef.current.filter((layer) => !layer.muted && !layer.removed);
        const focused = auditionRef.current || soloRef.current;
        if (focused) audible = audible.filter((layer) => layer.id === focused);
        const swungTime = nextNote.current + (current % 2 ? sixteenth * soundDesignRef.current.swing : 0);
        audible.forEach((layer) => scheduleLayer(layer, current, swungTime, ctx, master, seedBuffer.current!, sixteenth));
        window.setTimeout(() => setStep(current), Math.max(0, (nextNote.current - ctx.currentTime) * 1000));
        nextNote.current += sixteenth; stepRef.current = (current + 1) % Math.max(16, barsRef.current * 16);
      }
    };
    tick(); scheduler.current = window.setInterval(tick, 25); setPlaying(true);
  }, [ensureContext, scheduleLayer, stop]);

  const setExtractedHit = useCallback(async (index: number, analysis = dna) => {
    if (!rawBuffer.current || !analysis?.hits[index]) return;
    const ctx = await ensureContext();
    const isolated = extractHit(ctx, rawBuffer.current, analysis.hits[index].time, analysis.hits[index + 1]?.time);
    const isolatedPitch = detectPitch(isolated.getChannelData(0), isolated.sampleRate);
    let musicalRoot = isolatedPitch.confidence >= 0.34 ? isolatedPitch.frequency : 220;
    while (musicalRoot < 130) musicalRoot *= 2; while (musicalRoot > 320) musicalRoot /= 2;
    const midi = Math.round(69 + 12 * Math.log2(isolatedPitch.frequency / 440));
    rootHzRef.current = musicalRoot; seedSourceHzRef.current = isolatedPitch.confidence >= 0.24 ? isolatedPitch.frequency : 220; seedWaveCache.current = new WeakMap(); seedBuffer.current = isolated;
    setDna((current) => current ? { ...current, pitchHz: isolatedPitch.frequency, pitchConfidence: isolatedPitch.confidence, note: NOTES[((midi % 12) + 12) % 12] } : current);
    setSelectedHit(index);
    setDecision(`Hit ${String(index + 1).padStart(2, "0")} isolated. Silence and uneven gaps are removed before AI reshapes this source into the song’s notes, chords and rhythm.`);
  }, [dna, ensureContext]);

  const loadBuffer = useCallback(async (buffer: AudioBuffer, name: string) => {
    stop(); setAnalyzing(true); setError(""); await sleep(500);
    const result = analyze(buffer);
    const bestIndex = result.hits.reduce((best, hit, index) => hit.strength > result.hits[best].strength ? index : best, 0);
    const ctx = await ensureContext(); const isolated = extractHit(ctx, buffer, result.hits[bestIndex].time, result.hits[bestIndex + 1]?.time);
    const isolatedPitch = detectPitch(isolated.getChannelData(0), isolated.sampleRate); const midi = Math.round(69 + 12 * Math.log2(isolatedPitch.frequency / 440));
    result.pitchHz = isolatedPitch.frequency; result.pitchConfidence = isolatedPitch.confidence; result.note = NOTES[((midi % 12) + 12) % 12];
    const defaultDesign = { kick_depth: 0.72, brightness: 0.55, swing: 0.12, space: 0.7 };
    let musicalRoot = result.pitchConfidence >= 0.34 ? result.pitchHz : 220;
    while (musicalRoot < 130) musicalRoot *= 2; while (musicalRoot > 320) musicalRoot /= 2;
    rootHzRef.current = musicalRoot; seedSourceHzRef.current = isolatedPitch.confidence >= 0.24 ? isolatedPitch.frequency : 220; seedWaveCache.current = new WeakMap();
    rawBuffer.current = buffer; setDna(result); setSourceName(name); setDuration(buffer.duration); setSelectedHit(bestIndex); setGroove("pocket"); setSynthShape("pluck"); setMusicalMode("minor"); setArrangementShape("steady"); setProgression([0, -2, -4, -5]); setSeedPresence(0.82); setLayerLevels(DEFAULT_LEVELS); setTempo(result.bpm); setLoopBars(4); setSeedRepetitions(5); setCustomPatterns({}); setStyleName("Open pocket"); setSoundDesign(defaultDesign); setAudioReview(null); soundDesignRef.current = defaultDesign;
    musicalModeRef.current = "minor"; arrangementShapeRef.current = "steady"; progressionRef.current = [0, -2, -4, -5]; seedPresenceRef.current = 0.82; layerLevelsRef.current = DEFAULT_LEVELS;
    setCurrentPlan(null); setPlanHistory([]); setVersion(0); setStudioMessages([{ id: messageId(), role: "assistant", text: "Your seed is isolated. Tell me what the first version should feel like—describe a genre, scene, energy, instruments, or simply say something like ‘dark, minimal, and spacious’." }]);
    const foundation: Layer = { id: "foundation", kind: "foundation", name: "Seed preview", role: "Pre-arrangement preview", derivation: derivationFor("foundation", "pluck"), color: COLORS.foundation, pattern: repetitionPattern(5), source: "seed", muted: false, removed: false };
    setLayers([foundation]); layersRef.current = [foundation]; setSolo(null); setAudition(null); setAnalyzing(false);
    seedBuffer.current = isolated;
    setDecision(`I found ${result.hits.length} separate impact${result.hits.length === 1 ? "" : "s"}. Hit ${String(bestIndex + 1).padStart(2, "0")} has the cleanest attack, so its tonal body and transient become the source material for the whole arrangement.`);
  }, [ensureContext, stop]);

  const loadBlob = useCallback(async (blob: Blob, name: string) => {
    try {
      if (blob.size > 20 * 1024 * 1024) throw new Error("Please keep the recording under 20 MB.");
      const ctx = await ensureContext(); const decoded = await ctx.decodeAudioData((await blob.arrayBuffer()).slice(0));
      if (decoded.duration > 12) throw new Error("Use a short 2–10 second recording with a few impacts.");
      await loadBuffer(decoded, name);
    } catch (cause) { setAnalyzing(false); setError(cause instanceof Error ? cause.message : "That audio file could not be decoded."); }
  }, [ensureContext, loadBuffer]);

  const loadDemo = useCallback(async () => {
    const ctx = await ensureContext(); const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate); const data = buffer.getChannelData(0);
    [0.15, 0.67, 1.43].forEach((hit, hitIndex) => { for (let index = Math.floor(hit * ctx.sampleRate); index < data.length; index += 1) {
      const age = index / ctx.sampleRate - hit; const envelope = Math.exp(-age * (11 + hitIndex));
      data[index] += envelope * (Math.sin(2 * Math.PI * 660 * age) * 0.58 + Math.sin(2 * Math.PI * 1320 * age) * 0.2) * (hitIndex === 1 ? 1 : 0.74);
    }});
    await loadBuffer(buffer, "Pen on glass bottle · irregular demo");
  }, [ensureContext, loadBuffer]);

  const beginRecording = useCallback(async () => {
    try {
      setError(""); const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); mediaStream.current = stream; const chunks: Blob[] = [];
      const activeRecorder = new MediaRecorder(stream); recorder.current = activeRecorder;
      activeRecorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      activeRecorder.onstop = () => { stream.getTracks().forEach((track) => track.stop()); setIsRecording(false); loadBlob(new Blob(chunks, { type: activeRecorder.mimeType }), "Microphone impacts"); };
      activeRecorder.start(); recordStarted.current = Date.now(); setRecordTime(0); setIsRecording(true);
      recordTicker.current = window.setInterval(() => { const elapsed = (Date.now() - recordStarted.current) / 1000; setRecordTime(elapsed); if (elapsed >= 10 && activeRecorder.state === "recording") activeRecorder.stop(); }, 100);
    } catch { setError("Microphone access is unavailable. Upload a clip or try the irregular demo."); }
  }, [loadBlob]);

  const endRecording = useCallback(() => {
    if (recorder.current?.state === "recording") recorder.current.stop();
    if (recordTicker.current !== null) window.clearInterval(recordTicker.current); recordTicker.current = null; setIsRecording(false);
  }, []);

  const previewSeed = useCallback(async () => {
    if (!seedBuffer.current) return; const ctx = await ensureContext();
    const gain = ctx.createGain(); gain.gain.value = 0.8; gain.connect(ctx.destination);
    playSample(ctx, gain, seedBuffer.current, ctx.currentTime + 0.02, 1, 0.7, Math.min(0.7, seedBuffer.current.duration));
  }, [ensureContext, playSample]);

  const applyArrangementPlan = useCallback((plan: ArrangementPlan) => {
    const normalizedBars = clamp(Math.round(plan.bars), 1, 16);
    const normalizedDesign: SoundDesign = {
      kick_depth: clamp(plan.sound_design.kick_depth, 0, 1),
      brightness: clamp(plan.sound_design.brightness, 0, 1),
      swing: clamp(plan.sound_design.swing, 0, 0.35),
      space: clamp(plan.sound_design.space, 0, 1),
    };
    const normalizedPatterns = Object.fromEntries((Object.keys(COLORS) as InstrumentId[]).map((id) => [
      id,
      Array.from(new Set((plan.patterns?.[id] ?? []).map((value) => clamp(Math.round(value), 0, 15)))).sort((a, b) => a - b),
    ])) as Record<InstrumentId, number[]>;
    let repetitions = clamp(Math.round(plan.seed_repetitions ?? 0), 0, 12);
    let literalSeedBars = Array.from(new Set((Array.isArray(plan.literal_seed_bars) ? plan.literal_seed_bars : repetitions ? [1] : [])
      .map((bar) => clamp(Math.round(bar), 1, normalizedBars)))).sort((a, b) => a - b);
    if (!repetitions || !literalSeedBars.length) {
      repetitions = 0;
      literalSeedBars = [];
      normalizedPatterns.foundation = [];
    } else if (normalizedPatterns.foundation.length !== repetitions) normalizedPatterns.foundation = repetitionPattern(repetitions);
    normalizedPatterns.kick = normalizedPatterns.kick.slice(0, 4); normalizedPatterns.clap = normalizedPatterns.clap.slice(0, 2); normalizedPatterns.hat = normalizedPatterns.hat.slice(0, 8); normalizedPatterns.bass = normalizedPatterns.bass.slice(0, 4);
    normalizedPatterns.synth = plan.synth_shape === "pad" ? normalizedPatterns.synth.slice(0, 2) : normalizedPatterns.synth.slice(0, 6);
    const normalizedLevels = Object.fromEntries((Object.keys(COLORS) as InstrumentId[]).map((id) => [id, clamp(plan.layer_levels?.[id] ?? DEFAULT_LEVELS[id], 0, id === "foundation" ? 0.9 : 0.75)])) as LayerLevels;
    const normalizedMode = plan.musical_mode ?? "minor";
    const normalizedProgression = (normalizedMode === "percussive" ? [0] : (plan.progression?.length ? plan.progression : [0])).slice(0, 4).map((value) => quantizePitch(value, normalizedMode, -12, 12));
    normalizedProgression[0] = 0;
    let activeInstruments = Array.from(new Set((plan.instruments ?? []).filter((id) => INSTRUMENTS.some((instrument) => instrument.id === id)))).slice(0, 4);
    if (!literalSeedBars.length && !(plan.seed_voices ?? []).length && !activeInstruments.length) activeInstruments = ["kick", "bass"];
    (Object.keys(COLORS) as InstrumentId[]).forEach((id) => {
      if (id === "foundation") return;
      if (!activeInstruments.includes(id as Exclude<InstrumentId, "foundation">)) normalizedPatterns[id] = [];
      else if (!normalizedPatterns[id].length) normalizedPatterns[id] = patternFor(id, plan.groove ?? "pocket", plan.synth_shape ?? "pluck");
    });
    const normalizedInstrumentEvents = Object.fromEntries((Object.keys(COLORS) as InstrumentId[]).map((id) => {
      const enabled = id === "foundation" ? literalSeedBars.length > 0 : activeInstruments.includes(id as Exclude<InstrumentId, "foundation">);
      const events = enabled ? normalizeNoteEvents(plan.instrument_events?.[id], normalizedBars, normalizedMode, id, normalizedPatterns[id], plan.synth_shape ?? "pluck", id === "foundation" ? literalSeedBars : undefined) : [];
      normalizedPatterns[id] = eventPattern(events, normalizedPatterns[id]).slice(0, id === "hat" ? 8 : id === "synth" && plan.synth_shape !== "pad" ? 6 : 4);
      return [id, events];
    })) as Record<InstrumentId, NoteEvent[]>;
    const voiceIds = new Set<string>();
    const occupiedVoiceSteps = new Set<string>();
    Object.values(normalizedInstrumentEvents).flat().forEach((event) => event.bars.forEach((bar) => occupiedVoiceSteps.add(`${bar}:${event.step}`)));
    const normalizedVoices = (plan.seed_voices ?? []).slice(0, 6).map((voice, index) => {
      const baseId = voice.id.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || `voice-${index + 1}`;
      let id = baseId; let suffix = 2; while (voiceIds.has(id)) { id = `${baseId}-${suffix}`; suffix += 1; } voiceIds.add(id);
      const startBar = clamp(Math.round(voice.start_bar), 1, normalizedBars);
      const endBar = clamp(Math.max(startBar, Math.round(voice.end_bar)), startBar, normalizedBars);
      const fallbackPattern = voice.character === "low_pulse" ? [0, 8] : voice.character === "high_spark" ? [2, 10, 14] : voice.character === "texture" ? [0, 12] : voice.character === "echo" ? [3, 11] : [0, 6, 10, 14];
      let voicePattern = Array.from(new Set((voice.pattern?.length ? voice.pattern : fallbackPattern).map((value) => clamp(Math.round(value), 0, 15)))).sort((a, b) => a - b).slice(0, 6);
      const activeVoiceBars = Array.from({ length: endBar - startBar + 1 }, (_, bar) => startBar + bar);
      let voiceEvents = normalizeNoteEvents(voice.events, normalizedBars, normalizedMode, "seed_voice", voicePattern, plan.synth_shape ?? "pluck", activeVoiceBars, voice.character)
        .map((event) => ({ ...event, bars: event.bars.filter((bar) => bar >= startBar && bar <= endBar) })).filter((event) => event.bars.length);
      const collisions = voiceEvents.reduce((total, event) => total + event.bars.filter((bar) => occupiedVoiceSteps.has(`${bar}:${event.step}`)).length, 0);
      const occurrences = voiceEvents.reduce((total, event) => total + event.bars.length, 0);
      if (voice.character !== "hook" && occurrences && collisions / occurrences > 0.55) voiceEvents = voiceEvents.map((event) => ({ ...event, step: (event.step + 2) % 16 }));
      voicePattern = eventPattern(voiceEvents, voicePattern).slice(0, 6);
      voiceEvents.forEach((event) => event.bars.forEach((bar) => occupiedVoiceSteps.add(`${bar}:${event.step}`)));
      const pitchRange: [number, number] = voice.character === "high_spark" ? [7, 19] : voice.character === "low_pulse" ? [-19, -5] : [-12, 12];
      const eventPitches = Array.from(new Set(voiceEvents.flatMap((event) => event.pitches)));
      const pitchPattern = (eventPitches.length ? eventPitches : voice.pitch_pattern?.length ? voice.pitch_pattern : [0]).map((value) => quantizePitch(value, normalizedMode, pitchRange[0], pitchRange[1])).slice(0, Math.max(1, voicePattern.length));
      return { ...voice, id, start_bar: startBar, end_bar: endBar, pattern: voicePattern, pitch_pattern: pitchPattern, events: voiceEvents, speed: clamp(voice.speed ?? 1, 0.65, 1.6), level: clamp(voice.level ?? 0.36, 0.08, 0.48) };
    });
    const normalizedSections: SongSection[] = [];
    let sectionCursor = 1;
    (plan.sections?.length ? plan.sections : [{ name: "Full arrangement", start_bar: 1, end_bar: normalizedBars, energy: 0.6 }]).slice(0, 5).forEach((section) => {
      if (sectionCursor > normalizedBars) return;
      const endBar = clamp(Math.max(sectionCursor, Math.round(section.end_bar)), sectionCursor, normalizedBars);
      normalizedSections.push({ name: section.name?.trim() || `Section ${normalizedSections.length + 1}`, start_bar: sectionCursor, end_bar: endBar, energy: clamp(section.energy ?? 0.6, 0, 1) });
      sectionCursor = endBar + 1;
    });
    if (sectionCursor <= normalizedBars) normalizedSections.push({ name: "Ending", start_bar: sectionCursor, end_bar: normalizedBars, energy: normalizedSections.at(-1)?.energy ?? 0.5 });
    const normalizedPlan: ArrangementPlan = {
      ...plan,
      bars: normalizedBars,
      seed_repetitions: repetitions,
      literal_seed_bars: literalSeedBars,
      bpm: clamp(Math.round(plan.bpm), 60, 160),
      sound_design: normalizedDesign,
      musical_mode: normalizedMode,
      arrangement_shape: plan.arrangement_shape ?? "steady",
      progression: normalizedProgression,
      sections: normalizedSections,
      seed_presence: literalSeedBars.length ? clamp(plan.seed_presence ?? 0.8, 0, 1) : 0,
      layer_levels: literalSeedBars.length ? normalizedLevels : { ...normalizedLevels, foundation: 0 },
      instruments: activeInstruments,
      patterns: normalizedPatterns,
      instrument_events: normalizedInstrumentEvents,
      seed_voices: normalizedVoices,
    };
    const foundation: Layer | null = literalSeedBars.length ? { id: "foundation", kind: "foundation", name: "Literal seed", role: "Original-hit accent", derivation: `Original isolated hit · ${repetitions} time${repetitions === 1 ? "" : "s"} in bars ${literalSeedBars.join(", ")}`, color: COLORS.foundation, pattern: normalizedPatterns.foundation, events: normalizedInstrumentEvents.foundation, activeBars: literalSeedBars, source: "seed", muted: false, removed: false } : null;
    const seedVoiceLayers: Layer[] = normalizedVoices.map((voice, index) => ({
      id: `voice:${voice.id}`,
      kind: "seed_voice",
      name: voice.name,
      role: `${voice.character.replace("_", " ")} · AI-created`,
      derivation: `Pitch ${voice.pitch_pattern.map((value) => `${value >= 0 ? "+" : ""}${value}`).join("/")} ST · ${voice.speed.toFixed(2)}× speed · bars ${voice.start_bar}–${voice.end_bar} · ${voice.reason}`,
      color: VOICE_COLORS[index % VOICE_COLORS.length],
      pattern: voice.pattern,
      events: voice.events,
      source: "seed",
      voice,
      muted: false,
      removed: false,
    }));
    const generatedLayers: Layer[] = normalizedPlan.instruments.map((id) => {
      const instrument = INSTRUMENTS.find((item) => item.id === id)!;
      return {
        id,
        kind: id,
        name: id === "synth" ? (normalizedPlan.synth_shape === "pad" ? "Warm pad" : normalizedPlan.synth_shape === "arp" ? "Seed arp" : "Seed pluck") : instrument.name,
        role: instrument.role,
        derivation: derivationFor(id, normalizedPlan.synth_shape),
        color: COLORS[id],
        pattern: normalizedPatterns[id],
        events: normalizedInstrumentEvents[id],
        source: sourceFor(),
        muted: false,
        removed: false,
      };
    });
    stop(); setLoopBars(normalizedPlan.bars); setSeedRepetitions(normalizedPlan.seed_repetitions); setTempo(normalizedPlan.bpm); setGroove(normalizedPlan.groove); setSynthShape(normalizedPlan.synth_shape); setMusicalMode(normalizedPlan.musical_mode); setArrangementShape(normalizedPlan.arrangement_shape); setProgression(normalizedPlan.progression); setSeedPresence(normalizedPlan.seed_presence); setLayerLevels(normalizedPlan.layer_levels); setCustomPatterns(normalizedPatterns); setStyleName(normalizedPlan.style_name); setSoundDesign(normalizedDesign);
    const nextLayers = [...(foundation ? [foundation] : []), ...seedVoiceLayers, ...generatedLayers];
    customPatternsRef.current = normalizedPatterns; bpmRef.current = normalizedPlan.bpm; barsRef.current = normalizedPlan.bars; repetitionsRef.current = normalizedPlan.seed_repetitions; grooveRef.current = normalizedPlan.groove; synthRef.current = normalizedPlan.synth_shape; soundDesignRef.current = normalizedDesign; musicalModeRef.current = normalizedPlan.musical_mode; arrangementShapeRef.current = normalizedPlan.arrangement_shape; progressionRef.current = normalizedPlan.progression; seedPresenceRef.current = normalizedPlan.seed_presence; layerLevelsRef.current = normalizedPlan.layer_levels; setLayers(nextLayers); layersRef.current = nextLayers; setSolo(null); setAudition(null); setDecision(normalizedPlan.explanation); setCurrentPlan(normalizedPlan);
    return normalizedPlan;
  }, [stop]);

  const undoArrangement = useCallback((instruction = "Undo that") => {
    if (!currentPlan || !planHistory.length || planning) {
      setStudioMessages((messages) => [...messages, { id: messageId(), role: "user", text: instruction }, { id: messageId(), role: "assistant", text: "There isn’t an earlier generated version to restore yet." }]);
      return;
    }
    const previous = planHistory[planHistory.length - 1];
    const changes = planChanges(currentPlan, previous);
    applyArrangementPlan(previous);
    setPlanHistory((history) => history.slice(0, -1));
    setVersion((value) => Math.max(1, value - 1));
    setStudioMessages((messages) => [...messages,
      { id: messageId(), role: "user", text: instruction },
      { id: messageId(), role: "assistant", text: "Restored the previous arrangement. The audio engine and timeline are back on that version.", changes, version: Math.max(1, version - 1) },
    ]);
  }, [applyArrangementPlan, currentPlan, planHistory, planning, version]);

  const renderArrangement = useCallback(async (sampleRate = 32000) => {
    if (!seedBuffer.current) return null;
    const seconds = (60 / bpmRef.current) * 4 * barsRef.current;
    const ctx = new OfflineAudioContext(2, Math.ceil(sampleRate * seconds), sampleRate);
    const master = createMixBus(ctx, ctx.destination, soundDesignRef.current.space); const sixteenth = (60 / bpmRef.current) / 4;
    const active = layersRef.current.filter((layer) => !layer.muted && !layer.removed);
    for (let current = 0; current * sixteenth < seconds - 0.12; current += 1) {
      const swungTime = current * sixteenth + (current % 2 ? sixteenth * soundDesignRef.current.swing : 0);
      active.forEach((layer) => scheduleLayer(layer, current, swungTime, ctx, master, seedBuffer.current!, sixteenth));
    }
    return ctx.startRendering();
  }, [scheduleLayer]);

  const reviewArrangement = useCallback(async () => {
    const rendered = await renderArrangement(32000);
    if (!rendered) return null;
    const review = reviewRenderedAudio(rendered, barsRef.current); setAudioReview(review); return review;
  }, [renderArrangement]);

  const generateArrangement = useCallback(async (requestedDescription?: string) => {
    const instruction = (requestedDescription ?? brief).trim();
    if (!dna || instruction.length < 4 || planning) return;
    if (/^(undo|undo that|go back|revert|previous version)[.!\s]*$/i.test(instruction)) { undoArrangement(instruction); setBrief(""); return; }
    const previousPlan = currentPlan;
    setPlanning(true); setPlanError(""); setBrief(""); setAudioReview(null);
    setStudioMessages((messages) => [...messages, { id: messageId(), role: "user", text: instruction }]);
    setDecision(previousPlan ? "Listening to your revision and changing only the parts you directed…" : "Reading your direction and building the first version from the isolated hit…");
    try {
      const response = await fetch("/api/arrange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: instruction,
          seed: { note: dna.note, bpm: dna.bpm, brightness: dna.brightness, detectedHits: dna.hits.length, pitchConfidence: dna.pitchConfidence },
          currentPlan: previousPlan,
          history: studioMessages.slice(-8).map(({ role, text }) => ({ role, text })),
        }),
      });
      const payload = await response.json() as { plan?: ArrangementPlan; error?: string };
      if (!response.ok || !payload.plan) throw new Error(payload.error || "The sound director could not interpret that message.");
      let normalizedPlan = applyArrangementPlan(payload.plan);
      setDecision("Rendering the complete arrangement and checking its balance, repetition and dynamics…");
      let renderReview = await reviewArrangement();
      if (renderReview?.issues.length) {
        try {
          const repairDescription = `Polish the rendered song while preserving this direction: ${instruction}. Repair these measured problems: ${renderReview.issues.join(" ")}`.slice(0, 700);
          const repairResponse = await fetch("/api/arrange", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              description: repairDescription,
              seed: { note: dna.note, bpm: dna.bpm, brightness: dna.brightness, detectedHits: dna.hits.length, pitchConfidence: dna.pitchConfidence },
              currentPlan: normalizedPlan,
              history: studioMessages.slice(-8).map(({ role, text }) => ({ role, text })),
              renderReview,
              qualityRevision: true,
            }),
          });
          const repairPayload = await repairResponse.json() as { plan?: ArrangementPlan };
          if (repairResponse.ok && repairPayload.plan) {
            normalizedPlan = applyArrangementPlan(repairPayload.plan);
            renderReview = await reviewArrangement();
          }
        } catch { /* keep the valid first render when the optional listening pass is unavailable */ }
      }
      const changes = planChanges(previousPlan, normalizedPlan);
      if (renderReview) changes.unshift(`Rendered audio check ${renderReview.score}/100`);
      const nextVersion = version + 1;
      if (previousPlan) setPlanHistory((history) => [...history, previousPlan].slice(-10));
      setVersion(nextVersion);
      setStudioMessages((messages) => [...messages, { id: messageId(), role: "assistant", text: normalizedPlan.explanation, changes, version: nextVersion }]);
      window.setTimeout(() => start(), 80);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "The sound director failed.";
      setPlanError(message); setDecision("I couldn’t apply that revision. The current loop is unchanged.");
      setStudioMessages((messages) => [...messages, { id: messageId(), role: "assistant", text: `I couldn’t apply that edit, so I left the current version untouched. ${message}` }]);
    } finally { setPlanning(false); }
  }, [applyArrangementPlan, brief, currentPlan, dna, planning, reviewArrangement, start, studioMessages, undoArrangement, version]);

  const toggleDictation = useCallback(() => {
    if (dictating) { recognitionRef.current?.stop(); setDictating(false); return; }
    const speechWindow = window as typeof window & {
      SpeechRecognition?: new () => PromptRecognition;
      webkitSpeechRecognition?: new () => PromptRecognition;
    };
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) { setPlanError("Voice dictation is not available in this browser. You can still type any instruction."); return; }
    const recognition = new Recognition();
    recognition.continuous = true; recognition.interimResults = true; recognition.lang = "en-US";
    recognition.onresult = (event) => {
      let transcript = "";
      for (let index = 0; index < event.results.length; index += 1) transcript += `${event.results[index][0].transcript} `;
      setBrief(transcript.trim());
    };
    recognition.onend = () => setDictating(false);
    recognition.onerror = () => { setDictating(false); setPlanError("I couldn’t hear that clearly. Try again or type the direction."); };
    recognitionRef.current = recognition; setPlanError(""); setDictating(true); recognition.start();
  }, [dictating]);

  const addInstrument = useCallback(async (id: Exclude<InstrumentId, "foundation">) => {
    const instrument = INSTRUMENTS.find((item) => item.id === id)!;
    const name = id === "synth" ? `${synthShape === "pad" ? "Warm pad" : synthShape === "arp" ? "Seed arp" : "Seed pluck"}` : instrument.name;
    const manualPattern = customPatterns[id]?.length ? customPatterns[id]! : patternFor(id, groove, synthShape);
    const manualEvents = eventsFromPattern(id, manualPattern, loopBars, musicalMode, synthShape);
    const nextPatterns = { ...customPatternsRef.current, [id]: manualPattern };
    customPatternsRef.current = nextPatterns;
    setCustomPatterns(nextPatterns); setAudioReview(null);
    setCurrentPlan((plan) => plan ? {
      ...plan,
      synth_shape: id === "synth" ? synthShape : plan.synth_shape,
      instruments: Array.from(new Set([...plan.instruments, id])),
      patterns: { ...plan.patterns, [id]: manualPattern },
      instrument_events: { ...plan.instrument_events, [id]: manualEvents },
    } : plan);
    const layer: Layer = { id, kind: id, name, role: instrument.role, derivation: derivationFor(id, synthShape), color: COLORS[id], pattern: manualPattern, events: manualEvents, source: sourceFor(), muted: false, removed: false };
    setLayers((current) => {
      const nextLayers = current.some((item) => item.id === id) ? current.map((item) => item.id === id ? layer : item) : [...current, layer];
      layersRef.current = nextLayers;
      return nextLayers;
    });
    auditionRef.current = id; setAudition(id); setDecision(`${name} added. Hear it alone first: it uses the isolated seed as raw material, but its envelope and spectrum are rebuilt so it does not sound like another copy of the hit.`);
    if (!playing) await start();
    // Audition one hit immediately so adding a layer always has audible feedback,
    // even when its next sequenced step is late in the current bar.
    if (seedBuffer.current) {
      const ctx = await ensureContext(); const preview = ctx.createGain(); const compressor = ctx.createDynamicsCompressor();
      preview.gain.value = 0.9; preview.connect(compressor); compressor.connect(ctx.destination);
      scheduleLayer(layer, manualPattern[0] ?? 0, ctx.currentTime + 0.035, ctx, preview, seedBuffer.current, (60 / bpmRef.current) / 4);
    }
    window.setTimeout(() => { auditionRef.current = null; setAudition(null); setDecision(`${name} is now folded into the loop. The ${groove} pattern leaves room around the original beat instead of masking it.`); }, 1650);
  }, [customPatterns, ensureContext, groove, loopBars, musicalMode, playing, scheduleLayer, start, synthShape]);

  const selectGroove = useCallback((option: Groove) => {
    const nextPatterns: Partial<Record<InstrumentId, number[]>> = { ...customPatternsRef.current };
    const nextEvents: Partial<Record<InstrumentId, NoteEvent[]>> = {};
    const nextLayers = layersRef.current.map((layer) => {
      if (layer.voice) return layer;
      const kind = layer.kind as InstrumentId;
      const pattern = kind === "foundation" ? repetitionPattern(seedRepetitions) : patternFor(kind, option, synthRef.current);
      const events = eventsFromPattern(kind, pattern, barsRef.current, musicalModeRef.current, synthRef.current, layer.activeBars);
      nextPatterns[kind] = pattern; nextEvents[kind] = events;
      return { ...layer, pattern, events };
    });
    setGroove(option); setCustomPatterns(nextPatterns); setAudioReview(null); customPatternsRef.current = nextPatterns;
    setLayers(nextLayers); layersRef.current = nextLayers;
    setCurrentPlan((plan) => plan ? { ...plan, groove: option, patterns: { ...plan.patterns, ...nextPatterns }, instrument_events: { ...plan.instrument_events, ...nextEvents } } : plan);
    setDecision(`${option[0].toUpperCase() + option.slice(1)} groove selected. I recalculated the active rhythms while preserving the current seed transformations.`);
  }, [seedRepetitions]);

  const selectSynthShape = useCallback((shape: SynthShape) => {
    const synthPattern = patternFor("synth", groove, shape);
    const synthEvents = eventsFromPattern("synth", synthPattern, barsRef.current, musicalModeRef.current, shape);
    const nextPatterns = { ...customPatternsRef.current, synth: synthPattern };
    const nextLayers = layersRef.current.map((layer) => layer.kind === "synth" ? {
      ...layer,
      name: shape === "pad" ? "Warm pad" : shape === "arp" ? "Seed arp" : "Seed pluck",
      derivation: derivationFor("synth", shape),
      pattern: synthPattern,
      events: synthEvents,
    } : layer);
    synthRef.current = shape; setSynthShape(shape); setCustomPatterns(nextPatterns); setAudioReview(null); customPatternsRef.current = nextPatterns;
    setLayers(nextLayers); layersRef.current = nextLayers;
    setCurrentPlan((plan) => plan ? { ...plan, synth_shape: shape, patterns: { ...plan.patterns, synth: synthPattern }, instrument_events: { ...plan.instrument_events, synth: synthEvents } } : plan);
  }, [groove]);

  const removeLayer = useCallback((id: string) => {
    const target = layersRef.current.find((layer) => layer.id === id);
    if (!target) return;
    const removing = !target.removed;
    const nextLayers = layersRef.current.map((layer) => layer.id === id ? { ...layer, removed: removing } : layer);
    layersRef.current = nextLayers;
    setLayers(nextLayers); setAudioReview(null);
    setCurrentPlan((plan) => {
      if (!plan) return plan;
      if (target.kind === "foundation") return {
        ...plan,
        seed_repetitions: removing ? 0 : target.pattern.length,
        literal_seed_bars: removing ? [] : (target.activeBars?.length ? target.activeBars : [1]),
        seed_presence: removing ? 0 : Math.max(plan.seed_presence, 0.65),
        patterns: { ...plan.patterns, foundation: removing ? [] : target.pattern },
        instrument_events: { ...plan.instrument_events, foundation: removing ? [] : target.events ?? [] },
      };
      if (target.voice) return {
        ...plan,
        seed_voices: removing
          ? plan.seed_voices.filter((voice) => voice.id !== target.voice!.id)
          : plan.seed_voices.some((voice) => voice.id === target.voice!.id) ? plan.seed_voices : [...plan.seed_voices, target.voice],
      };
      const instrument = target.kind as Exclude<InstrumentId, "foundation">;
      return {
        ...plan,
        instruments: removing ? plan.instruments.filter((item) => item !== instrument) : Array.from(new Set([...plan.instruments, instrument])),
      };
    });
  }, []);
  const muteLayer = useCallback((id: string) => { setLayers((current) => current.map((layer) => layer.id === id ? { ...layer, muted: !layer.muted } : layer)); setAudioReview(null); }, []);

  const exportLoop = useCallback(async () => {
    if (!seedBuffer.current || !dna) return; setExporting(true);
    try {
      const rendered = await renderArrangement(44100); if (!rendered) return;
      const url = URL.createObjectURL(new Blob([encodeWav(rendered)], { type: "audio/wav" })); const link = document.createElement("a"); link.href = url; link.download = "soundseed-one-beat-loop.wav"; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    } finally { setExporting(false); }
  }, [dna, renderArrangement]);

  useEffect(() => () => {
    stop(); recognitionRef.current?.stop();
    if (recordTicker.current !== null) window.clearInterval(recordTicker.current);
    mediaStream.current?.getTracks().forEach((track) => track.stop());
    if (contextRef.current && contextRef.current.state !== "closed") void contextRef.current.close().catch(() => undefined);
  }, [stop]);

  const displayPattern = (id: InstrumentId) => customPatterns[id]
    ?? (id === "foundation" ? repetitionPattern(seedRepetitions) : patternFor(id, groove, synthShape));
  const literalSeedLayer = layers.find((layer) => layer.kind === "foundation" && !layer.removed);
  const literalSeedActive = Boolean(literalSeedLayer);
  const pitchedLayerSummary = layers.filter((layer) => !layer.removed && layer.events?.some((event) => event.pitches.some((value) => value !== 0))).map((layer) => ({
    id: layer.id,
    name: layer.name,
    pitches: Array.from(new Set(layer.events!.flatMap((event) => event.pitches))).slice(0, 8),
    events: layer.events!.reduce((total, event) => total + event.bars.length, 0),
  }));

  return <main className="app-shell beat-app">
    <header className="topbar">
      <button className="brand" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}><span className="brand-mark"><i /><i /><i /></span><span>SoundSeed</span><small>ONE BEAT LAB</small></button>
      <div className="topbar-center"><span className="status-dot" /><span>{dna ? "SEED ISOLATED" : "LISTENING ROOM READY"}</span></div>
      <span className="topbar-mode">SOURCE → SEED DNA → SONG</span>
    </header>

    {!dna && !analyzing ? <section className="landing beat-landing">
      <div className="hero-copy">
        <p className="kicker"><span>01</span> RECORD IT MESSY. KEEP ONE PERFECT HIT.</p>
        <h1>Find the one<br />beat inside<br /><em>the noise.</em></h1>
        <p className="hero-subtitle">Tap a pen on a bottle two or three times—badly timed is fine. We isolate one clean impact, then reshape its tonal body and transient into a complete set of distinct instruments. The literal hit is optional.</p>
        <div className="messy-pattern" aria-label="Three irregular hits become one clean loop"><span className="messy-hit first" /><span className="messy-hit second" /><span className="messy-hit third" /><i /><b>ONE HIT</b><span className="clean-hit" /><span className="clean-hit" /><span className="clean-hit" /><span className="clean-hit" /></div>
      </div>
      <div className={`capture-card ${dragging ? "capture-card--dragging" : ""}`} onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={() => setDragging(false)} onDrop={(event: DragEvent<HTMLDivElement>) => { event.preventDefault(); setDragging(false); const file = event.dataTransfer.files[0]; if (file) loadBlob(file, file.name); }}>
        <div className="capture-topline"><span>CAPTURE 2–3 IMPACTS</span><span>MAX 10 SEC</span></div>
        <div className="bottle-visual" aria-hidden="true"><span className="pen-line" /><span className="impact-ring ring-one" /><span className="impact-ring ring-two" /><div className="bottle"><i /><i /><i /></div></div>
        <div className="capture-copy"><h2>Tap anything.<br />Timing doesn’t matter.</h2><p>Leave a little space between hits. We’ll choose the cleanest attack and remove the rest.</p></div>
        <div className="capture-actions"><button className={`record-button ${isRecording ? "is-recording" : ""}`} onClick={isRecording ? endRecording : beginRecording}><span className="record-icon" />{isRecording ? `Stop · ${recordTime.toFixed(1)}s` : "Record impacts"}</button><span className="or-divider">OR</span><button className="upload-button" onClick={() => fileInput.current?.click()}><span>↑</span> Upload audio</button><input ref={fileInput} type="file" accept="audio/*" hidden onChange={(event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (file) loadBlob(file, file.name); }} /></div>
        <button className="demo-link" onClick={loadDemo}>Try three irregular pen-on-bottle hits <span>→</span></button>{error && <p className="error-message">{error}</p>}
      </div>
    </section> : analyzing ? <section className="analysis-loading"><div className="analysis-ring"><span /><span /><span /></div><p className="kicker"><span>02</span> SEPARATING IMPACTS</p><h1>Looking for the<br />cleanest attack.</h1><div className="scan-line"><i /></div><p>Removing uneven gaps, room noise and overlapping tails…</p></section> : dna ? <section className="beat-studio">
      <div className="studio-heading beat-heading"><div><p className="kicker"><span>02</span> IMPACT FILTER</p><h1>We only need<br /><em>one good hit.</em></h1></div><div className="seed-summary"><span className="seed-file-label">RAW RECORDING</span><strong>{sourceName}</strong><span>{duration.toFixed(1)} SEC · {dna.hits.length} IMPACTS FOUND</span><button onClick={() => { stop(); setDna(null); setLayers([]); }}>Start over ↗</button></div></div>

      <section className="extract-section">
        <div className="raw-capture-block">
          <div className="section-tag"><span>A</span><div><b>RAW CAPTURE</b><small>IRREGULAR INPUT</small></div></div>
          <div className="marked-wave"><Wave values={dna.waveform} color="#191816" />{dna.hits.map((hit, index) => <button key={index} className={selectedHit === index ? "selected" : ""} style={{ left: `${clamp((hit.time / duration) * 100, 2, 96)}%` }} onClick={() => setExtractedHit(index)} aria-label={`Choose detected hit ${index + 1}`}><i />{String(index + 1).padStart(2, "0")}</button>)}</div>
          <div className="raw-meta"><span>0:00</span><strong>GAPS: IGNORED</strong><span>{duration.toFixed(1)}s</span></div>
          <p>Your timing is not used as the rhythm. We detect the separate attacks first.</p>
        </div>
        <div className="extract-arrow"><span>AI</span><i>→</i><small>FILTER</small></div>
        <div className="isolated-block">
          <div className="section-tag inverse"><span>B</span><div><b>ISOLATED SEED</b><small>FOUNDATION SOURCE</small></div><em>RECOMMENDED</em></div>
          <Wave values={dna.hits[selectedHit]?.waveform ?? []} color="#ffb44a" />
          <div className="hit-selector">{dna.hits.map((hit, index) => <button key={index} className={selectedHit === index ? "active" : ""} onClick={() => setExtractedHit(index)}><span>HIT {String(index + 1).padStart(2, "0")}</span><b>{Math.round(hit.strength * 100)}%</b></button>)}</div>
          <div className="filter-result"><span>✓</span><p><b>One transient kept.</b><small>Leading silence, background tail and every other hit removed.</small></p></div>
        </div>
      </section>

      <div className="ai-decision"><div className="ai-avatar"><i /><i /><i /></div><div><span>SOUNDSEED / LIVE DECISION</span><p>{decision}</p></div>{audition && <b>SOLO AUDITION</b>}</div>

      <section className="pitch-lab ai-pitch-lab">
        <div className="pitch-copy"><p className="kicker"><span>03</span> AI NOTE COMPOSER</p><h2>One fingerprint.<br /><em>A whole score.</em></h2><p>You describe the feeling. AI writes the notes, chord voicings, durations and accents for every pitched seed-derived layer.</p><button className="hear-original" onClick={previewSeed}>▶ Hear the isolated source</button></div>
        <div className="pitch-console ai-note-console">
          <div className="note-readout"><div><small>DETECTED SOURCE</small><strong>{dna.pitchConfidence >= 0.34 ? dna.note : "HIT"}</strong><span>{dna.pitchConfidence >= 0.34 ? `${Math.round(dna.pitchHz)} Hz` : "UNPITCHED · AI CHOOSES KEY"}</span></div><i>→</i><div className="pitched"><small>AI SCORE</small><strong>{pitchedLayerSummary.length || "—"}</strong><span>{pitchedLayerSummary.length ? "PITCHED LAYERS" : "GENERATE A VERSION"}</span></div></div>
          <div className="ai-pitch-map">{pitchedLayerSummary.length ? pitchedLayerSummary.map((layer) => <div key={layer.id}><span><b>{layer.name}</b><small>{layer.events} note events</small></span><p>{layer.pitches.map((value) => <i key={value} style={{ bottom: `${clamp(((value + 24) / 48) * 100, 4, 92)}%` }} title={`${value >= 0 ? "+" : ""}${value} semitones`} />)}</p><code>{layer.pitches.map((value) => `${value >= 0 ? "+" : ""}${value}`).join(" · ")} ST</code></div>) : <div className="empty-pitch-map"><Wave values={dna.hits[selectedHit]?.waveform ?? []} color="#9adf64" /><p>Your generated note paths will appear here.</p></div>}</div>
          <div className="ai-note-rule"><span>AI WRITES</span><b>NOTES · CHORDS · DURATION · VELOCITY</b><small>Then SoundSeed checks key, range, collisions and voice-leading before playback.</small></div>
        </div>
      </section>

      <section className="loop-lab">
        <div className="loop-heading"><div><p className="kicker"><span>04</span> DIRECT THE STUDIO</p><h2>Describe the feeling.<br /><em>AI builds the next version.</em></h2></div><p>Talk normally. SoundSeed decides the pitch, speed, layers and timeline changes, then shows you what it did.</p></div>
        <div className="voice-studio">
          <section className="studio-chat" aria-label="Conversational sound director">
            <div className="studio-chat-top"><div><span className="live-dot" /> SOUNDSEED DIRECTOR</div><div>{version ? `VERSION ${version}` : "NEW SESSION"}</div></div>
            <div className="studio-thread" aria-live="polite">
              {studioMessages.map((message) => <article key={message.id} className={`studio-message ${message.role}`}>
                <div className="message-author"><span>{message.role === "assistant" ? "SS" : "YOU"}</span><b>{message.role === "assistant" ? "SoundSeed" : "Direction"}</b>{message.version && <em>V{message.version}</em>}</div>
                <p>{message.text}</p>
                {message.changes?.length ? <div className="change-chips">{message.changes.map((change) => <span key={change}>{change}</span>)}</div> : null}
              </article>)}
              {planning && <article className="studio-message assistant thinking"><div className="message-author"><span>SS</span><b>SoundSeed</b><em>EDITING</em></div><p><i /><i /><i /> Listening across rhythm, pitch and texture…</p></article>}
              <div ref={chatEndRef} />
            </div>
            <div className="prompt-starters"><span>TRY SAYING</span>{(currentPlan ? ["Make it feel more alive", "It still feels too repetitive", "I like the melody, but the background feels wrong", "Make the ending really land"] : ["Something moody I could listen to at night", "Make this feel playful and catchy", "I want it to slowly become exciting", "Turn this into something warm and emotional"]).map((prompt) => <button type="button" key={prompt} onClick={() => setBrief(prompt)}>{prompt}</button>)}</div>
            <form className={`studio-composer ${dictating ? "is-listening" : ""}`} onSubmit={(event) => { event.preventDefault(); generateArrangement(); }}>
              <div className="composer-label"><span>{currentPlan ? "DIRECT THE NEXT VERSION" : "DESCRIBE THE FIRST VERSION"}</span><small>{brief.length}/700</small></div>
              <textarea value={brief} onChange={(event) => setBrief(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); generateArrangement(); } }} maxLength={700} aria-label="Message the SoundSeed director" placeholder={currentPlan ? "Just say what feels wrong or what you want to feel next…" : "Describe a mood, a scene, or how you want this sound to make you feel…"} />
              <div className="composer-actions"><button type="button" className={`dictate-button ${dictating ? "active" : ""}`} onClick={toggleDictation}><span className="mic-icon" />{dictating ? "Listening…" : "Speak"}</button><span>ENTER TO SEND · SHIFT+ENTER FOR A LINE</span><button className="send-direction" type="submit" disabled={planning || brief.trim().length < 4}>{planning ? "Directing…" : currentPlan ? "Apply edit" : "Create version"}<b>→</b></button></div>
            </form>
            {planError && <p className="plan-error studio-error" role="alert">{planError}</p>}
          </section>

          <section className="studio-preview" aria-label="Current arrangement">
            <div className="preview-top"><div><span>LIVE ARRANGEMENT</span><small>SONG BUILT FROM HIT {String(selectedHit + 1).padStart(2, "0")}</small></div><div><button type="button" onClick={() => undoArrangement()} disabled={!planHistory.length || planning}>↶ Undo</button><button className="preview-play" type="button" onClick={playing ? stop : start}>{playing ? "Ⅱ Pause" : "▶ Preview"}</button></div></div>
            <div className="preview-identity"><span>{version ? `V${version}` : "V0"}</span><div><small>CURRENT DIRECTION</small><h3>{styleName}</h3><p>{currentPlan ? currentPlan.explanation : "Your first direction will turn this isolated impact into a complete playable arrangement."}</p><div className="music-decisions"><b>{musicalMode} harmony</b><b>{arrangementShape.replace("_", " ")} shape</b><b>{literalSeedActive ? `${Math.round(seedPresence * 100)}% literal seed` : "No literal seed loop"}</b></div></div></div>
            <div className="plan-readout"><div><small>BARS</small><strong>{loopBars}</strong></div><div><small>LITERAL HITS / ACTIVE BAR</small><strong>{literalSeedActive ? seedRepetitions : 0}</strong></div><div><small>TEMPO</small><strong>{tempo}</strong><span>BPM</span></div><div><small>LAYERS</small><strong>{layers.filter((layer) => !layer.removed).length}</strong></div></div>
            <div className="arrangement-bars"><div><small>ARRANGEMENT LENGTH</small><span>{loopBars} BARS · {Math.round((60 / tempo) * 4 * loopBars)} SEC</span></div><div>{Array.from({ length: loopBars }, (_, index) => { const section = currentPlan?.sections.find((item) => index + 1 >= item.start_bar && index + 1 <= item.end_bar); return <i key={index} className={playing && Math.floor(step / 16) === index ? "active" : ""} title={section?.name}><b>{index + 1}</b><small>{index + 1 === section?.start_bar ? section.name : ""}</small></i>; })}</div></div>
            <div className="project-timeline"><div className="timeline-heading"><span>AI NOTE-EVENT TIMELINE</span><small>{layers.filter((layer) => layer.events?.length && !layer.removed).reduce((total, layer) => total + layer.events!.reduce((count, event) => count + event.bars.length, 0), 0)} AUTHORED EVENTS</small></div><div className="timeline-scale" style={{ gridTemplateColumns: `110px repeat(${loopBars}, minmax(18px, 1fr))` }}><b>TRACK</b>{Array.from({ length: loopBars }, (_, bar) => <i key={bar}>{bar + 1}</i>)}</div>{layers.filter((layer) => !layer.removed).map((layer) => <div className="timeline-row" key={`timeline-${layer.id}`} style={{ gridTemplateColumns: `110px repeat(${loopBars}, minmax(18px, 1fr))` }}><span><b>{layer.name}</b><small>{layer.voice ? `${layer.voice.pitch_pattern.map((value) => `${value >= 0 ? "+" : ""}${value}`).join("/")} ST · ${layer.voice.speed.toFixed(2)}×` : layer.kind === "foundation" ? "LITERAL ACCENT" : layer.kind === "bass" || layer.kind === "synth" ? "AI-COMPOSED NOTES" : "AI-COMPOSED RHYTHM"}</small></span>{Array.from({ length: loopBars }, (_, bar) => <TimelineEventCell key={bar} layer={layer} bar={bar} active={layerActiveAtBar(layer, bar, loopBars, arrangementShape)} playing={playing && Math.floor(step / 16) === bar} />)}</div>)}</div>
            <div className="sound-design-readout"><div className="style-result"><small>INTERPRETED FEEL</small><strong>{groove}</strong></div><div><small>KICK DEPTH</small><span><i style={{ width: `${soundDesign.kick_depth * 100}%` }} /></span><b>{Math.round(soundDesign.kick_depth * 100)}</b></div><div><small>BRIGHTNESS</small><span><i style={{ width: `${soundDesign.brightness * 100}%` }} /></span><b>{Math.round(soundDesign.brightness * 100)}</b></div><div><small>SWING</small><span><i style={{ width: `${(soundDesign.swing / 0.35) * 100}%` }} /></span><b>{Math.round(soundDesign.swing * 100)}</b></div><div><small>SPACE</small><span><i style={{ width: `${soundDesign.space * 100}%` }} /></span><b>{Math.round(soundDesign.space * 100)}</b></div></div>
            <div className="render-review"><span>RENDERED-AUDIO CHECK</span>{audioReview ? <><strong>{audioReview.score}<small>/100</small></strong><div><b>PEAK {Math.round(audioReview.peak * 100)}%</b><b>LOW {Math.round(audioReview.lowEnergy * 100)}%</b><b>REPETITION {Math.round(audioReview.repetition * 100)}%</b><b>DYNAMICS {Math.round(audioReview.dynamicRange * 100)}%</b></div><p>{audioReview.issues.length ? audioReview.issues.join(" ") : "The rendered mix passed balance, loudness, variation and clipping checks."}</p></> : <p>SoundSeed will render the complete song, measure it, and request one repair pass when it detects a problem.</p>}</div>
            <div className="preview-layers"><span>NOW IN THE MIX · ONE SEED, DISTINCT TIMBRES</span><div>{layers.filter((layer) => !layer.removed).map((layer) => <button type="button" key={layer.id} className={`${solo === layer.id ? "active" : ""} source-${layer.source}`} onClick={() => setSolo((value) => value === layer.id ? null : layer.id)}><i style={{ background: layer.color }} />{layer.name}<small>{layer.kind === "foundation" ? "LITERAL" : layer.voice?.character === "hook" ? "PITCHED HOOK" : "RESHAPED"}</small></button>)}</div><p>{literalSeedActive ? "The exact hit appears only in the highlighted timeline bars. Every other layer inherits the seed’s sonic DNA through pitch, speed, envelopes and resynthesis." : "The exact hit is not looping. Every audible layer still comes from its tonal body or transient, reshaped through pitch, speed, envelopes and resynthesis."} Click a layer to hear the distinction.</p></div>
            <div className="model-note"><span>AI DIRECTOR</span><p>You describe the outcome. AI chooses pitch contours, speed, repetition, new seed voices and where they enter across the timeline.</p><b>OPENAI · GPT-5.6 SOL</b></div>
          </section>
        </div>
        <div className="groove-picker">{(["straight", "pocket", "sparse"] as Groove[]).map((option) => <button key={option} className={groove === option ? "active" : ""} onClick={() => selectGroove(option)}><span>{option === "straight" ? "● · · · ● · · ·" : option === "pocket" ? "● · · ● · · · ●" : "● · · · · · · ·"}</span><b>{option}</b><small>{option === "straight" ? "Even & steady" : option === "pocket" ? "Human & syncopated" : "Open & minimal"}</small></button>)}</div>
        <div className="rack-heading"><div><span>INSTRUMENT RACK</span><strong>Build from the captured seed.</strong></div><div className="synth-shape"><span>SEED INSTRUMENT SHAPE</span>{(["pluck", "pad", "arp"] as SynthShape[]).map((shape) => <button key={shape} className={synthShape === shape ? "active" : ""} onClick={() => selectSynthShape(shape)}>{shape}</button>)}</div></div>
        <div className="instrument-rack">{INSTRUMENTS.map((instrument) => { const added = layers.some((layer) => layer.id === instrument.id && !layer.removed); const source = sourceFor(); return <article key={instrument.id} className={added ? "added" : ""}><span className="instrument-number">{instrument.number}</span><span className={`rack-source source-${source}`}>SEED → NEW TIMBRE</span><div className={`instrument-icon icon-${instrument.id}`}><i /><i /><i /><i /></div><small>{instrument.role}</small><strong>{instrument.id === "synth" ? `${synthShape} synth` : instrument.name}</strong><p>{derivationFor(instrument.id, synthShape)}</p><code>{displayPattern(instrument.id).length ? displayPattern(instrument.id).map((beat) => beat + 1).join(" · ") : "AI left this layer empty"}</code><button onClick={() => addInstrument(instrument.id)}>{added ? "Rebuild layer" : "+ Add to loop"}</button></article>; })}</div>
      </section>

      <section className="loop-console">
        <div className="console-top"><div><p className="kicker"><span>05</span> ONE-SEED ARRANGEMENT</p><h2>One source.<br />Many instruments.</h2></div><div className="transport"><button className="transport-main" onClick={playing ? stop : start}>{playing ? "Ⅱ" : "▶"}</button><div><strong>{tempo} BPM</strong><span>{groove.toUpperCase()} · {loopBars} BARS · {literalSeedActive ? `${seedRepetitions} LITERAL HITS` : "RESHAPED SEED ONLY"}</span></div></div><button className="export-loop" onClick={exportLoop} disabled={exporting}>{exporting ? "Rendering…" : "Export loop · WAV"}<span>↓</span></button></div>
        <div className="beat-ruler"><span>TRACK / DERIVATION</span>{Array.from({ length: 16 }, (_, index) => <b key={index}>{index + 1}</b>)}</div>
        <div className="beat-tracks">{layers.map((layer) => <div className={`beat-track ${layer.muted ? "muted" : ""} ${layer.removed ? "removed" : ""} ${audition === layer.id ? "auditioning" : ""}`} key={layer.id}><div className="beat-track-info"><i style={{ background: layer.color }} /><div><span>{layer.kind === "foundation" ? "LITERAL SEED" : layer.voice?.character === "hook" ? "PITCHED SEED HOOK" : "SEED-RESYNTHESIZED"}</span><strong>{layer.name}</strong><small>{layer.derivation}</small></div><div className="mini-controls"><button className={layer.muted ? "active" : ""} onClick={() => muteLayer(layer.id)}>M</button><button className={solo === layer.id ? "active" : ""} onClick={() => setSolo((value) => value === layer.id ? null : layer.id)}>S</button><button className={layer.removed ? "active" : ""} onClick={() => removeLayer(layer.id)}>{layer.removed ? "↶" : "×"}</button></div></div><div className="beat-lane">{Array.from({ length: 16 }, (_, beat) => <i key={beat} className={`${layer.pattern.includes(beat) ? "hit" : ""} ${playing && step % 16 === beat ? "playing" : ""}`} style={layer.pattern.includes(beat) ? { background: layer.color } : undefined} />)}</div></div>)}</div>
        <div className="signal-chain"><span>RAW RECORDING</span><i>→</i><span>ISOLATED SEED {String(selectedHit + 1).padStart(2, "0")}</span><i>→</i><span>TRANSIENT + TONAL BODY</span><i>→</i><span>{layers.filter((layer) => !layer.removed).length} DISTINCT TIMBRES</span><i>→</i><span>{loopBars}-BAR ARRANGEMENT</span><b>ONE-SEED MIX</b></div>
      </section>
    </section> : null}
    <footer><span>SoundSeed</span><p>One captured sound becomes every instrument. The literal hit appears only when the song needs it.</p><small>SEED-FIRST MUSIC LAB · WEB AUDIO POC</small></footer>
  </main>;
}
