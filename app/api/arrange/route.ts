import { env } from "cloudflare:workers";

type PlannerRequest = {
  description?: string;
  seed?: { note?: string; bpm?: number; brightness?: string; detectedHits?: number };
};

const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["bars", "seed_repetitions", "bpm", "groove", "synth_shape", "instruments", "patterns", "explanation"],
  properties: {
    bars: { type: "integer", minimum: 1, maximum: 8 },
    seed_repetitions: { type: "integer", minimum: 1, maximum: 12 },
    bpm: { type: "integer", minimum: 60, maximum: 160 },
    groove: { type: "string", enum: ["straight", "pocket", "sparse"] },
    synth_shape: { type: "string", enum: ["pluck", "pad", "arp"] },
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
    explanation: { type: "string", minLength: 20, maxLength: 260 },
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
  const prompt = `Create a compact musical loop plan from the user's description.

Seed facts:
- detected note: ${seed.note ?? "unknown"}
- natural tempo estimate: ${seed.bpm ?? 100} BPM
- timbre: ${seed.brightness ?? "percussive"}
- impacts in raw recording: ${seed.detectedHits ?? 1}

User description:
${description}

Interpret numbers literally when stated. "Repeat the beat N times" means seed_repetitions=N and the foundation pattern must contain exactly N unique steps. If the user omits a value, make a musically sensible choice. Patterns are one bar of sixteen 16th-note steps numbered 0–15 and repeat across the requested bars. Every requested instrument must receive a complementary pattern; unrequested instruments must use an empty pattern. Keep the isolated seed audible and avoid overcrowding. The explanation must state why the repetition count, tempo, and layering fit the request.`;

  let upstream: Response;
  try {
    upstream = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
      model: "gpt-5.6-sol",
      reasoning: { effort: "low" },
      store: false,
      input: [
        { role: "developer", content: [{ type: "input_text", text: "You are the arrangement planner inside SoundSeed. Return only the requested structured plan. All instruments are derived from one isolated recorded impact; never suggest stock samples or unrelated audio." }] },
        { role: "user", content: [{ type: "input_text", text: prompt }] },
      ],
      text: {
        verbosity: "low",
        format: { type: "json_schema", name: "soundseed_arrangement", strict: true, schema: PLAN_SCHEMA },
      },
      max_output_tokens: 900,
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

  const outputText = readOutputText(payload);
  try {
    return Response.json({ plan: JSON.parse(outputText), model: "gpt-5.6-sol" });
  } catch {
    return Response.json({ error: "The model returned an unreadable arrangement." }, { status: 502 });
  }
}
