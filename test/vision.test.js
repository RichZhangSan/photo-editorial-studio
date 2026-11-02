import test from "node:test";
import assert from "node:assert/strict";

process.env.COLLAGE_API_BASE_URL = "https://model.example.invalid/v1";
process.env.COLLAGE_API_KEY = "unit-test-value";
process.env.COLLAGE_MODEL = "vision-test-model";
process.env.COLLAGE_PROVIDER = "mock-provider";

const { parsePosterPlan, segmentImage } = await import(`../lib/vision.js?test=${Date.now()}`);

const plan = {
  scene: "傍晚的公路与路灯",
  title: "THE LONG WAY HOME",
  subtitle: "A ROAD UNDER OPEN SKY",
  palette: { paper: "#efe6d2", sky: "#3e6fa4", ink: "#252824", accent: "#d5523e", cloud: "#f7f0df", road: "#87909a" },
  colors: ["#efe6d2", "#3e6fa4", "#252824", "#d5523e", "#f7f0df", "#87909a"]
};

test("accepts the photo poster protocol and fenced JSON", () => {
  const fenced = "```json\n" + JSON.stringify(plan) + "\n```";
  const parsed = parsePosterPlan(fenced);
  assert.equal(parsed.mode, "photo-poster");
  assert.deepEqual(parsed.colors, plan.colors);
  assert.deepEqual(parsed.palette, plan.palette);
  assert.equal(parsed.title, "THE LONG WAY HOME");
  assert.equal(parsed.provider, "mock-provider");
  assert.equal(parsed.model, "vision-test-model");
  assert.equal("layers" in parsed, false);
  assert.equal("composition" in parsed, false);
});

test("derives deduplicated colors from the six-key palette when omitted", () => {
  const withoutColors = { ...plan, palette: { ...plan.palette, road: plan.palette.ink } };
  delete withoutColors.colors;
  const parsed = parsePosterPlan(JSON.stringify(withoutColors));
  assert.equal(parsed.colors.length, 5);
  assert.equal(new Set(parsed.colors.map(color => color.toLowerCase())).size, 5);
});

test("rejects invalid poster data and requires a scene or title", () => {
  for (const text of [
    "plain text",
    "{}",
    JSON.stringify({ palette: plan.palette }),
    JSON.stringify({ scene: plan.scene, colors: ["#000000", "bad", "#111111", "#222222", "#333333"] }),
    JSON.stringify({ scene: plan.scene, colors: [["#000000"], "#ffffff", "#111111", "#222222", "#333333"] }),
    JSON.stringify({ scene: plan.scene, colors: ["#000000", "#111111", "#222222", "#333333"] }),
    JSON.stringify({ scene: plan.scene, colors: ["#000000", "#000000", "#000000", "#000000", "#000000"] })
  ]) assert.throws(() => parsePosterPlan(text));
});

test("invalid image never reaches upstream", async () => {
  await assert.rejects(segmentImage("https://example.com/photo.png"), error => error.statusCode === 400);
});

test("uses environment configuration and returns only safe poster data", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    const body = JSON.parse(init.body);
    assert.equal(body.model, "vision-test-model");
    assert.equal(body.max_tokens, 1800);
    assert.equal(body.stream, true);
    assert.equal(body.messages[0].content[0].source.type, "base64");
    assert.equal(body.messages[0].content[0].source.media_type, "image/png");
    assert.equal(init.headers["x-api-key"], "unit-test-value");
    const prompt = body.messages[0].content[1].text;
    assert.match(prompt, /white clothing stays white or warm white/);
    assert.match(prompt, /black dog stays neutral black/);
    assert.match(prompt, /never shift neutral colors toward green/);
    assert.doesNotMatch(prompt, /"layers"|"composition"/i);
    const text = JSON.stringify(plan);
    return new Response([
      `event: message_start\ndata: ${JSON.stringify({ type: "message_start" })}\n\n`,
      `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text } })}\n\n`,
      `event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" } })}\n\n`
    ].join(""), { headers: { "content-type": "text/event-stream" } });
  };
  try {
    const result = await segmentImage("data:image/png;base64,AAAA");
    assert.equal(calls, 1);
    assert.deepEqual(Object.keys(result).sort(), ["colors", "mode", "model", "palette", "provider", "scene", "subtitle", "title"]);
    assert.deepEqual(result.colors, plan.colors);
    assert.equal(result.mode, "photo-poster");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("upstream failure does not leak raw error body", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("raw-upstream-details", { status: 401 });
  try {
    await assert.rejects(segmentImage("data:image/png;base64,AAAA"), error => error.message.includes("401") && !error.message.includes("raw-upstream-details"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
