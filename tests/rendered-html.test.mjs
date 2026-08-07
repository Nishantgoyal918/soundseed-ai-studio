import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the SoundSeed capture experience", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>SoundSeed/i);
  assert.match(html, /Find the one/);
  assert.match(html, /Record impacts/);
  assert.match(html, /accept="audio\/\*"/);
  assert.match(html, /One captured sound becomes every instrument/);
  assert.doesNotMatch(html, /Your site is taking shape|OPENAI_API_KEY/);
});

test("keeps note planning and rendered-audio review in the app contract", async () => {
  const [studio, planner] = await Promise.all([
    readFile(new URL("../app/BeatFoundry.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/arrange/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(studio, /AI NOTE COMPOSER/);
  assert.match(studio, /AI NOTE-EVENT TIMELINE/);
  assert.match(studio, /reviewRenderedAudio/);
  assert.match(studio, /qualityRevision:\s*true/);
  assert.doesNotMatch(studio, /className="pitch-slider"/);

  assert.match(planner, /instrument_events/);
  assert.match(planner, /seed_voice\.events/);
  assert.match(planner, /render-review/);
  assert.match(planner, /clampEvents/);
});
