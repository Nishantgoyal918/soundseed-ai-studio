"use client";

import { ChangeEvent, DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type Hit = { time: number; strength: number; waveform: number[] };
type SoundDNA = {
  waveform: number[];
  hits: Hit[];
  pitchHz: number;
  note: string;
  brightness: string;
  decay: number;
  bpm: number;
};
type InstrumentId = "foundation" | "kick" | "clap" | "hat" | "bass" | "synth";
type Groove = "straight" | "pocket" | "sparse";
type SynthShape = "pluck" | "pad" | "arp";
type Layer = {
  id: InstrumentId;
  name: string;
  role: string;
  derivation: string;
  color: string;
  pattern: number[];
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

const INSTRUMENTS: Array<{ id: Exclude<InstrumentId, "foundation">; number: string; name: string; role: string; derivation: string }> = [
  { id: "kick", number: "01", name: "Kick", role: "Low-end pulse", derivation: "Seed slowed to 22% · low frequencies retained" },
  { id: "clap", number: "02", name: "Clap", role: "Backbeat accent", derivation: "Seed doubled · mid-band attack stacked twice" },
  { id: "hat", number: "03", name: "Hi-hat", role: "Top-line motion", derivation: "Seed sped up 2.7× · high frequencies isolated" },
  { id: "bass", number: "04", name: "Bass", role: "Tuned foundation", derivation: "Seed pitched down · mapped to detected key" },
  { id: "synth", number: "05", name: "Seed synth", role: "Harmonic texture", derivation: "The isolated hit micro-looped into a playable tone" },
];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
const rateFromSemitones = (semitones: number) => Math.pow(2, semitones / 12);

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
  const length = Math.min(4200, Math.floor((data.length - peakIndex) / stride));
  const sample = new Float32Array(Math.max(128, length));
  for (let index = 0; index < sample.length; index += 1) sample[index] = data[peakIndex + index * stride] || 0;
  const rate = sampleRate / stride;
  let bestLag = 0;
  let best = 0;
  for (let lag = Math.floor(rate / 1000); lag < Math.min(Math.floor(rate / 55), sample.length - 1); lag += 1) {
    let correlation = 0;
    let energyA = 0;
    let energyB = 0;
    for (let index = 0; index < sample.length - lag; index += 1) {
      correlation += sample[index] * sample[index + lag];
      energyA += sample[index] ** 2;
      energyB += sample[index + lag] ** 2;
    }
    const normalized = correlation / Math.sqrt(Math.max(0.000001, energyA * energyB));
    if (normalized > best) { best = normalized; bestLag = lag; }
  }
  const frequency = bestLag && best > 0.08 ? rate / bestLag : 220;
  return clamp(frequency, 55, 1200);
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
  const pitchHz = detectPitch(data, sampleRate);
  const midi = Math.round(69 + 12 * Math.log2(pitchHz / 440));
  const intervals = hits.slice(1).map((hit, index) => hit.time - hits[index].time).sort((a, b) => a - b);
  let bpm = intervals.length ? 60 / intervals[Math.floor(intervals.length / 2)] : 100;
  while (bpm < 72) bpm *= 2;
  while (bpm > 132) bpm /= 2;
  return {
    waveform: waveformOf(data),
    hits,
    pitchHz,
    note: NOTES[((midi % 12) + 12) % 12],
    brightness: crossings / data.length > 0.1 ? "bright transient" : "rounded transient",
    decay: 0.32,
    bpm: Math.round(clamp(bpm, 72, 132)),
  };
}

function extractHit(context: BaseAudioContext, source: AudioBuffer, time: number) {
  const start = Math.max(0, Math.floor((time - 0.014) * source.sampleRate));
  const duration = Math.min(Math.floor(source.sampleRate * 0.5), source.length - start);
  const output = context.createBuffer(source.numberOfChannels, Math.max(1, duration), source.sampleRate);
  for (let channel = 0; channel < source.numberOfChannels; channel += 1) output.copyToChannel(source.getChannelData(channel).slice(start, start + duration), channel);
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

function Wave({ values, color, active = false }: { values: number[]; color: string; active?: boolean }) {
  return <div className={`waveform ${active ? "waveform--active" : ""}`}>{values.map((value, index) => <i key={index} style={{ height: `${Math.max(7, value * 92)}%`, background: color, animationDelay: `${-index * 0.018}s` }} />)}</div>;
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

export function BeatFoundry() {
  const [dna, setDna] = useState<SoundDNA | null>(null);
  const [sourceName, setSourceName] = useState("");
  const [duration, setDuration] = useState(0);
  const [selectedHit, setSelectedHit] = useState(0);
  const [pitch, setPitch] = useState(0);
  const [groove, setGroove] = useState<Groove>("pocket");
  const [synthShape, setSynthShape] = useState<SynthShape>("pluck");
  const [layers, setLayers] = useState<Layer[]>([]);
  const [solo, setSolo] = useState<InstrumentId | null>(null);
  const [audition, setAudition] = useState<InstrumentId | null>(null);
  const [playing, setPlaying] = useState(false);
  const [step, setStep] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [recordTime, setRecordTime] = useState(0);
  const [analyzing, setAnalyzing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [decision, setDecision] = useState("The seed is ready. Choose an instrument and I’ll derive it from this exact hit.");

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
  const layersRef = useRef<Layer[]>([]);
  const pitchRef = useRef(0);
  const grooveRef = useRef<Groove>("pocket");
  const synthRef = useRef<SynthShape>("pluck");
  const soloRef = useRef<InstrumentId | null>(null);
  const auditionRef = useRef<InstrumentId | null>(null);
  const bpmRef = useRef(100);

  useEffect(() => { layersRef.current = layers; }, [layers]);
  useEffect(() => { pitchRef.current = pitch; }, [pitch]);
  useEffect(() => { grooveRef.current = groove; }, [groove]);
  useEffect(() => { synthRef.current = synthShape; }, [synthShape]);
  useEffect(() => { soloRef.current = solo; }, [solo]);
  useEffect(() => { auditionRef.current = audition; }, [audition]);
  useEffect(() => { bpmRef.current = dna?.bpm ?? 100; }, [dna]);

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
    length: number, filterType: BiquadFilterType = "allpass", filterFrequency = 2000, loop = false,
  ) => {
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    source.buffer = buffer; source.playbackRate.setValueAtTime(rate, when); source.loop = loop;
    filter.type = filterType; filter.frequency.setValueAtTime(filterFrequency, when);
    gain.gain.setValueAtTime(0.0001, when); gain.gain.exponentialRampToValueAtTime(Math.max(0.001, gainAmount), when + Math.min(0.04, length * 0.15));
    gain.gain.exponentialRampToValueAtTime(0.0001, when + length);
    source.connect(filter); filter.connect(gain); gain.connect(destination); source.start(when); source.stop(when + length + 0.03);
    if (ctx instanceof AudioContext) { activeSources.current.add(source); source.onended = () => activeSources.current.delete(source); }
  }, []);

  const scheduleLayer = useCallback((layer: Layer, currentStep: number, when: number, ctx: BaseAudioContext, destination: AudioNode, buffer: AudioBuffer, sixteenth: number) => {
    const pattern = patternFor(layer.id, grooveRef.current, synthRef.current);
    if (!pattern.includes(currentStep % 16)) return;
    const base = rateFromSemitones(pitchRef.current);
    if (layer.id === "foundation") playSample(ctx, destination, buffer, when, base, 0.27, sixteenth * 1.45);
    if (layer.id === "kick") playSample(ctx, destination, buffer, when, base * 0.22, 0.5, sixteenth * 1.8, "lowpass", 250);
    if (layer.id === "clap") {
      playSample(ctx, destination, buffer, when, base * 0.86, 0.25, sixteenth * 0.9, "bandpass", 1250);
      playSample(ctx, destination, buffer, when + 0.018, base * 1.04, 0.14, sixteenth * 0.7, "highpass", 950);
    }
    if (layer.id === "hat") playSample(ctx, destination, buffer, when, base * 2.7, 0.13, sixteenth * 0.56, "highpass", 2800);
    if (layer.id === "bass") {
      const degree = [0, 7, 5, 3][pattern.indexOf(currentStep % 16) % 4];
      playSample(ctx, destination, buffer, when, base * 0.5 * rateFromSemitones(degree), 0.36, sixteenth * 2.8, "lowpass", 520, true);
    }
    if (layer.id === "synth") {
      if (synthRef.current === "pad") {
        [0, 4, 7].forEach((interval) => playSample(ctx, destination, buffer, when, base * rateFromSemitones(interval), 0.075, sixteenth * 7.6, "lowpass", 1500, true));
      } else {
        const scale = synthRef.current === "arp" ? [0, 4, 7, 11, 7, 4] : [0, 2, 7, 4, 9];
        const interval = scale[pattern.indexOf(currentStep % 16) % scale.length];
        playSample(ctx, destination, buffer, when, base * rateFromSemitones(interval), 0.16, sixteenth * (synthRef.current === "arp" ? 1.2 : 1.8), "lowpass", 2400, synthRef.current === "pluck");
      }
    }
  }, [playSample]);

  const start = useCallback(async () => {
    if (!seedBuffer.current) return;
    stop();
    const ctx = await ensureContext();
    const master = ctx.createGain(); const compressor = ctx.createDynamicsCompressor();
    master.gain.value = 0.82; master.connect(compressor); compressor.connect(ctx.destination);
    nextNote.current = ctx.currentTime + 0.05; stepRef.current = 0;
    const tick = () => {
      const sixteenth = (60 / bpmRef.current) / 4;
      while (nextNote.current < ctx.currentTime + 0.12) {
        const current = stepRef.current;
        let audible = layersRef.current.filter((layer) => !layer.muted && !layer.removed);
        const focused = auditionRef.current || soloRef.current;
        if (focused) audible = audible.filter((layer) => layer.id === focused);
        audible.forEach((layer) => scheduleLayer(layer, current, nextNote.current, ctx, master, seedBuffer.current!, sixteenth));
        window.setTimeout(() => setStep(current), Math.max(0, (nextNote.current - ctx.currentTime) * 1000));
        nextNote.current += sixteenth; stepRef.current = (current + 1) % 16;
      }
    };
    tick(); scheduler.current = window.setInterval(tick, 25); setPlaying(true);
  }, [ensureContext, scheduleLayer, stop]);

  const setExtractedHit = useCallback(async (index: number, analysis = dna) => {
    if (!rawBuffer.current || !analysis?.hits[index]) return;
    const ctx = await ensureContext();
    seedBuffer.current = extractHit(ctx, rawBuffer.current, analysis.hits[index].time);
    setSelectedHit(index); setPitch(0);
    setDecision(`Hit ${String(index + 1).padStart(2, "0")} isolated. Silence before the attack and the uneven gap after it are now excluded from every derived instrument.`);
  }, [dna, ensureContext]);

  const loadBuffer = useCallback(async (buffer: AudioBuffer, name: string) => {
    stop(); setAnalyzing(true); setError(""); await sleep(500);
    const result = analyze(buffer);
    const bestIndex = result.hits.reduce((best, hit, index) => hit.strength > result.hits[best].strength ? index : best, 0);
    rawBuffer.current = buffer; setDna(result); setSourceName(name); setDuration(buffer.duration); setSelectedHit(bestIndex); setPitch(0); setGroove("pocket"); setSynthShape("pluck");
    const foundation: Layer = { id: "foundation", name: "The one beat", role: "Foundation loop", derivation: "Cleanest impact · silence removed · original timbre", color: COLORS.foundation, pattern: patternFor("foundation", "pocket", "pluck"), muted: false, removed: false };
    setLayers([foundation]); layersRef.current = [foundation]; setSolo(null); setAudition(null); setAnalyzing(false);
    const ctx = await ensureContext(); seedBuffer.current = extractHit(ctx, buffer, result.hits[bestIndex].time);
    setDecision(`I found ${result.hits.length} separate impact${result.hits.length === 1 ? "" : "s"}. Hit ${String(bestIndex + 1).padStart(2, "0")} has the cleanest attack, so it becomes the single source for the entire rack.`);
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
    playSample(ctx, gain, seedBuffer.current, ctx.currentTime + 0.02, rateFromSemitones(pitch), 0.7, Math.min(0.7, seedBuffer.current.duration / Math.max(0.5, rateFromSemitones(pitch))));
  }, [ensureContext, pitch, playSample]);

  const addInstrument = useCallback(async (id: Exclude<InstrumentId, "foundation">) => {
    const instrument = INSTRUMENTS.find((item) => item.id === id)!;
    const name = id === "synth" ? `${synthShape === "pad" ? "Warm pad" : synthShape === "arp" ? "Seed arp" : "Seed pluck"}` : instrument.name;
    const layer: Layer = { id, name, role: instrument.role, derivation: instrument.derivation, color: COLORS[id], pattern: patternFor(id, groove, synthShape), muted: false, removed: false };
    setLayers((current) => current.some((item) => item.id === id) ? current.map((item) => item.id === id ? layer : item) : [...current, layer]);
    setAudition(id); setDecision(`${name} added. Hear it alone first: every note you hear is the isolated impact replayed at a new rate and filtered for its new role.`);
    if (!playing) await start();
    window.setTimeout(() => { setAudition(null); setDecision(`${name} is now folded into the loop. The ${groove} pattern leaves room around the original beat instead of masking it.`); }, 1450);
  }, [groove, playing, start, synthShape]);

  const removeLayer = useCallback((id: InstrumentId) => setLayers((current) => current.map((layer) => layer.id === id ? { ...layer, removed: !layer.removed } : layer)), []);
  const muteLayer = useCallback((id: InstrumentId) => setLayers((current) => current.map((layer) => layer.id === id ? { ...layer, muted: !layer.muted } : layer)), []);

  const exportLoop = useCallback(async () => {
    if (!seedBuffer.current || !dna) return; setExporting(true);
    try {
      const seconds = (60 / dna.bpm) * 16; const ctx = new OfflineAudioContext(2, Math.ceil(44100 * seconds), 44100); const master = ctx.createGain(); const compressor = ctx.createDynamicsCompressor(); master.gain.value = 0.82; master.connect(compressor); compressor.connect(ctx.destination);
      const sixteenth = (60 / dna.bpm) / 4; const active = layers.filter((layer) => !layer.muted && !layer.removed);
      for (let current = 0; current * sixteenth < seconds - 0.2; current += 1) active.forEach((layer) => scheduleLayer(layer, current % 16, current * sixteenth, ctx, master, seedBuffer.current!, sixteenth));
      const rendered = await ctx.startRendering(); const url = URL.createObjectURL(new Blob([encodeWav(rendered)], { type: "audio/wav" })); const link = document.createElement("a"); link.href = url; link.download = "soundseed-one-beat-loop.wav"; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    } finally { setExporting(false); }
  }, [dna, layers, scheduleLayer]);

  useEffect(() => {
    setLayers((current) => current.map((layer) => ({ ...layer, pattern: patternFor(layer.id, groove, synthShape), name: layer.id === "synth" ? (synthShape === "pad" ? "Warm pad" : synthShape === "arp" ? "Seed arp" : "Seed pluck") : layer.name })));
  }, [groove, synthShape]);

  useEffect(() => () => { stop(); if (recordTicker.current !== null) window.clearInterval(recordTicker.current); mediaStream.current?.getTracks().forEach((track) => track.stop()); contextRef.current?.close(); }, [stop]);

  const pitchedNote = useMemo(() => {
    if (!dna) return "—"; const midi = Math.round(69 + 12 * Math.log2(dna.pitchHz / 440)) + pitch; return NOTES[((midi % 12) + 12) % 12];
  }, [dna, pitch]);
  const pitchedWave = useMemo(() => {
    const values = dna?.hits[selectedHit]?.waveform ?? []; const rate = rateFromSemitones(pitch);
    return values.map((_, index) => values[Math.floor(index * rate) % Math.max(1, values.length)] ?? 0);
  }, [dna, pitch, selectedHit]);

  return <main className="app-shell beat-app">
    <header className="topbar">
      <button className="brand" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}><span className="brand-mark"><i /><i /><i /></span><span>SoundSeed</span><small>ONE BEAT LAB</small></button>
      <div className="topbar-center"><span className="status-dot" /><span>{dna ? "SEED ISOLATED" : "LISTENING ROOM READY"}</span></div>
      <span className="topbar-mode">SOURCE → INSTRUMENT → LOOP</span>
    </header>

    {!dna && !analyzing ? <section className="landing beat-landing">
      <div className="hero-copy">
        <p className="kicker"><span>01</span> RECORD IT MESSY. KEEP ONE PERFECT HIT.</p>
        <h1>Find the one<br />beat inside<br /><em>the noise.</em></h1>
        <p className="hero-subtitle">Tap a pen on a bottle two or three times—badly timed is fine. We isolate one clean impact, then build every drum, bass and synth from that single sonic seed.</p>
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

      <section className="pitch-lab">
        <div className="pitch-copy"><p className="kicker"><span>03</span> PITCH THE SEED</p><h2>Same fingerprint.<br /><em>Different note.</em></h2><p>Pitch changes playback speed, so the transformation is audible and visible—not hidden behind a preset.</p></div>
        <div className="pitch-console">
          <div className="note-readout"><div><small>ORIGINAL</small><strong>{dna.note}</strong><span>{Math.round(dna.pitchHz)} Hz</span></div><i>→</i><div className="pitched"><small>NOW PLAYING</small><strong>{pitchedNote}</strong><span>{pitch > 0 ? "+" : ""}{pitch} semitones</span></div></div>
          <div className="pitch-wave"><Wave values={pitchedWave} color="#9adf64" /><span style={{ left: `${((pitch + 12) / 24) * 100}%` }} /></div>
          <div className="pitch-slider"><button onClick={() => setPitch((value) => Math.max(-12, value - 1))}>−</button><input type="range" min="-12" max="12" step="1" value={pitch} onChange={(event) => setPitch(Number(event.target.value))} aria-label="Seed pitch in semitones" style={{ "--pitch-position": `${((pitch + 12) / 24) * 100}%` } as React.CSSProperties} /><button onClick={() => setPitch((value) => Math.min(12, value + 1))}>+</button></div>
          <div className="pitch-actions"><button onClick={previewSeed}>▶ Hear this pitch</button><button onClick={() => setPitch(0)}>Reset to {dna.note}</button></div>
        </div>
      </section>

      <section className="loop-lab">
        <div className="loop-heading"><div><p className="kicker"><span>04</span> TEACH IT A GROOVE</p><h2>Pick the feel.<br />We place the beat.</h2></div><p>The AI pattern uses your isolated hit as the anchor, then places every requested instrument around it.</p></div>
        <div className="groove-picker">{(["straight", "pocket", "sparse"] as Groove[]).map((option) => <button key={option} className={groove === option ? "active" : ""} onClick={() => { setGroove(option); setDecision(`${option[0].toUpperCase() + option.slice(1)} groove selected. I recalculated every loop position while keeping the same isolated hit underneath.`); }}><span>{option === "straight" ? "● · · · ● · · ·" : option === "pocket" ? "● · · ● · · · ●" : "● · · · · · · ·"}</span><b>{option}</b><small>{option === "straight" ? "Even & steady" : option === "pocket" ? "Human & syncopated" : "Open & minimal"}</small></button>)}</div>
        <div className="rack-heading"><div><span>INSTRUMENT RACK</span><strong>What should this one beat become?</strong></div><div className="synth-shape"><span>SYNTH SHAPE</span>{(["pluck", "pad", "arp"] as SynthShape[]).map((shape) => <button key={shape} className={synthShape === shape ? "active" : ""} onClick={() => setSynthShape(shape)}>{shape}</button>)}</div></div>
        <div className="instrument-rack">{INSTRUMENTS.map((instrument) => { const added = layers.some((layer) => layer.id === instrument.id && !layer.removed); return <article key={instrument.id} className={added ? "added" : ""}><span className="instrument-number">{instrument.number}</span><div className={`instrument-icon icon-${instrument.id}`}><i /><i /><i /><i /></div><small>{instrument.role}</small><strong>{instrument.id === "synth" ? `${synthShape} synth` : instrument.name}</strong><p>{instrument.derivation}</p><code>{patternFor(instrument.id, groove, synthShape).map((beat) => beat + 1).join(" · ")}</code><button onClick={() => addInstrument(instrument.id)}>{added ? "Rebuild layer" : "+ Add to loop"}</button></article>; })}</div>
      </section>

      <section className="loop-console">
        <div className="console-top"><div><p className="kicker"><span>05</span> ONE-SEED ARRANGEMENT</p><h2>Everything points<br />back to this hit.</h2></div><div className="transport"><button className="transport-main" onClick={playing ? stop : start}>{playing ? "Ⅱ" : "▶"}</button><div><strong>{dna.bpm} BPM</strong><span>{groove.toUpperCase()} · 4/4 LOOP</span></div></div><button className="export-loop" onClick={exportLoop} disabled={exporting}>{exporting ? "Rendering…" : "Export loop · WAV"}<span>↓</span></button></div>
        <div className="beat-ruler"><span>TRACK / DERIVATION</span>{Array.from({ length: 16 }, (_, index) => <b key={index}>{index + 1}</b>)}</div>
        <div className="beat-tracks">{layers.map((layer) => <div className={`beat-track ${layer.muted ? "muted" : ""} ${layer.removed ? "removed" : ""} ${audition === layer.id ? "auditioning" : ""}`} key={layer.id}><div className="beat-track-info"><i style={{ background: layer.color }} /><div><span>{layer.id === "foundation" ? "SOURCE" : "DERIVED"}</span><strong>{layer.name}</strong><small>{layer.derivation}</small></div><div className="mini-controls"><button className={layer.muted ? "active" : ""} onClick={() => muteLayer(layer.id)}>M</button><button className={solo === layer.id ? "active" : ""} onClick={() => setSolo((value) => value === layer.id ? null : layer.id)}>S</button>{layer.id !== "foundation" && <button className={layer.removed ? "active" : ""} onClick={() => removeLayer(layer.id)}>{layer.removed ? "↶" : "×"}</button>}</div></div><div className="beat-lane">{Array.from({ length: 16 }, (_, beat) => <i key={beat} className={`${patternFor(layer.id, groove, synthShape).includes(beat) ? "hit" : ""} ${playing && step === beat ? "playing" : ""}`} style={patternFor(layer.id, groove, synthShape).includes(beat) ? { background: layer.color } : undefined} />)}</div></div>)}</div>
        <div className="signal-chain"><span>RAW RECORDING</span><i>→</i><span>ISOLATED HIT {String(selectedHit + 1).padStart(2, "0")}</span><i>→</i><span>{pitch > 0 ? "+" : ""}{pitch} ST</span><i>→</i><span>{layers.filter((layer) => !layer.removed).length} LOOP LAYERS</span><b>100% ONE SOURCE</b></div>
      </section>
    </section> : null}
    <footer><span>SoundSeed</span><p>One captured beat. Every instrument derived from it.</p><small>ONE BEAT LAB · WEB AUDIO POC</small></footer>
  </main>;
}
