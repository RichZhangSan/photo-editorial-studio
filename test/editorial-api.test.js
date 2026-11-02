import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { generateMotif, parseEditorialPlan, validateEditorialPlan } from "../lib/editorial-image.js";

const plan = {
  mode: "photo-editorial",
  scene: "一条道路穿过开阔草地",
  title: "Open Road Study",
  subtitle: "A quiet line across the field",
  facts: [
    "道路占据画面下半部并向远处收窄",
    "远处树线与道路保持较长距离",
    "道路方向由前景朝向画面中央",
    "天空留下大面积连续负空间"
  ],
  palette: ["#d8d2c4", "#6f8060", "#3b4438", "#b27f53"],
  layout: "wide",
  motifPrompt: "Use one low horizontal path shape, a distant narrow tree line, and a large open field of white space; keep the directional relationship and scale contrast visible through restrained abstract marks."
};

const image = "data:image/png;base64,AAAA";

test("editorial plan is strict, normalized, and has the fixed response shape", () => {
  const parsed = parseEditorialPlan(JSON.stringify(plan));
  assert.deepEqual(parsed, plan);
  assert.deepEqual(Object.keys(parsed).sort(), ["facts", "layout", "mode", "motifPrompt", "palette", "scene", "subtitle", "title"]);
  assert.throws(() => validateEditorialPlan({ ...plan, title: "A dream memory" }));
  assert.throws(() => validateEditorialPlan({ ...plan, motifPrompt: "https://example.invalid/private" }));
  assert.throws(() => validateEditorialPlan({ ...plan, facts: ["only one fact"] }));
});

test("unknown CLI failures are safe for callers and do not expose native details", async () => {
  const binDir = await mkdtemp(path.join(tmpdir(), "pixel-editorial-cli-"));
  const fake = path.join(binDir, "mcode-tools");
  const originalPath = process.env.PATH;
  await writeFile(fake, "#!/bin/sh\nprintf 'private native detail /tmp/editorial-secret' >&2\nexit 1\n");
  await chmod(fake, 0o755);
  process.env.PATH = `${binDir}:${originalPath || ""}`;
  try {
    await assert.rejects(generateMotif(image, plan), error => {
      assert.equal(error.safe, true);
      assert.equal(error.statusCode, 503);
      assert.doesNotMatch(error.message, /private|editorial-secret|tmp/);
      return true;
    });
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    await rm(binDir, { recursive: true, force: true });
  }
});
