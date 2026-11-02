import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { callVisionModel } from "./vision.js";

const exec = promisify(execFile);
const root = path.dirname(fileURLToPath(import.meta.url));
const runtimeRoot = path.join(root, "..", ".runtime");
const maxImageBytes = 9 * 1024 * 1024;
const maxAssetBytes = 20 * 1024 * 1024;
const editorialTimeoutMs = 620000;
const allowedMime = new Set(["image/png", "image/jpeg", "image/webp"]);
const planKeys = ["mode", "scene", "title", "subtitle", "facts", "palette", "layout", "motifPrompt"];
const layouts = new Set(["wide", "vertical", "balanced", "sparse"]);
const genericTitle = /\b(?:memory|dream)\b/i;
const forbiddenUrl = /(?:https?:\/\/|www\.|data:image\/|javascript:)/i;
const fail = (message, statusCode = 502) => Object.assign(new Error(message), { statusCode, safe: true });

function cleanText(value, max, message = "编辑计划文本无效，请重试。") {
  if (typeof value !== "string" || value.length > max || forbiddenUrl.test(value) || /[\u0000-\u001f\u007f]/.test(value)) throw fail(message, 400);
  return value.trim();
}

function parseJson(text) {
  if (typeof text !== "string" || text.length > 12000) throw fail("模型没有返回有效的编辑计划，请重试。", 502);
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(cleaned); } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { /* sanitized below */ }
    }
    throw fail("模型没有返回有效的编辑计划，请重试。", 502);
  }
}

function assertHex(value) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

export function validateEditorialPlan(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw fail("编辑计划结构无效，请重试。", 400);
  if (value.mode !== "photo-editorial") throw fail("编辑计划模式无效，请重试。", 400);
  const scene = cleanText(value.scene, 80);
  const title = cleanText(value.title, 64);
  const subtitle = cleanText(value.subtitle, 100);
  const motifPrompt = cleanText(value.motifPrompt, 1800);
  if (!scene || !title || !motifPrompt || !/^[A-Za-z]+(?:[ -][A-Za-z]+){1,4}$/.test(title) || genericTitle.test(title)) {
    throw fail("编辑计划标题或描述无效，请重试。", 400);
  }
  const titleWords = title.match(/[A-Za-z]+/g) || [];
  if (titleWords.length < 2 || titleWords.length > 5) throw fail("编辑计划标题无效，请重试。", 400);
  if (!Array.isArray(value.facts) || value.facts.length < 3 || value.facts.length > 6) throw fail("编辑计划空间事实数量无效，请重试。", 400);
  const facts = value.facts.map(fact => cleanText(fact, 180, "编辑计划空间事实无效，请重试。"));
  if (facts.some(fact => !fact || !/[\u3400-\u9fff]/.test(fact))) throw fail("编辑计划空间事实必须为中文，请重试。", 400);
  if (!Array.isArray(value.palette) || value.palette.length < 3 || value.palette.length > 5 || value.palette.some(color => !assertHex(color))) {
    throw fail("编辑计划颜色结构无效，请重试。", 400);
  }
  const palette = [...new Map(value.palette.map(color => [color.toLowerCase(), color])).values()];
  if (palette.length !== value.palette.length) throw fail("编辑计划颜色必须互不重复，请重试。", 400);
  if (!layouts.has(value.layout)) throw fail("编辑计划布局无效，请重试。", 400);
  return { mode: "photo-editorial", scene, title, subtitle, facts, palette, layout: value.layout, motifPrompt };
}

export function parseEditorialPlan(text) {
  return validateEditorialPlan(parseJson(text));
}

export function decodeEditorialImage(dataUrl) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl || "");
  if (!match || dataUrl.length > 12 * 1024 * 1024) throw fail("请上传有效的 JPG、PNG 或 WebP 图片（压缩后不超过 9 MB）。", 400);
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length || buffer.length > maxImageBytes) throw fail("请上传有效的 JPG、PNG 或 WebP 图片（压缩后不超过 9 MB）。", 400);
  return { mediaType: match[1], buffer };
}

const planPrompt = `You are an editorial image analyst. Study the attached photograph itself and return JSON ONLY, with this exact schema: {"mode":"photo-editorial","scene":"short Chinese scene description","title":"2 to 5 English words","subtitle":"short English subtitle or empty string","facts":["3 to 6 Chinese spatial facts"],"palette":["3 to 5 distinct six-digit hex colors"],"layout":"wide|vertical|balanced|sparse","motifPrompt":"English description of an abstract motif"}. Describe only visible evidence. The facts must cover spatial relationships such as relative size, distance, facing direction, and meaningful negative space when visible; do not invent objects or events. Extract palette colors from the source photograph. Use a specific title of 2 to 5 English words and never use the generic words memory or dream. The motifPrompt must describe the source relationships and a few natural irregular color shapes, with the minimum recognition needed. It must explicitly say to make abstract shapes only, never a complete picture, text, border, photograph, paper texture, grain, or shadow; people and dogs must remain simple silhouettes or abstract marks rather than anatomical illustrations. Return no URLs, data, base64, markdown, or extra keys.`;

export async function analyzeEditorial(imageDataUrl) {
  decodeEditorialImage(imageDataUrl);
  const text = await callVisionModel(imageDataUrl, planPrompt, 1800);
  return parseEditorialPlan(text);
}

function parseCliJson(stdout) {
  if (typeof stdout !== "string" || stdout.length > 256 * 1024) throw fail("本机图形服务返回了无效结果，请稍后重试。", 502);
  const trimmed = stdout.trim();
  try { return JSON.parse(trimmed); } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try { return JSON.parse(trimmed.slice(start, end + 1)); } catch { /* sanitized below */ }
    }
    throw fail("本机图形服务返回了无效结果，请稍后重试。", 502);
  }
}

async function runCli(args, timeoutMs) {
  try {
    return await exec("mcode-tools", args, { timeout: Math.max(1000, timeoutMs), maxBuffer: 512 * 1024, windowsHide: true });
  } catch {
    throw fail("本机图形服务暂时不可用，请稍后重试。", 503);
  }
}

function httpsAssetUrl(value) {
  if (typeof value !== "string" || value.length > 4096) throw fail("本机图形服务返回了无效资源。", 502);
  let parsed;
  try { parsed = new URL(value); } catch { throw fail("本机图形服务返回了无效资源。", 502); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw fail("本机图形服务返回了无效资源。", 502);
  return parsed.toString();
}

function remaining(deadline) {
  const value = deadline - Date.now();
  if (value < 1000) throw fail("图片生成超时，请稍后重试。", 504);
  return value;
}

async function readAsset(response, deadline) {
  if (!response.ok) throw fail("图片生成服务返回了无效图片。", 502);
  const mime = (response.headers.get("content-type") || "").split(";", 1)[0].toLowerCase();
  if (!allowedMime.has(mime)) throw fail("图片生成服务返回了不支持的图片格式。", 502);
  if (!response.body) throw fail("图片生成服务返回了空图片。", 502);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > maxAssetBytes) throw fail("生成图片过大，请稍后重试。", 502);
      chunks.push(Buffer.from(part.value));
      if (Date.now() >= deadline) throw fail("图片生成超时，请稍后重试。", 504);
    }
  } finally {
    try { await reader.cancel(); } catch { /* response already closed */ }
  }
  if (!total) throw fail("图片生成服务返回了空图片。", 502);
  return { mime, buffer: Buffer.concat(chunks, total) };
}

function generationPrompt(plan) {
  const facts = plan.facts.join("; ");
  const colors = plan.palette.join(", ");
  return `Create a minimalist abstract editorial motif inspired by the attached source photograph. Preserve these observed relationships: scene ${plan.scene}; spatial facts ${facts}; palette ${colors}; composition ${plan.layout}. ${plan.motifPrompt} Select only the single most meaningful spatial relationship from these observations. Treat the observations as evidence to select from, not a checklist of objects to draw. Build one primary family of shapes and at most one small environmental accent, with no more than five distinct shapes overall. Express distance and direction through empty space and placement. Omit secondary scenery, foliage clusters, buildings and decorative splashes. The result must be an isolated abstract motif, never a miniature reconstruction of the scene or a complete picture. Use a pure white RGB(255,255,255) background with pure white edges for edge-connected background removal, no border, no text, no photograph, no paper texture, no grain, and no shadow. Place only a small number of natural irregular color shapes in the center and leave a generous safe white margin on every side. Keep recognition minimal; represent people or dogs as simple abstract marks or silhouettes, never anatomical illustrations.`;
}

export async function generateMotif(imageDataUrl, inputPlan) {
  const image = decodeEditorialImage(imageDataUrl);
  const plan = validateEditorialPlan(inputPlan);
  const deadline = Date.now() + editorialTimeoutMs;
  let tempDir;
  try {
    await mkdir(runtimeRoot, { recursive: true });
    tempDir = await mkdtemp(path.join(runtimeRoot, `editorial-${randomUUID()}-`));
    const extension = image.mediaType === "image/jpeg" ? "jpg" : image.mediaType.slice("image/".length);
    const imagePath = path.join(tempDir, `source.${extension}`);
    const argsPath = path.join(tempDir, "args.json");
    await writeFile(imagePath, image.buffer, { mode: 0o600 });
    const upload = parseCliJson((await runCli(["upload_temp_url", imagePath], Math.min(30000, remaining(deadline)))).stdout);
    const tempUrl = httpsAssetUrl(upload?.temp_url);
    const args = { requests: [{ prompt: generationPrompt(plan), input_urls: [tempUrl], aspect_ratio: "4:3", resolution: "1K" }] };
    await writeFile(argsPath, JSON.stringify(args), { mode: 0o600 });
    const generated = parseCliJson((await runCli(["connector", "call", "connector__matrix__generate_image", "--args-file", argsPath], remaining(deadline))).stdout);
    const nodeId = generated?.success_items?.[0]?.node_id;
    if (typeof nodeId !== "string" || !nodeId || nodeId.length > 256) throw fail("图片生成服务未返回图片。", 502);
    const asset = parseCliJson((await runCli(["get_asset_url", nodeId], Math.min(30000, remaining(deadline)))).stdout);
    const assetUrl = httpsAssetUrl(asset?.download_url);
    let response;
    try {
      response = await fetch(assetUrl, { redirect: "error", signal: AbortSignal.timeout(remaining(deadline)) });
    } catch {
      throw fail("无法下载生成图片，请稍后重试。", 504);
    }
    const output = await readAsset(response, deadline);
    return { mode: "photo-editorial", mime: output.mime, dataUrl: `data:${output.mime};base64,${output.buffer.toString("base64")}` };
  } catch (error) {
    if (error?.safe) throw error;
    throw fail("图片生成处理失败，请稍后重试。", 500);
  } finally {
    if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

let healthCache;
export async function editorialHealth() {
  if (healthCache && healthCache.expires > Date.now()) return healthCache.value;
  let value;
  try {
    await runCli(["--help"], 3000);
    value = { configured: true, cli: "available" };
  } catch {
    value = { configured: false, cli: "unavailable" };
  }
  healthCache = { value, expires: Date.now() + 3000 };
  return value;
}
