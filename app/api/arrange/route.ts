import { env } from "cloudflare:workers";

type PlannerRequest = {
  description?: string;
  seed?: { note?: string; bpm?: number; brightness?: string; detectedHits?: number; pitchConfidence?: number };
  currentPlan?: Record<string, unknown>;
  history?: Array<{ role?: "user" | "assistant"; text?: string }>;
  renderReview?: { score?: number; peak?: number; rms?: number; lowEnergy?: number; highEnergy?: number; repetition?: number; dynamicRange?: number; issues?: string[] };
  qualityRevision?: boolean;
};

const EVENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["bars", "step", "pitches", "duration", "velocity"],
  properties: {
    bars: { type: "array", minItems: 1, maxItems: 16, items: { type: "integer", minimum: 1, maximum: 16 } },
    step: { type: "integer", minimum: 0, maximum: 15 },
    pitches: { type: "array", minItems: 1, maxItems: 4, items: { type: "integer", minimum: -24, maximum: 24 } },
    duration: { type: "integer", minimum: 1, maximum: 16 },
    velocity: { type: "number", minimum: 0.15, maximum: 1 },
  },
} as const;

const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["bars", "seed_repetitions", "literal_seed_bars", "bpm", "groove", "synth_shape", "musical_mode", "arrangement_shape", "progression", "sections", "seed_presence", "layer_levels", "style_name", "sound_design", "instruments", "patterns", "instrument_events", "seed_voices", "explanation"],
  properties: {
    bars: { type: "integer", minimum: 1, maximum: 16 },
    seed_repetitions: { type: "integer", minimum: 0, maximum: 12 },
    literal_seed_bars: {
      type: "array",
      minItems: 0,
      maxItems: 16,
      items: { type: "integer", minimum: 1, maximum: 16 },
    },
    bpm: { type: "integer", minimum: 60, maximum: 160 },
    groove: { type: "string", enum: ["straight", "pocket", "sparse"] },
    synth_shape: { type: "string", enum: ["pluck", "pad", "arp"] },
    musical_mode: { type: "string", enum: ["minor", "major", "suspended", "percussive"] },
    arrangement_shape: { type: "string", enum: ["steady", "build", "rise_fall"] },
    progression: { type: "array", minItems: 1, maxItems: 8, items: { type: "integer", minimum: -12, maximum: 12 } },
    sections: {
      type: "array",
      minItems: 1,
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "start_bar", "end_bar", "energy"],
        properties: {
          name: { type: "string", minLength: 2, maxLength: 24 },
          start_bar: { type: "integer", minimum: 1, maximum: 16 },
          end_bar: { type: "integer", minimum: 1, maximum: 16 },
          energy: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
    seed_presence: { type: "number", minimum: 0, maximum: 1 },
    layer_levels: {
      type: "object",
      additionalProperties: false,
      required: ["foundation", "kick", "clap", "hat", "bass", "synth"],
      properties: {
        foundation: { type: "number", minimum: 0, maximum: 1 },
        kick: { type: "number", minimum: 0, maximum: 1 },
        clap: { type: "number", minimum: 0, maximum: 1 },
        hat: { type: "number", minimum: 0, maximum: 1 },
        bass: { type: "number", minimum: 0, maximum: 1 },
        synth: { type: "number", minimum: 0, maximum: 1 },
      },
    },
    style_name: { type: "string", minLength: 2, maxLength: 48 },
    sound_design: {
      type: "object",
      additionalProperties: false,
      required: ["kick_depth", "brightness", "swing", "space"],
      properties: {
        kick_depth: { type: "number", minimum: 0, maximum: 1 },
        brightness: { type: "number", minimum: 0, maximum: 1 },
        swing: { type: "number", minimum: 0, maximum: 0.35 },
        space: { type: "number", minimum: 0, maximum: 1 },
      },
    },
    instruments: {
      type: "array",
      items: { type: "string", enum: ["kick", "clap", "hat", "bass", "synth"] },
    },
    patterns: {
      type: "object",
      additionalProperties: false,
      required: ["foundation", "kick", "clap", "hat", "bass", "synth"],
      properties: {
        foundation: { type: "array", items: { type: "integer", minimum: 0, maximum: 15 } },
        kick: { type: "array", items: { type: "integer", minimum: 0, maximum: 15 } },
        clap: { type: "array", items: { type: "integer", minimum: 0, maximum: 15 } },
        hat: { type: "array", items: { type: "integer", minimum: 0, maximum: 15 } },
        bass: { type: "array", items: { type: "integer", minimum: 0, maximum: 15 } },
        synth: { type: "array", items: { type: "integer", minimum: 0, maximum: 15 } },
      },
    },
    instrument_events: {
      type: "object",
      additionalProperties: false,
      required: ["foundation", "kick", "clap", "hat", "bass", "synth"],
      properties: {
        foundation: { type: "array", maxItems: 16, items: EVENT_SCHEMA },
        kick: { type: "array", maxItems: 16, items: EVENT_SCHEMA },
        clap: { type: "array", maxItems: 12, items: EVENT_SCHEMA },
        hat: { type: "array", maxItems: 20, items: EVENT_SCHEMA },
        bass: { type: "array", maxItems: 20, items: EVENT_SCHEMA },
        synth: { type: "array", maxItems: 20, items: EVENT_SCHEMA },
      },
    },
    seed_voices: {
      type: "array",
      minItems: 0,
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "name", "character", "start_bar", "end_bar", "pattern", "pitch_pattern", "events", "speed", "level", "reason"],
        properties: {
          id: { type: "string", minLength: 2, maxLength: 24 },
          name: { type: "string", minLength: 2, maxLength: 32 },
          character: { type: "string", enum: ["hook", "melody", "low_pulse", "high_spark", "texture", "echo"] },
          start_bar: { type: "integer", minimum: 1, maximum: 16 },
          end_bar: { type: "integer", minimum: 1, maximum: 16 },
          pattern: { type: "array", minItems: 1, maxItems: 8, items: { type: "integer", minimum: 0, maximum: 15 } },
          pitch_pattern: { type: "array", minItems: 1, maxItems: 8, items: { type: "integer", minimum: -24, maximum: 24 } },
          events: { type: "array", minItems: 1, maxItems: 24, items: EVENT_SCHEMA },
          speed: { type: "number", minimum: 0.5, maximum: 2 },
          level: { type: "number", minimum: 0.08, maximum: 0.7 },
          reason: { type: "string", minLength: 8, maxLength: 100 },
        },
      },
    },
    explanation: { type: "string", minLength: 20, maxLength: 320 },
  },
} as const;

function readOutputText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string") return payload.output_text;
  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = Array.isArray((item as { content?: unknown }).content) ? (item as { content: unknown[] }).content : [];
    for (const part of content) {
      if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") return (part as { text: string }).text;
    }
  }
  return "";
}

function normalizePlanPayload(plan: Record<string, unknown>) {
  const next = { ...plan };
  const totalBars = typeof next.bars === "number" ? Math.max(1, Math.min(16, Math.round(next.bars))) : 8;
  const requestedRepetitions = typeof next.seed_repetitions === "number" ? Math.max(0, Math.min(12, Math.round(next.seed_repetitions))) : 0;
  const requestedBars = Array.isArray(next.literal_seed_bars)
    ? Array.from(new Set(next.literal_seed_bars.filter((bar): bar is number => typeof bar === "number").map((bar) => Math.max(1, Math.min(totalBars, Math.round(bar)))))).sort((a, b) => a - b)
    : [];
  const literalActive = requestedRepetitions > 0 && requestedBars.length > 0;
  const repetitions = literalActive ? requestedRepetitions : 0;
  const literalBars = literalActive ? requestedBars : [];
  const patterns = next.patterns && typeof next.patterns === "object" ? { ...(next.patterns as Record<string, unknown>) } : {};
  const foundationPattern = Array.isArray(patterns.foundation) ? patterns.foundation : [];
  patterns.foundation = literalActive && foundationPattern.length === repetitions
    ? foundationPattern
    : literalActive ? Array.from({ length: repetitions }, (_, index) => Math.floor((index * 16) / repetitions)) : [];

  const clampEvents = (value: unknown) => Array.isArray(value) ? value
    .filter((event): event is Record<string, unknown> => Boolean(event) && typeof event === "object")
    .map((event) => ({
      ...event,
      bars: Array.from(new Set((Array.isArray(event.bars) ? event.bars : [])
        .filter((bar): bar is number => typeof bar === "number" && Number.isFinite(bar))
        .map((bar) => Math.max(1, Math.min(totalBars, Math.round(bar)))))).sort((a, b) => a - b),
      step: typeof event.step === "number" ? Math.max(0, Math.min(15, Math.round(event.step))) : 0,
      pitches: (Array.isArray(event.pitches) ? event.pitches : [0])
        .filter((pitch): pitch is number => typeof pitch === "number" && Number.isFinite(pitch))
        .slice(0, 4)
        .map((pitch) => Math.max(-24, Math.min(24, Math.round(pitch)))),
      duration: typeof event.duration === "number" ? Math.max(1, Math.min(16, Math.round(event.duration))) : 1,
      velocity: typeof event.velocity === "number" ? Math.max(0.15, Math.min(1, event.velocity)) : 0.7,
    }))
    .filter((event) => event.bars.length > 0) : [];

  let instruments = Array.isArray(next.instruments) ? next.instruments.filter((instrument): instrument is string => typeof instrument === "string") : [];
  const voices = Array.isArray(next.seed_voices) ? next.seed_voices
    .filter((voice): voice is Record<string, unknown> => Boolean(voice) && typeof voice === "object")
    .map((voice) => ({ ...voice, events: clampEvents(voice.events) })) : [];
  if (!literalActive && !voices.length && !instruments.length) instruments = ["kick", "bass"];
  const fallbackPatterns: Record<string, number[]> = { kick: [0, 8], clap: [4, 12], hat: [2, 6, 10, 14], bass: [0, 8, 12], synth: [0, 8] };
  instruments.forEach((instrument) => { if (!Array.isArray(patterns[instrument]) || !(patterns[instrument] as unknown[]).length) patterns[instrument] = fallbackPatterns[instrument] ?? [0, 8]; });
  const instrumentEvents = next.instrument_events && typeof next.instrument_events === "object" ? { ...(next.instrument_events as Record<string, unknown>) } : {};
  const allBars = Array.from({ length: totalBars }, (_, index) => index + 1);
  const makeFallbackEvents = (instrument: string) => ((patterns[instrument] as number[] | undefined) ?? []).map((step) => ({
    bars: allBars,
    step,
    pitches: instrument === "bass" ? [-12] : instrument === "synth" && next.synth_shape === "pad" ? [0, 3, 7] : [0],
    duration: instrument === "synth" && next.synth_shape === "pad" ? 8 : instrument === "bass" ? 3 : 1,
    velocity: instrument === "hat" ? 0.42 : instrument === "synth" ? 0.5 : 0.72,
  }));
  (["foundation", "kick", "clap", "hat", "bass", "synth"] as const).forEach((instrument) => {
    instrumentEvents[instrument] = clampEvents(instrumentEvents[instrument]);
    if (instrument === "foundation") {
      if (!literalActive) instrumentEvents.foundation = [];
      else if (!(instrumentEvents.foundation as unknown[]).length) instrumentEvents.foundation = (patterns.foundation as number[]).map((step) => ({ bars: literalBars, step, pitches: [0], duration: 1, velocity: 0.82 }));
      else instrumentEvents.foundation = (instrumentEvents.foundation as Array<Record<string, unknown>>)
        .map((event) => ({ ...event, bars: (event.bars as number[]).filter((bar) => literalBars.includes(bar)) }))
        .filter((event) => (event.bars as number[]).length > 0);
      return;
    }
    if (!instruments.includes(instrument)) instrumentEvents[instrument] = [];
    else if (!(instrumentEvents[instrument] as unknown[]).length) instrumentEvents[instrument] = makeFallbackEvents(instrument);
  });

  const sections = Array.isArray(next.sections) ? next.sections
    .filter((section): section is Record<string, unknown> => Boolean(section) && typeof section === "object")
    .map((section) => ({
      ...section,
      start_bar: typeof section.start_bar === "number" ? Math.max(1, Math.min(totalBars, Math.round(section.start_bar))) : 1,
      end_bar: typeof section.end_bar === "number" ? Math.max(1, Math.min(totalBars, Math.round(section.end_bar))) : totalBars,
    }))
    .map((section) => ({ ...section, end_bar: Math.max(section.start_bar, section.end_bar) })) : [];

  let explanation = typeof next.explanation === "string" ? next.explanation.trim() : "The isolated seed has been reshaped into a balanced arrangement.";
  if (!/[.!?]$/.test(explanation)) {
    const lastCompleteSentence = Math.max(explanation.lastIndexOf("."), explanation.lastIndexOf("!"), explanation.lastIndexOf("?"));
    explanation = lastCompleteSentence >= 20 ? explanation.slice(0, lastCompleteSentence + 1) : `${explanation.replace(/[,:;\s]+$/, "")}.`;
  }

  next.seed_repetitions = repetitions;
  next.literal_seed_bars = literalBars;
  next.seed_presence = literalActive && typeof next.seed_presence === "number" ? next.seed_presence : 0;
  next.patterns = patterns;
  next.instrument_events = instrumentEvents;
  next.instruments = instruments;
  next.seed_voices = voices;
  next.sections = sections.length ? sections : [{ name: "Full arrangement", start_bar: 1, end_bar: totalBars, energy: 0.6 }];
  next.explanation = explanation;
  if (!literalActive && next.layer_levels && typeof next.layer_levels === "object") next.layer_levels = { ...(next.layer_levels as Record<string, unknown>), foundation: 0 };
  return next;
}

export async function POST(request: Request) {
  let body: PlannerRequest;
  try {
    body = await request.json() as PlannerRequest;
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const description = body.description?.trim();
  if (!description || description.length < 4 || description.length > 700) {
    return Response.json({ error: "Describe the loop in 4–700 characters." }, { status: 400 });
  }

  const workerEnv = env as unknown as Record<string, string | undefined>;
  const apiKey = workerEnv.OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!apiKey) return Response.json({ error: "OpenAI is not configured on this server." }, { status: 503 });

  const seed = body.seed ?? {};
  const history = (body.history ?? []).slice(-8)
    .filter((message) => message.text?.trim())
    .map((message) => `${message.role === "assistant" ? "SoundSeed" : "User"}: ${message.text!.trim()}`)
    .join("\n");
  const currentPlan = body.currentPlan ? JSON.stringify(body.currentPlan, null, 2) : "No arrangement exists yet.";
  const renderReview = body.renderReview ? JSON.stringify(body.renderReview, null, 2) : "No rendered-audio review is available yet.";
  const prompt = `${body.currentPlan ? "Revise the current arrangement" : "Create the first arrangement"} from an ordinary listener's description.

SOURCE
- detected note: ${seed.note ?? "unknown"}
- pitch confidence: ${seed.pitchConfidence ?? 0} (below 0.34 means the impact is not reliably pitched)
- natural tempo: ${seed.bpm ?? 100} BPM
- timbre: ${seed.brightness ?? "percussive"}
- captured impacts: ${seed.detectedHits ?? 1}

CURRENT VERSION
${currentPlan}

RECENT CONVERSATION
${history || "First direction."}

NEW DIRECTION
${description}

ACTUAL RENDERED-AUDIO REVIEW
${renderReview}

SUCCESS CRITERIA
- The listener will speak vaguely about feeling and outcome, not production technique. You must autonomously decide tempo, pitch movement, speed, repetition, layer count, density and section timing. Never require the listener to request a track, semitone, bar number or effect.
- instrument_events and each seed_voice.events are the authoritative song timeline. Every event declares the bars where it occurs, its sixteenth-note step, explicit pitches, duration and velocity. Event pitches are semitone offsets from the song's detected or chosen key center, not from progression roots; spell out the final intended notes. The one-bar patterns are only compact visual summaries and fallbacks.
- Compose notes for every pitched part. Bass events normally use one low pitch, pluck/arp events use one note, and pad events use 2-4 explicit chord pitches with smooth voice-leading. Percussion events use pitches [0]. Do not leave selected instruments without events.
- Use grouped bar lists to keep the plan compact, but create real 4- or 8-bar development: a motif statement, a small answer or variation, a transition/fill and an ending. Do not copy the exact same event set into every bar.
- sections must cover the full arrangement without gaps, use plain listener-friendly names, and show a meaningful energy journey. Event bar assignments must agree with those sections.
- Use a seed-first production model. Every audible instrument must originate from the isolated seed, but the exact recorded hit is optional; its timbre can survive entirely through resynthesis, pitch, speed, envelopes and filtering.
- literal_seed_bars controls the bars where the unchanged recorded hit is audible. An empty array means the listener never hears the literal hit. The first arrangement should normally use it sparingly in 1-3 bars, such as an intro, transition or ending, unless the description clearly asks for the click itself as the main character.
- seed_repetitions is the number of literal-hit positions in each active literal_seed_bar. Use 0 when literal_seed_bars is empty. patterns.foundation must also be empty when the literal seed is absent.
- Treat provenance and audible identity as different things. Kick, bass and pad are resynthesized from the seed's tonal body; clap and hat reshape its transient; melody maps the isolated sample across pitch. They should sound like distinct instruments, not repeated copies of one click.
- seed_voices are the evolving creative timeline. Every voice is made from the isolated impact and has its own bar range, rhythm, speed and pitch pattern. Pitch is the primary way to turn the same impact into a hook, melody, low pulse, sparkle or texture.
- For a first arrangement, normally create 1-2 distinct seed_voices plus restrained seed-derived kick and bass. Use the synth instrument only for a requested seed-derived pad; seed_voices handle pitched hooks and melodies. Returning no seed voices is valid when the resynthesized instruments already carry the idea.
- On later vague edits such as "make it better", "more alive", "less repetitive", "give it a lift" or "it feels flat", make a musically useful decision yourself. Add, rewrite or retire seed voices when that improves the song; otherwise revise section timing, pitch contour, rhythm or space. The array may grow up to 6 voices.
- Keep a seed_voice id stable only while that musical role is genuinely retained. You may retire stale voices or replace them with a more useful role. start_bar and end_bar are inclusive and must fit within bars. Pitch patterns are semitone offsets: use mostly consonant values, purposeful contours and no random chromatic wandering.
- Treat this as music, not a sound-effect collage. Give each seed voice one clear role and reuse a short motif instead of generating unrelated pitches on every hit.
- Use high positive pitch or faster speed for sparkle, and negative pitch or slower speed for weight. Because sampler speed also colors pitch and duration, avoid combining extreme pitch and extreme speed on the same voice.
- Keep pitch patterns to 3-5 notes drawn from the selected mode's pentatonic scale. Prefer repetition with one small variation; avoid chromatic movement and wide octave jumps.
- For every seed voice, pitch_pattern is only a readable motif summary; its events must spell out the actual bar-by-bar notes. Reuse the motif enough to be memorable, then make one controlled variation rather than randomizing every bar.
- No voice is required to remain near pitch 0. A transformed hook can sit at any consonant pitch and speed that suits the song. A first arrangement should normally be 8 bars, use 1-2 seed voices, and have no more than 3 seed voices sounding in the same section.
- Stagger rhythms so the foundation, melody and sparkle do not all hit on the same steps. Most voices should use 2-5 positions per bar and levels between 0.2 and 0.45.
- Build call-and-response: when the main hook is rhythmically active, answering voices should be sparse and enter in its rests. If the groove becomes busier, simplify the melody.
- Use section ranges to make a visible journey. Do not start every voice in bar 1 or let every voice play for the whole song unless the listener explicitly asks for a steady loop.
- For a first arrangement, normally choose kick and bass as support. Use pad only for warm, floating, ambient or background atmosphere.
- Produce a coherent, restrained loop in which the seed's sonic fingerprint remains present, even when the original impact itself is no longer recognizable.
- Treat a new message as a musical revision. Preserve the listener's intent and any strong motifs, but freely remove stale layers, literal hits or voices that work against the new direction. Do not preserve tracks just because the listener did not name them.
- If the listener says they like, love, want to keep or do not want to lose a specific musical idea, preserve that role's event pitches and rhythm exactly unless the new request directly contradicts it. Preserve musical ideas, not arbitrary track count.
- Interpret emotional and scene language musically. For example, "soft beat" implies kick, "deep background" implies bass, "floating/warm" implies a quiet pad, and "sparkle" implies hat or arp.
- Unless explicitly requested, use 3 supporting instruments or fewer, 0-4 literal seed hits in only the selected literal_seed_bars, and 90–118 BPM. Silence is better than filling every step.
- Patterns use 0–15 for one bar. Keep kick at 4 hits or fewer, clap at 2 or fewer, bass at 4 or fewer, pad at 2 or fewer, and never place every layer on the same steps.
- Humanize through authored velocity accents, occasional rests and restrained fills. Keep timing grid-aligned in the plan; the playback engine supplies subtle microtiming.
- Bass should reinforce the current chord root and rhythmic pocket rather than behave like a second unrelated melody. Use 4- or 8-bar sections for clear musical form.
- A pad must be supportive: synth level 0.18–0.38, brightness 0.25–0.55, space 0.6–0.9. Do not make it the loudest layer unless asked.
- Choose harmony from the feeling: minor for dark/emotional/late-night, major for bright/playful, suspended for dreamy/open/cinematic, and percussive when harmony is unwanted.
- progression is a 2-4 root sequence repeated across bars. It must start at 0, stay inside the selected mode, and move gently. Reuse a dependable progression instead of changing harmony every bar at random.
- When pitch confidence is below 0.34, do not treat the detected note as a reliable musical root. Choose a musically suitable key center through event pitches while using the seed only as the timbral source.
- seed_presence is 0–1 and controls only the literal recorded hit. It must be 0 when literal_seed_bars is empty. "Main character", "recognizable", or "bring the click forward" should be at least 0.8 and should reduce competing layer levels.
- arrangement_shape is steady for loops, build for growing energy, and rise_fall for a beginning/middle/ending feel.
- Interpret explicit numbers literally. "Repeat the original hit N times" means exactly N literal foundation positions. Do not assume "beat" means the literal sample when it clearly refers to the whole piece.
- The returned plan must never be silent: at least one of literal_seed_bars, seed_voices or instruments must produce audio. Prefer seed-derived kick and bass as a safe musical foundation when the direction is underspecified.
- If an actual rendered-audio review is present, repair every listed issue. Reduce excessive low energy, harsh high energy, clipping, weak loudness or repetitive bar similarity using notes, velocities, density, levels and space—not by merely rewriting the explanation.
- During a rendered-audio repair pass, preserve bars, BPM, mode, style, literal-seed choice, selected instruments, section boundaries and recognizable motifs. Repair event assignments, velocities, levels and sound design. Never reintroduce the literal hit when the current plan has no literal seed.
- The explanation must plainly say what the listener will hear and what changed. Mention only sounds that exist in the returned arrays, and do not mention schema fields. Use at most two complete sentences and finish under 220 characters.`;

  let upstream: Response;
  try {
    upstream = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
      model: "gpt-5.6-sol",
      reasoning: { effort: "medium" },
      store: false,
      input: [
        { role: "developer", content: [{ type: "input_text", text: "You are the autonomous arrangement director inside SoundSeed. Return only the requested structured plan. The listener describes feelings in vague everyday language; you make all technical production decisions. Every instrument originates from one isolated seed, but no track is mandatory and the literal hit may disappear completely. Plan distinct resynthesized timbres, a restrained timeline and clear musical hierarchy." }] },
        { role: "user", content: [{ type: "input_text", text: prompt }] },
      ],
      text: {
        verbosity: "low",
        format: { type: "json_schema", name: "soundseed_arrangement", strict: true, schema: PLAN_SCHEMA },
      },
      max_output_tokens: 4800,
      }),
    });
  } catch (cause) {
    return Response.json({ error: cause instanceof Error ? `OpenAI network error: ${cause.message}` : "OpenAI network error." }, { status: 502 });
  }

  const payload = await upstream.json() as Record<string, unknown>;
  if (!upstream.ok) {
    const message = typeof (payload.error as { message?: unknown } | undefined)?.message === "string"
      ? (payload.error as { message: string }).message
      : "OpenAI could not create the arrangement.";
    return Response.json({ error: message }, { status: upstream.status });
  }

  const outputText = readOutputText(payload); let draftPlan: Record<string, unknown>;
  try {
    draftPlan = normalizePlanPayload(JSON.parse(outputText) as Record<string, unknown>);
  } catch {
    return Response.json({ error: "The model returned an unreadable arrangement." }, { status: 502 });
  }

  if (body.qualityRevision) {
    const current = body.currentPlan ?? {};
    const currentPatterns = current.patterns && typeof current.patterns === "object" ? current.patterns as Record<string, unknown> : {};
    const draftPatterns = draftPlan.patterns && typeof draftPlan.patterns === "object" ? draftPlan.patterns as Record<string, unknown> : {};
    const currentEvents = current.instrument_events && typeof current.instrument_events === "object" ? current.instrument_events as Record<string, unknown> : {};
    const draftEvents = draftPlan.instrument_events && typeof draftPlan.instrument_events === "object" ? draftPlan.instrument_events as Record<string, unknown> : {};
    const repaired = normalizePlanPayload({
      ...draftPlan,
      bars: current.bars ?? draftPlan.bars,
      bpm: current.bpm ?? draftPlan.bpm,
      musical_mode: current.musical_mode ?? draftPlan.musical_mode,
      arrangement_shape: current.arrangement_shape ?? draftPlan.arrangement_shape,
      progression: current.progression ?? draftPlan.progression,
      sections: current.sections ?? draftPlan.sections,
      style_name: current.style_name ?? draftPlan.style_name,
      seed_repetitions: current.seed_repetitions ?? draftPlan.seed_repetitions,
      literal_seed_bars: current.literal_seed_bars ?? draftPlan.literal_seed_bars,
      seed_presence: current.seed_presence ?? draftPlan.seed_presence,
      instruments: current.instruments ?? draftPlan.instruments,
      patterns: { ...draftPatterns, foundation: currentPatterns.foundation ?? draftPatterns.foundation },
      instrument_events: { ...draftEvents, foundation: currentEvents.foundation ?? draftEvents.foundation },
    });
    return Response.json({ plan: repaired, model: "gpt-5.6-sol", planning: ["render-review"] });
  }

  const specialistPrompt = `Act as the track and mix specialist after an arrangement director.

LISTENER INTENT
${description}

SEED
- note: ${seed.note ?? "unknown"}
- pitch confidence: ${seed.pitchConfidence ?? 0}
- timbre: ${seed.brightness ?? "percussive"}

DIRECTOR PLAN
${JSON.stringify(draftPlan, null, 2)}

RENDERED-AUDIO REVIEW
${renderReview}

QUALITY PASS
- Return the complete plan in the same schema. Preserve the director's musical intent, style, bars, BPM, mode and arrangement shape unless a value is musically invalid. Preserve a voice id only when its role remains useful.
- The director owns the timeline. You own the quality of every track inside it: correct pitch contour, rhythmic placement, speed, density and level while respecting the empty space around other tracks.
- Audit the explicit instrument_events and seed_voice.events, not just the one-bar summary patterns. Ensure notes, chords, durations and velocities form a playable multi-bar performance with a small variation or fill.
- Every sound originates from the isolated seed, but do not make every layer another audible copy of the same hit. The literal foundation and a hook are independently optional; kick, bass and pad are resynthesized from its tonal body; clap and hat reshape its transient.
- Audit every seed voice against the chord roots. Quantize it to the selected pentatonic scale, reuse a short motif, avoid octave ping-pong, and prefer stepwise or small-third motion.
- Enforce call-and-response. Move non-hook steps out of the hook's busiest positions. Never let more than three seed voices dominate the same section.
- Bass must reinforce chord roots and the kick pocket. Pad must be quiet and slow. High sparkle must be brief and sparse. Low pulse must not duplicate the bass rhythm.
- Pad event pitches must form consonant chords with smooth changes. Bass events must use explicit low-register notes and avoid unexplained perfect-fifth hopping. Keep melodic events inside the chosen mode.
- Remove a voice, hook or literal foundation when it adds no distinct role. Do not keep a track merely because it existed in the previous version, and do not add a voice merely to demonstrate complexity.
- Validate that literal_seed_bars is empty whenever seed_repetitions is 0, and that seed_repetitions is 0 whenever literal_seed_bars is empty. Use the exact hit sparingly unless the listener clearly asks to hear it.
- The plan must not be silent: at least one literal seed bar, seed voice or instrument must remain audible.
- When rendered-audio measurements are supplied, correct the reported sonic problems in the returned events, levels and sound design.
- The explanation should describe the audible result in ordinary language, not this review process. Never mention an answering voice, instrument or section that is absent from the returned arrays. Use at most two complete sentences and finish under 220 characters.`;

  try {
    const specialist = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.6-sol",
        reasoning: { effort: "low" },
        store: false,
        input: [
          { role: "developer", content: [{ type: "input_text", text: "You are SoundSeed's senior track and mix specialist. A director has already shaped the song. Correct each seed-derived instrument so the combined result is musical, restrained and collision-free. Return only the full structured plan." }] },
          { role: "user", content: [{ type: "input_text", text: specialistPrompt }] },
        ],
        text: { verbosity: "low", format: { type: "json_schema", name: "soundseed_quality_pass", strict: true, schema: PLAN_SCHEMA } },
        max_output_tokens: 4800,
      }),
    });
    const specialistPayload = await specialist.json() as Record<string, unknown>;
    if (specialist.ok) {
      const polishedText = readOutputText(specialistPayload);
      try { return Response.json({ plan: normalizePlanPayload(JSON.parse(polishedText) as Record<string, unknown>), model: "gpt-5.6-sol", planning: ["director", "track-specialist"] }); } catch { /* use the valid director plan */ }
    }
  } catch { /* use the valid director plan when the optional quality pass is unavailable */ }

  return Response.json({ plan: draftPlan, model: "gpt-5.6-sol", planning: ["director"] });
}
