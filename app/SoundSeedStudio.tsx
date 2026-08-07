"use client";

import {
  ChangeEvent,
  DragEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type SoundDNA = {
  pitchHz: number;
  note: string;
  key: string;
  brightness: string;
  brightnessScore: number;
  decay: string;
  decaySeconds: number;
  bpm: number;
  hits: number;
  confidence: number;
  waveform: number[];
};

type LayerKind = "seed" | "bass" | "rhythm" | "pad" | "melody";

type TrackLayer = {
  id: string;
  number: number;
  name: string;
  role: string;
  derivation: string;
  narration: string;
  color: string;
  kind: LayerKind;
  pattern: number[];
  variant?: StyleChoice;
  muted: boolean;
  removed: boolean;
};

type StyleChoice = "lofi" | "house" | "jazz";
type BuildState = "idle" | "building" | "branch" | "complete";

const NOTES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const LAYER_COLORS = ["#ffb44a", "#9adf64", "#ff766f", "#a99bf7", "#5ed3c5"];

const STYLE_OPTIONS: Array<{
  id: StyleChoice;
  eyebrow: string;
  title: string;
  description: string;
  pattern: string;
}> = [
  {
    id: "lofi",
    eyebrow: "Loose · 86–102 BPM",
    title: "Lo-fi pocket",
    description: "Dusty backbeat, softened transients and a little swing.",
    pattern: "● · · ◌  · · ● ·  ● · · ◌  · · ● ·",
  },
  {
    id: "house",
    eyebrow: "Driving · 112–126 BPM",
    title: "After-hours house",
    description: "Four grounded pulses with bright sample chops off-beat.",
    pattern: "● · ◌ ·  ● · ◌ ·  ● · ◌ ·  ● · ◌ ·",
  },
  {
    id: "jazz",
    eyebrow: "Human · 78–108 BPM",
    title: "Brush & sway",
    description: "A sparse, conversational groove that leaves air around the seed.",
    pattern: "● · · ·  · ◌ · ·  · ● · ·  · · ◌ ·",
  },
];

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function midiToFrequency(midi: number) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function noteToMidi(note: string, octave = 4) {
  const index = Math.max(0, NOTES.indexOf(note));
  return 12 * (octave + 1) + index;
}

function formatTime(seconds: number) {
  const safe = Math.max(0, seconds);
  return `${Math.floor(safe / 60)}:${Math.floor(safe % 60).toString().padStart(2, "0")}`;
}

function getWaveform(data: Float32Array, bars = 84) {
  const waveform: number[] = [];
  const block = Math.max(1, Math.floor(data.length / bars));
  for (let i = 0; i < bars; i += 1) {
    let peak = 0;
    const start = i * block;
    const end = Math.min(data.length, start + block);
    for (let j = start; j < end; j += 1) peak = Math.max(peak, Math.abs(data[j]));
    waveform.push(peak);
  }
  const max = Math.max(...waveform, 0.001);
  return waveform.map((value) => clamp(value / max, 0.08, 1));
}

function analyzeBuffer(buffer: AudioBuffer): SoundDNA {
  const channel = buffer.getChannelData(0);
  const waveform = getWaveform(channel);
  const sampleRate = buffer.sampleRate;

  let peak = 0;
  let peakIndex = 0;
  let crossings = 0;
  let rmsTotal = 0;
  for (let i = 1; i < channel.length; i += 1) {
    const value = Math.abs(channel[i]);
    rmsTotal += channel[i] * channel[i];
    if (value > peak) {
      peak = value;
      peakIndex = i;
    }
    if ((channel[i - 1] < 0 && channel[i] >= 0) || (channel[i - 1] >= 0 && channel[i] < 0)) crossings += 1;
  }
  const rms = Math.sqrt(rmsTotal / Math.max(1, channel.length));
  const zeroCrossing = crossings / Math.max(1, channel.length);

  const targetRate = 11025;
  const stride = Math.max(1, Math.floor(sampleRate / targetRate));
  const startAt = Math.max(0, peakIndex - Math.floor(sampleRate * 0.035));
  const sampleLength = Math.min(5000, Math.floor((channel.length - startAt) / stride));
  const sample = new Float32Array(Math.max(128, sampleLength));
  for (let i = 0; i < sample.length; i += 1) sample[i] = channel[startAt + i * stride] || 0;
  const effectiveRate = sampleRate / stride;
  let bestLag = 0;
  let bestCorrelation = 0;
  const minLag = Math.floor(effectiveRate / 1000);
  const maxLag = Math.min(Math.floor(effectiveRate / 60), sample.length - 2);
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let sum = 0;
    let energyA = 0;
    let energyB = 0;
    for (let i = 0; i < sample.length - lag; i += 1) {
      sum += sample[i] * sample[i + lag];
      energyA += sample[i] * sample[i];
      energyB += sample[i + lag] * sample[i + lag];
    }
    const correlation = sum / Math.sqrt(Math.max(0.000001, energyA * energyB));
    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestLag = lag;
    }
  }

  let pitchHz = bestLag ? effectiveRate / bestLag : 220;
  if (!Number.isFinite(pitchHz) || pitchHz < 55 || pitchHz > 1200 || bestCorrelation < 0.08) pitchHz = 220;
  const midi = Math.round(69 + 12 * Math.log2(pitchHz / 440));
  const note = NOTES[((midi % 12) + 12) % 12];

  let decayIndex = channel.length - 1;
  const decayThreshold = Math.max(rms * 0.55, peak * 0.12);
  const hold = Math.max(20, Math.floor(sampleRate * 0.025));
  for (let i = peakIndex; i < channel.length - hold; i += hold) {
    let localPeak = 0;
    for (let j = i; j < i + hold; j += 1) localPeak = Math.max(localPeak, Math.abs(channel[j]));
    if (localPeak < decayThreshold) {
      decayIndex = i;
      break;
    }
  }
  const decaySeconds = clamp((decayIndex - peakIndex) / sampleRate, 0.04, Math.min(4, buffer.duration));

  const frameSize = Math.max(128, Math.floor(sampleRate * 0.025));
  const envelope: number[] = [];
  for (let i = 0; i < channel.length; i += frameSize) {
    let framePeak = 0;
    for (let j = i; j < Math.min(channel.length, i + frameSize); j += 1) framePeak = Math.max(framePeak, Math.abs(channel[j]));
    envelope.push(framePeak);
  }
  const threshold = Math.max(rms * 2.2, peak * 0.28);
  const hitFrames: number[] = [];
  for (let i = 1; i < envelope.length - 1; i += 1) {
    if (envelope[i] > threshold && envelope[i] > envelope[i - 1] && envelope[i] >= envelope[i + 1]) {
      const last = hitFrames[hitFrames.length - 1];
      if (last === undefined || (i - last) * frameSize / sampleRate > 0.16) hitFrames.push(i);
    }
  }
  const intervals = hitFrames.slice(1).map((value, index) => (value - hitFrames[index]) * frameSize / sampleRate);
  intervals.sort((a, b) => a - b);
  let bpm = intervals.length ? 60 / intervals[Math.floor(intervals.length / 2)] : 96 + Math.round(zeroCrossing * 110);
  while (bpm < 72) bpm *= 2;
  while (bpm > 138) bpm /= 2;
  bpm = Math.round(clamp(bpm, 72, 132));

  const brightnessScore = clamp(zeroCrossing * 8.5, 0, 1);
  const brightness = brightnessScore > 0.57 ? "glassy & bright" : brightnessScore > 0.28 ? "warm & clear" : "dark & rounded";
  const decay = decaySeconds < 0.24 ? "short snap" : decaySeconds < 0.85 ? "gentle ring" : "long bloom";
  const mode = brightnessScore > 0.34 ? "major" : "minor";

  return {
    pitchHz: Math.round(pitchHz * 10) / 10,
    note,
    key: `${note} ${mode}`,
    brightness,
    brightnessScore,
    decay,
    decaySeconds,
    bpm,
    hits: Math.max(1, hitFrames.length),
    confidence: Math.round(clamp(bestCorrelation, 0.41, 0.98) * 100),
    waveform,
  };
}

function makeLayers(dna: SoundDNA, style: StyleChoice | null): TrackLayer[] {
  const chosen = style ?? "lofi";
  const rhythmName = chosen === "house" ? "Night-floor drums" : chosen === "jazz" ? "Brush conversation" : "Pocket drums";
  const rhythmRole = chosen === "house" ? "Four-on-the-floor" : chosen === "jazz" ? "Loose syncopation" : "Swinging backbeat";
  const rhythmPattern = chosen === "house" ? [0, 2, 4, 6, 8, 10, 12, 14] : chosen === "jazz" ? [0, 5, 9, 14] : [0, 3, 6, 8, 11, 14];
  return [
    {
      id: "seed-pulse",
      number: 1,
      name: "Seed pulse",
      role: "The recognizable anchor",
      derivation: "Original transient · untouched pitch",
      narration: `First, I’m trimming the clearest hit and placing it on the quarter notes. No disguise yet—this keeps your ${dna.note} seed easy to recognize.`,
      color: LAYER_COLORS[0],
      kind: "seed",
      pattern: [0, 4, 8, 12],
      muted: false,
      removed: false,
    },
    {
      id: "sub-bloom",
      number: 2,
      name: "Sub bloom",
      role: "Weight below the seed",
      derivation: "Same sample · pitched down 2 octaves",
      narration: `Your sound centers near ${dna.note}. I’m slowing the same recording to ¼ speed, turning its body into a bass note without introducing a foreign timbre.`,
      color: LAYER_COLORS[1],
      kind: "bass",
      pattern: [0, 8],
      muted: false,
      removed: false,
    },
    {
      id: "rhythm-choice",
      number: 3,
      name: rhythmName,
      role: rhythmRole,
      derivation: `Sample attack · sliced & re-shaped · ${chosen}`,
      narration: chosen === "house"
        ? `You chose momentum. I’m compressing the sample’s attack into four low pulses, then pitching bright fragments upward for the off-beats.`
        : chosen === "jazz"
          ? `You chose conversation. I’m using uneven slices and soft velocities so the rhythm answers the seed instead of marching underneath it.`
          : `You chose pocket. I’m softening the sample’s edges, nudging a few hits late, and leaving tiny gaps so the groove can breathe.`,
      color: LAYER_COLORS[2],
      kind: "rhythm",
      variant: chosen,
      pattern: rhythmPattern,
      muted: false,
      removed: false,
    },
    {
      id: "harmonic-haze",
      number: 4,
      name: "Harmonic haze",
      role: `${dna.key} chord bed`,
      derivation: `New synth · tuned around detected ${dna.note}`,
      narration: `Now I can add something new. A soft triad establishes ${dna.key}; its rounded tone stays out of the way of your ${dna.brightness} source.`,
      color: LAYER_COLORS[3],
      kind: "pad",
      pattern: [0, 8],
      muted: false,
      removed: false,
    },
    {
      id: "seed-sparkle",
      number: 5,
      name: "Seed sparkle",
      role: "A melody made from the source",
      derivation: "Original sample · scale-mapped across 5 pitches",
      narration: `Last move: your original sound becomes the lead. I’m replaying it at five pitch ratios inside ${dna.key}, so the final melody still carries the same fingerprint.`,
      color: LAYER_COLORS[4],
      kind: "melody",
      pattern: [0, 3, 6, 8, 11, 14],
      muted: false,
      removed: false,
    },
  ];
}

function Waveform({
  values,
  color,
  active = false,
  label,
}: {
  values: number[];
  color: string;
  active?: boolean;
  label: string;
}) {
  return (
    <div className={`waveform ${active ? "waveform--active" : ""}`} aria-label={label} role="img">
      {values.map((value, index) => (
        <span
          key={index}
          style={{
            height: `${Math.max(9, value * 92)}%`,
            backgroundColor: color,
            animationDelay: `${(index % 13) * -0.07}s`,
          }}
        />
      ))}
    </div>
  );
}

function encodeWav(buffer: AudioBuffer) {
  const channels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const output = new ArrayBuffer(44 + buffer.length * blockAlign);
  const view = new DataView(output);
  const writeText = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeText(0, "RIFF");
  view.setUint32(4, 36 + buffer.length * blockAlign, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, buffer.length * blockAlign, true);
  let offset = 44;
  for (let i = 0; i < buffer.length; i += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = clamp(buffer.getChannelData(channel)[i], -1, 1);
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return output;
}

export function SoundSeedStudio() {
  const [dna, setDna] = useState<SoundDNA | null>(null);
  const [sourceName, setSourceName] = useState("");
  const [sourceDuration, setSourceDuration] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [error, setError] = useState("");
  const [layers, setLayers] = useState<TrackLayer[]>([]);
  const [selectedStyle, setSelectedStyle] = useState<StyleChoice | null>(null);
  const [buildState, setBuildState] = useState<BuildState>("idle");
  const [buildCursor, setBuildCursor] = useState(0);
  const [auditionLayer, setAuditionLayer] = useState<string | null>(null);
  const [narration, setNarration] = useState("Your sound’s decisions will appear here as the track grows.");
  const [isPlaying, setIsPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [activeStage, setActiveStage] = useState(0);
  const [soloLayer, setSoloLayer] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const sourceBufferRef = useRef<AudioBuffer | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const schedulerRef = useRef<number | null>(null);
  const nextNoteTimeRef = useRef(0);
  const stepRef = useRef(0);
  const activeNodesRef = useRef<Set<AudioScheduledSourceNode>>(new Set());
  const layersRef = useRef<TrackLayer[]>([]);
  const stageRef = useRef(0);
  const auditionRef = useRef<string | null>(null);
  const soloRef = useRef<string | null>(null);
  const dnaRef = useRef<SoundDNA | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recordTickerRef = useRef<number | null>(null);
  const recordStartedRef = useRef(0);

  useEffect(() => { layersRef.current = layers; }, [layers]);
  useEffect(() => { stageRef.current = activeStage; }, [activeStage]);
  useEffect(() => { auditionRef.current = auditionLayer; }, [auditionLayer]);
  useEffect(() => { soloRef.current = soloLayer; }, [soloLayer]);
  useEffect(() => { dnaRef.current = dna; }, [dna]);

  const ensureAudioContext = useCallback(async () => {
    if (!audioContextRef.current || audioContextRef.current.state === "closed") {
      audioContextRef.current = new AudioContext();
    }
    if (audioContextRef.current.state === "suspended") await audioContextRef.current.resume();
    return audioContextRef.current;
  }, []);

  const clearScheduledNodes = useCallback(() => {
    activeNodesRef.current.forEach((node) => {
      try { node.stop(); } catch { /* already stopped */ }
    });
    activeNodesRef.current.clear();
  }, []);

  const stopPlayback = useCallback(() => {
    if (schedulerRef.current !== null) window.clearInterval(schedulerRef.current);
    schedulerRef.current = null;
    clearScheduledNodes();
    setIsPlaying(false);
    setPlayhead(0);
  }, [clearScheduledNodes]);

  const connectSample = useCallback((
    context: BaseAudioContext,
    destination: AudioNode,
    buffer: AudioBuffer,
    when: number,
    rate: number,
    gainValue: number,
    duration: number,
    filterFrequency?: number,
  ) => {
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    source.playbackRate.setValueAtTime(rate, when);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.001, gainValue), when + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    source.connect(gain);
    if (filterFrequency) {
      const filter = context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(filterFrequency, when);
      gain.connect(filter);
      filter.connect(destination);
    } else {
      gain.connect(destination);
    }
    const playableDuration = Math.max(0.025, Math.min(buffer.duration / Math.max(rate, 0.05), duration + 0.04));
    source.start(when, 0, Math.min(buffer.duration, playableDuration * rate));
    source.stop(when + playableDuration);
    if (context instanceof AudioContext) {
      activeNodesRef.current.add(source);
      source.onended = () => activeNodesRef.current.delete(source);
    }
  }, []);

  const connectTone = useCallback((
    context: BaseAudioContext,
    destination: AudioNode,
    frequency: number,
    when: number,
    duration: number,
    gainValue: number,
  ) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const filter = context.createBiquadFilter();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(frequency, when);
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(760, when);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(gainValue, when + 0.18);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(destination);
    oscillator.start(when);
    oscillator.stop(when + duration + 0.02);
    if (context instanceof AudioContext) {
      activeNodesRef.current.add(oscillator);
      oscillator.onended = () => activeNodesRef.current.delete(oscillator);
    }
  }, []);

  const scheduleLayer = useCallback((
    layer: TrackLayer,
    step: number,
    when: number,
    context: BaseAudioContext,
    destination: AudioNode,
    buffer: AudioBuffer,
    dnaValue: SoundDNA,
    beatDuration: number,
  ) => {
    if (layer.kind === "seed" && step % 4 === 0) {
      connectSample(context, destination, buffer, when, 1, 0.31, Math.min(0.34, beatDuration * 0.7));
    }
    if (layer.kind === "bass" && step % 8 === 0) {
      connectSample(context, destination, buffer, when, 0.25, 0.48, beatDuration * 1.65, 280);
    }
    if (layer.kind === "rhythm") {
      const variant = layer.variant ?? "lofi";
      if (variant === "house") {
        if (step % 4 === 0) connectSample(context, destination, buffer, when, 0.34, 0.34, beatDuration * 0.34, 340);
        if (step % 4 === 2) connectSample(context, destination, buffer, when, 1.72, 0.18, beatDuration * 0.2, 3600);
      } else if (variant === "jazz") {
        if ([0, 5, 9, 14].includes(step % 16)) {
          const strength = step % 16 === 0 ? 0.27 : 0.14;
          connectSample(context, destination, buffer, when + (step % 3) * 0.009, 1.32, strength, beatDuration * 0.23, 2600);
        }
      } else if ([0, 3, 6, 8, 11, 14].includes(step % 16)) {
        const backbeat = step % 16 === 6 || step % 16 === 14;
        connectSample(context, destination, buffer, when + (step % 2) * 0.012, backbeat ? 0.72 : 1.18, backbeat ? 0.25 : 0.12, beatDuration * 0.26, backbeat ? 1550 : 2900);
      }
    }
    if (layer.kind === "pad" && step % 8 === 0) {
      const root = noteToMidi(dnaValue.note, 4) - (step % 16 === 8 ? 5 : 12);
      const minor = dnaValue.key.includes("minor");
      [0, minor ? 3 : 4, 7].forEach((interval) => {
        connectTone(context, destination, midiToFrequency(root + interval), when, beatDuration * 7.6, 0.038);
      });
    }
    if (layer.kind === "melody") {
      const patternSteps = [0, 3, 6, 8, 11, 14];
      const index = patternSteps.indexOf(step % 16);
      if (index >= 0) {
        const scale = dnaValue.key.includes("minor") ? [0, 3, 5, 7, 10, 7] : [0, 2, 4, 7, 9, 7];
        connectSample(context, destination, buffer, when, Math.pow(2, scale[index] / 12), 0.18, beatDuration * 0.42, 5100);
      }
    }
  }, [connectSample, connectTone]);

  const scheduleStep = useCallback((step: number, when: number, context: AudioContext, destination: AudioNode) => {
    const buffer = sourceBufferRef.current;
    const dnaValue = dnaRef.current;
    if (!buffer || !dnaValue) return;
    const beatDuration = 60 / dnaValue.bpm;
    let audible = layersRef.current.slice(0, stageRef.current).filter((layer) => !layer.removed && !layer.muted);
    const focusId = auditionRef.current || soloRef.current;
    if (focusId) audible = audible.filter((layer) => layer.id === focusId);
    audible.forEach((layer) => scheduleLayer(layer, step, when, context, destination, buffer, dnaValue, beatDuration));
  }, [scheduleLayer]);

  const startPlayback = useCallback(async () => {
    if (!sourceBufferRef.current || !dnaRef.current) return;
    stopPlayback();
    const context = await ensureAudioContext();
    const master = context.createGain();
    const compressor = context.createDynamicsCompressor();
    master.gain.value = 0.78;
    master.connect(compressor);
    compressor.connect(context.destination);
    masterGainRef.current = master;
    nextNoteTimeRef.current = context.currentTime + 0.06;
    stepRef.current = 0;
    const tick = () => {
      const currentDna = dnaRef.current;
      if (!currentDna || !masterGainRef.current) return;
      const sixteenth = (60 / currentDna.bpm) / 4;
      while (nextNoteTimeRef.current < context.currentTime + 0.12) {
        const scheduledStep = stepRef.current;
        scheduleStep(scheduledStep, nextNoteTimeRef.current, context, masterGainRef.current);
        const delay = Math.max(0, (nextNoteTimeRef.current - context.currentTime) * 1000);
        window.setTimeout(() => setPlayhead(scheduledStep % 16), delay);
        nextNoteTimeRef.current += sixteenth;
        stepRef.current = (stepRef.current + 1) % 32;
      }
    };
    tick();
    schedulerRef.current = window.setInterval(tick, 25);
    setIsPlaying(true);
  }, [ensureAudioContext, scheduleStep, stopPlayback]);

  const loadAudioBuffer = useCallback(async (buffer: AudioBuffer, name: string) => {
    stopPlayback();
    setIsAnalyzing(true);
    setError("");
    await sleep(520);
    const analysis = analyzeBuffer(buffer);
    sourceBufferRef.current = buffer;
    setDna(analysis);
    dnaRef.current = analysis;
    setSourceName(name);
    setSourceDuration(buffer.duration);
    setLayers([]);
    setActiveStage(0);
    setSelectedStyle(null);
    setBuildState("idle");
    setBuildCursor(0);
    setSoloLayer(null);
    setNarration(`I found a stable ${analysis.note} center with a ${analysis.decay}. That gives us both a pitch and a rhythmic edge to build from.`);
    setIsAnalyzing(false);
  }, [stopPlayback]);

  const loadBlob = useCallback(async (blob: Blob, name: string) => {
    try {
      if (blob.size > 20 * 1024 * 1024) throw new Error("Please choose a clip under 20 MB.");
      const context = await ensureAudioContext();
      const arrayBuffer = await blob.arrayBuffer();
      const decoded = await context.decodeAudioData(arrayBuffer.slice(0));
      if (decoded.duration < 0.08) throw new Error("That clip is too short to analyze.");
      if (decoded.duration > 12) throw new Error("Trim the seed to 12 seconds or less so its fingerprint stays clear.");
      await loadAudioBuffer(decoded, name);
    } catch (cause) {
      setIsAnalyzing(false);
      setError(cause instanceof Error ? cause.message : "I couldn’t read that audio file. Try WAV, MP3, M4A, or WebM.");
    }
  }, [ensureAudioContext, loadAudioBuffer]);

  const loadDemo = useCallback(async () => {
    const context = await ensureAudioContext();
    const duration = 1.35;
    const buffer = context.createBuffer(1, Math.floor(context.sampleRate * duration), context.sampleRate);
    const data = buffer.getChannelData(0);
    const hitTimes = [0.03, 0.46, 0.91];
    for (let i = 0; i < data.length; i += 1) {
      const time = i / context.sampleRate;
      let sample = 0;
      hitTimes.forEach((hit, index) => {
        const age = time - hit;
        if (age >= 0) {
          const envelope = Math.exp(-age * (7.5 + index * 0.5));
          sample += envelope * (
            Math.sin(2 * Math.PI * 587.33 * age) * 0.56 +
            Math.sin(2 * Math.PI * 1174.66 * age) * 0.23 +
            Math.sin(2 * Math.PI * 1762 * age) * 0.1
          );
        }
      });
      data[i] = clamp(sample, -0.92, 0.92);
    }
    await loadAudioBuffer(buffer, "Ceramic mug ping · demo");
  }, [ensureAudioContext, loadAudioBuffer]);

  const handleFiles = useCallback((files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    loadBlob(file, file.name);
  }, [loadBlob]);

  const startRecording = useCallback(async () => {
    try {
      setError("");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const chunks: Blob[] = [];
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        loadBlob(blob, "Microphone take");
      };
      recorder.start();
      recordStartedRef.current = Date.now();
      setRecordSeconds(0);
      setIsRecording(true);
      recordTickerRef.current = window.setInterval(() => {
        const elapsed = (Date.now() - recordStartedRef.current) / 1000;
        setRecordSeconds(elapsed);
        if (elapsed >= 10 && recorder.state === "recording") recorder.stop();
      }, 100);
    } catch {
      setError("Microphone access was unavailable. You can still upload a clip or try the demo seed.");
    }
  }, [loadBlob]);

  const stopRecording = useCallback(() => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    if (recordTickerRef.current !== null) window.clearInterval(recordTickerRef.current);
    recordTickerRef.current = null;
    setIsRecording(false);
  }, []);

  useEffect(() => {
    if (!isRecording && recordTickerRef.current !== null) {
      window.clearInterval(recordTickerRef.current);
      recordTickerRef.current = null;
    }
    if (recordSeconds >= 10 && isRecording) stopRecording();
  }, [isRecording, recordSeconds, stopRecording]);

  useEffect(() => {
    if (buildState !== "building" || !dna) return;
    const blueprints = makeLayers(dna, selectedStyle);
    if (buildCursor === 2 && !selectedStyle) {
      const branchTimer = window.setTimeout(() => {
        setBuildState("branch");
        setNarration("The seed can support more than one future. Choose the kind of motion you want next—the sound stays the same, but the groove changes its meaning.");
      }, 650);
      return () => window.clearTimeout(branchTimer);
    }
    if (buildCursor >= blueprints.length) {
      setBuildState("complete");
      setAuditionLayer(null);
      setNarration("The arrangement is complete, but nothing is baked in. Mute, solo, remove, or rewind the build to hear exactly what each decision contributed.");
      return;
    }
    const layer = blueprints[buildCursor];
    let blendTimer: number | null = null;
    const revealTimer = window.setTimeout(() => {
      setLayers((current) => current.some((item) => item.id === layer.id) ? current : [...current, layer]);
      setActiveStage(buildCursor + 1);
      setAuditionLayer(layer.id);
      setNarration(layer.narration);
      blendTimer = window.setTimeout(() => {
        setAuditionLayer(null);
        setBuildCursor((cursor) => cursor + 1);
      }, 1750);
    }, 600);
    return () => {
      window.clearTimeout(revealTimer);
      if (blendTimer !== null) window.clearTimeout(blendTimer);
    };
  }, [buildCursor, buildState, dna, selectedStyle]);

  const beginBuild = useCallback(async () => {
    if (!dna) return;
    setLayers([]);
    layersRef.current = [];
    setActiveStage(0);
    stageRef.current = 0;
    setSelectedStyle(null);
    setBuildCursor(0);
    setBuildState("building");
    setSoloLayer(null);
    setAuditionLayer(null);
    setNarration("Listening for the clearest attack… I’ll begin with the part of your sound that is easiest to recognize.");
    await startPlayback();
  }, [dna, startPlayback]);

  const chooseStyle = useCallback((style: StyleChoice) => {
    setSelectedStyle(style);
    setBuildState("building");
    setNarration(`Direction chosen: ${STYLE_OPTIONS.find((item) => item.id === style)?.title}. I’ll reshape the sample’s attack without replacing it.`);
  }, []);

  const toggleMute = useCallback((id: string) => {
    setLayers((current) => current.map((layer) => layer.id === id ? { ...layer, muted: !layer.muted } : layer));
    if (soloLayer === id) setSoloLayer(null);
  }, [soloLayer]);

  const toggleRemove = useCallback((id: string) => {
    setLayers((current) => current.map((layer) => layer.id === id ? { ...layer, removed: !layer.removed } : layer));
    if (soloLayer === id) setSoloLayer(null);
  }, [soloLayer]);

  const playSource = useCallback(async () => {
    const buffer = sourceBufferRef.current;
    if (!buffer) return;
    const context = await ensureAudioContext();
    const source = context.createBufferSource();
    const gain = context.createGain();
    gain.gain.value = 0.72;
    source.buffer = buffer;
    source.connect(gain);
    gain.connect(context.destination);
    source.start();
  }, [ensureAudioContext]);

  const exportMix = useCallback(async () => {
    const buffer = sourceBufferRef.current;
    if (!buffer || !dna || !layers.length) return;
    setIsExporting(true);
    try {
      const duration = Math.max(12, (60 / dna.bpm) * 16);
      const context = new OfflineAudioContext(2, Math.ceil(44100 * duration), 44100);
      const master = context.createGain();
      const compressor = context.createDynamicsCompressor();
      master.gain.value = 0.78;
      master.connect(compressor);
      compressor.connect(context.destination);
      const sixteenth = (60 / dna.bpm) / 4;
      const audible = layers.filter((layer, index) => index < activeStage && !layer.removed && !layer.muted && (!soloLayer || layer.id === soloLayer));
      for (let step = 0; step * sixteenth < duration - 0.6; step += 1) {
        audible.forEach((layer) => scheduleLayer(layer, step % 32, step * sixteenth, context, master, buffer, dna, 60 / dna.bpm));
      }
      const rendered = await context.startRendering();
      const blob = new Blob([encodeWav(rendered)], { type: "audio/wav" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `soundseed-${dna.note.toLowerCase().replace("♯", "sharp")}-${selectedStyle ?? "mix"}.wav`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    } finally {
      setIsExporting(false);
    }
  }, [activeStage, dna, layers, scheduleLayer, selectedStyle, soloLayer]);

  useEffect(() => () => {
    if (schedulerRef.current !== null) window.clearInterval(schedulerRef.current);
    if (recordTickerRef.current !== null) window.clearInterval(recordTickerRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    clearScheduledNodes();
    audioContextRef.current?.close();
  }, [clearScheduledNodes]);

  const mixWaveform = useMemo(() => {
    if (!dna) return [];
    return dna.waveform.map((value, index) => clamp(value * 0.48 + ((index * 7) % 11) / 18 + layers.length * 0.025, 0.12, 1));
  }, [dna, layers.length]);

  const visibleLayers = layers.slice(0, activeStage);
  const currentLayerName = auditionLayer ? layers.find((layer) => layer.id === auditionLayer)?.name : null;
  const progress = buildState === "complete" ? 100 : buildState === "branch" ? 43 : Math.round((layers.length / 5) * 100);

  return (
    <main className={`app-shell ${dna ? "app-shell--studio" : ""}`}>
      <header className="topbar">
        <button className="brand" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} aria-label="SoundSeed home">
          <span className="brand-mark"><i /><i /><i /></span>
          <span>SoundSeed</span>
          <small>POC / 01</small>
        </button>
        <div className="topbar-center">
          <span className="status-dot" />
          <span>{dna ? "SEED LOADED" : "STUDIO READY"}</span>
        </div>
        <button className="about-link" onClick={() => document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth" })}>
          How it works <span>↘</span>
        </button>
      </header>

      {!dna && !isAnalyzing ? (
        <section className="landing" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="kicker"><span>01</span> ONE SOUND IN. EVERY DECISION VISIBLE.</p>
            <h1 id="hero-title">Don’t just hear<br />the song. <em>Watch it<br />become one.</em></h1>
            <p className="hero-subtitle">Drop a tap, creak, clap, hum, or clink. SoundSeed turns it into a layered track in front of you—one audible choice at a time.</p>
            <div className="hero-proof">
              <span><b>5</b> reversible layers</span>
              <span><b>0</b> black-box moments</span>
              <span><b>1</b> original sound</span>
            </div>
          </div>

          <div
            className={`capture-card ${isDragging ? "capture-card--dragging" : ""}`}
            onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(event: DragEvent<HTMLDivElement>) => {
              event.preventDefault();
              setIsDragging(false);
              handleFiles(event.dataTransfer.files);
            }}
          >
            <div className="capture-topline"><span>START WITH A SEED</span><span>2—10 SEC</span></div>
            <div className="sound-orbit" aria-hidden="true">
              <span className="orbit orbit-a" /><span className="orbit orbit-b" />
              <div className="orbit-core"><i /><i /><i /><i /><i /></div>
            </div>
            <div className="capture-copy">
              <h2>Give us one<br />ordinary sound.</h2>
              <p>The stranger, the better. A coffee cup, a key turning, your desk, your voice.</p>
            </div>
            <div className="capture-actions">
              <button className={`record-button ${isRecording ? "is-recording" : ""}`} onClick={isRecording ? stopRecording : startRecording}>
                <span className="record-icon" />
                {isRecording ? `Stop · ${recordSeconds.toFixed(1)}s` : "Record a sound"}
              </button>
              <span className="or-divider">OR</span>
              <button className="upload-button" onClick={() => fileInputRef.current?.click()}>
                <span>↑</span> Drop or upload
              </button>
              <input ref={fileInputRef} type="file" accept="audio/*" hidden onChange={(event: ChangeEvent<HTMLInputElement>) => handleFiles(event.target.files)} />
            </div>
            <button className="demo-link" onClick={loadDemo}>No sound handy? Try a ceramic mug ping <span>→</span></button>
            {error && <p className="error-message" role="alert">{error}</p>}
          </div>
        </section>
      ) : isAnalyzing ? (
        <section className="analysis-loading" aria-live="polite">
          <div className="analysis-ring"><span /><span /><span /></div>
          <p className="kicker"><span>02</span> READING THE FINGERPRINT</p>
          <h1>Finding the note<br />inside your noise.</h1>
          <div className="scan-line"><i /></div>
          <p>Measuring pitch, attack, decay, brightness and rhythmic hit points…</p>
        </section>
      ) : dna ? (
        <section className="studio" aria-label="SoundSeed arrangement studio">
          <div className="studio-heading">
            <div>
              <p className="kicker"><span>02</span> SOUND DNA</p>
              <h1>Here’s what<br />your sound contains.</h1>
            </div>
            <div className="seed-summary">
              <span className="seed-file-label">YOUR SEED</span>
              <strong>{sourceName}</strong>
              <span>{sourceDuration.toFixed(1)} SEC · MONO/STEREO SOURCE</span>
              <button onClick={() => { stopPlayback(); setDna(null); setLayers([]); }}>Replace sound ↗</button>
            </div>
          </div>

          <div className="source-mix-grid">
            <article className="source-panel panel">
              <div className="panel-label"><span>ORIGINAL / SOURCE</span><button onClick={playSource}>▶ HEAR RAW</button></div>
              <Waveform values={dna.waveform} color="#ffb44a" label="Waveform of the original sound" />
              <div className="wave-time"><span>0:00</span><span>{formatTime(sourceDuration)}</span></div>
            </article>
            <article className="mix-panel panel">
              <div className="panel-label"><span>EVOLVING / MIX</span><span>{layers.length ? `${layers.length} LAYERS` : "EMPTY"}</span></div>
              {layers.length ? (
                <Waveform values={mixWaveform} color="#9adf64" active={isPlaying} label="Waveform of the evolving mix" />
              ) : (
                <div className="empty-mix"><span /><p>Layers will appear here</p><span /></div>
              )}
              <div className="wave-time"><span>0:00</span><span>{formatTime(Math.max(12, (60 / dna.bpm) * 16))}</span></div>
            </article>
          </div>

          <div className="dna-grid">
            <article className="dna-lead">
              <span className="dna-index">A</span>
              <p>DOMINANT PITCH</p>
              <strong>{dna.note}<sup>{Math.round(dna.pitchHz)} Hz</sup></strong>
              <div className="confidence"><span style={{ width: `${dna.confidence}%` }} /> <small>{dna.confidence}% signal confidence</small></div>
            </article>
            <article><span className="dna-index">B</span><p>LIKELY KEY</p><strong>{dna.key}</strong><small>Root inferred from stable partial</small></article>
            <article><span className="dna-index">C</span><p>TIMBRE</p><strong>{dna.brightness}</strong><small>{Math.round(dna.brightnessScore * 100)}% high-frequency energy</small></article>
            <article><span className="dna-index">D</span><p>DECAY</p><strong>{dna.decay}</strong><small>≈ {dna.decaySeconds.toFixed(2)} sec tail</small></article>
            <article><span className="dna-index">E</span><p>NATURAL PULSE</p><strong>{dna.bpm} BPM</strong><small>{dna.hits} hit point{dna.hits === 1 ? "" : "s"} detected</small></article>
          </div>

          {buildState === "idle" ? (
            <div className="build-cta">
              <div>
                <p className="kicker"><span>03</span> BUILD IN THE OPEN</p>
                <h2>Ready to hear the<br />first decision?</h2>
              </div>
              <p>Each new layer plays alone first. Then it joins the mix. You can undo every move.</p>
              <button className="build-button" onClick={beginBuild}><span>Build the track</span><b>▶</b></button>
            </div>
          ) : (
            <div className="arrangement-section">
              <div className="arrangement-header">
                <div>
                  <p className="kicker"><span>03</span> LIVE BUILD</p>
                  <h2>One choice at a time.</h2>
                </div>
                <div className="transport">
                  <button className="transport-main" onClick={isPlaying ? stopPlayback : startPlayback} aria-label={isPlaying ? "Pause arrangement" : "Play arrangement"}>
                    {isPlaying ? "Ⅱ" : "▶"}
                  </button>
                  <div><strong>{isPlaying ? formatTime((playhead / 16) * (60 / dna.bpm) * 4) : "0:00"}</strong><span>{dna.bpm} BPM · 4/4</span></div>
                </div>
                <div className="build-progress"><span><i style={{ width: `${progress}%` }} /></span><small>{buildState === "complete" ? "ARRANGEMENT READY" : buildState === "branch" ? "AWAITING YOUR DIRECTION" : `BUILDING · ${progress}%`}</small></div>
              </div>

              <div className="narration-card" aria-live="polite">
                <div className="ai-avatar"><i /><i /><i /></div>
                <div><span>{auditionLayer ? `SOLO AUDITION · ${currentLayerName}` : buildState === "branch" ? "YOUR TURN" : "SOUNDSEED IS THINKING"}</span><p>{narration}</p></div>
                {auditionLayer && <b className="listening-pill">LISTEN SOLO</b>}
              </div>

              {buildState === "branch" && (
                <div className="branch-point">
                  <div className="branch-heading"><span>BRANCH POINT / 01</span><h3>What should the seed become next?</h3><p>Same source. Three very different futures.</p></div>
                  <div className="style-grid">
                    {STYLE_OPTIONS.map((option, index) => (
                      <button key={option.id} onClick={() => chooseStyle(option.id)}>
                        <span className="style-number">0{index + 1}</span>
                        <small>{option.eyebrow}</small>
                        <strong>{option.title}</strong>
                        <p>{option.description}</p>
                        <code>{option.pattern}</code>
                        <b>Choose direction <span>→</span></b>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="timeline-wrap">
                <div className="timeline-ruler">
                  <span>TRACK</span>
                  {[1, 2, 3, 4].map((bar) => <b key={bar}>BAR {bar}</b>)}
                </div>
                <div className="timeline-playhead" style={{ left: `calc(214px + (100% - 214px) * ${playhead / 16})` }} />
                {visibleLayers.map((layer) => (
                  <div className={`track-row ${layer.removed ? "is-removed" : ""} ${layer.muted ? "is-muted" : ""} ${auditionLayer === layer.id ? "is-auditioning" : ""}`} key={layer.id}>
                    <div className="track-info">
                      <span className="track-color" style={{ background: layer.color }} />
                      <div><small>LAYER {layer.number}</small><strong>{layer.name}</strong><span>{layer.role}</span></div>
                    </div>
                    <div className="track-controls">
                      <button className={layer.muted ? "active" : ""} onClick={() => toggleMute(layer.id)} aria-label={`${layer.muted ? "Unmute" : "Mute"} ${layer.name}`}>M</button>
                      <button className={soloLayer === layer.id ? "active" : ""} onClick={() => setSoloLayer((current) => current === layer.id ? null : layer.id)} aria-label={`Solo ${layer.name}`}>S</button>
                      <button className={layer.removed ? "active" : ""} onClick={() => toggleRemove(layer.id)} aria-label={`${layer.removed ? "Restore" : "Remove"} ${layer.name}`}>{layer.removed ? "↶" : "×"}</button>
                    </div>
                    <div className="track-lane">
                      {Array.from({ length: 16 }, (_, step) => (
                        <span key={step} className={layer.pattern.includes(step) ? "has-hit" : ""} style={layer.pattern.includes(step) ? { background: layer.color } : undefined} />
                      ))}
                      <div className="derivation-tag">{layer.derivation}</div>
                    </div>
                  </div>
                ))}
                {buildState !== "complete" && buildState !== "branch" && (
                  <div className="track-row track-row--pending"><div className="track-info"><span className="track-color" /><div><small>NEXT LAYER</small><strong>Listening…</strong><span>Choosing a musical role</span></div></div><div className="pending-lane"><i /><i /><i /></div></div>
                )}
              </div>

              {!!layers.length && (
                <div className="history-panel">
                  <div><span>BUILD HISTORY</span><strong>Rewind the arrangement</strong><p>Drag backward to hear the song un-build, layer by layer.</p></div>
                  <div className="history-control">
                    <input
                      type="range"
                      min="1"
                      max={layers.length}
                      value={Math.max(1, activeStage)}
                      onChange={(event) => setActiveStage(Number(event.target.value))}
                      aria-label="Arrangement build history"
                      style={{ "--history-progress": `${((Math.max(1, activeStage) - 1) / Math.max(1, layers.length - 1)) * 100}%` } as React.CSSProperties}
                    />
                    <div>{layers.map((layer, index) => <button key={layer.id} className={index < activeStage ? "active" : ""} onClick={() => setActiveStage(index + 1)}><i style={{ background: layer.color }} />L{index + 1}</button>)}</div>
                  </div>
                </div>
              )}

              {buildState === "complete" && (
                <div className="finale-card">
                  <div className="finale-badge"><span>✓</span> THE SEED BECAME A SONG</div>
                  <div><h3>Your {selectedStyle ? STYLE_OPTIONS.find((option) => option.id === selectedStyle)?.title.toLowerCase() : ""} mix is ready.</h3><p>Five layers, one source, every choice still yours.</p></div>
                  <button onClick={exportMix} disabled={isExporting}>{isExporting ? "Rendering…" : "Export mix · WAV"}<span>↓</span></button>
                </div>
              )}
            </div>
          )}

          <section className="how-section" id="how-it-works">
            <p className="kicker"><span>04</span> NO MAGIC CURTAIN</p>
            <h2>The process is<br />the product.</h2>
            <div className="how-grid">
              <article><b>01</b><strong>Listen</strong><p>Measure the pitch, envelope, texture and pulse hiding inside an everyday sound.</p></article>
              <article><b>02</b><strong>Derive</strong><p>Crop, stretch, tune and sequence that same source into distinct musical roles.</p></article>
              <article><b>03</b><strong>Explain</strong><p>Audition every layer alone and show why it belongs before it joins the full mix.</p></article>
              <article><b>04</b><strong>Let go</strong><p>Mute, remove or rewind every decision. The original seed is never lost.</p></article>
            </div>
          </section>
        </section>
      ) : null}

      <footer>
        <span>SoundSeed</span>
        <p>One small sound. A visible chain of musical decisions.</p>
        <small>WORKING POC · BUILT WITH WEB AUDIO</small>
      </footer>
    </main>
  );
}
