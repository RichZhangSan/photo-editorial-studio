const fail = (message, statusCode = 502) => Object.assign(new Error(message), { statusCode, safe: true });
const providerName = () => process.env.COLLAGE_PROVIDER?.trim() || "custom";
const modelName = () => process.env.COLLAGE_MODEL?.trim() || "not configured";
const paletteNames = ["paper", "sky", "ink", "accent", "cloud", "road"];
const hex = { test: value => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) };

async function readAnthropicStream(response) {
  const raw = await response.text();
  let text = "";
  let stopReason;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    let event;
    try { event = JSON.parse(payload); } catch { continue; }
    if (event.type === "error") throw fail("自定义模型返回了流式错误，请检查模型可用性与图片输入支持。");
    if (event.type === "content_block_delta" && event.delta?.type === "text_delta") text += event.delta.text || "";
    if (event.type === "message_delta") stopReason = event.delta?.stop_reason;
  }
  if (!text) throw fail("自定义模型没有返回海报设计数据，请重试。");
  return { text, stopReason };
}

// The public project reads only these environment variables. It never reads a
// local agent configuration file or writes credentials to responses or logs.
export async function configuration() {
  const baseURL = process.env.COLLAGE_API_BASE_URL?.trim();
  const apiKey = process.env.COLLAGE_API_KEY?.trim();
  const model = process.env.COLLAGE_MODEL?.trim();
  if (!baseURL || !apiKey || !model) {
    throw fail("视觉模型服务未配置，请设置 COLLAGE_API_BASE_URL、COLLAGE_API_KEY 和 COLLAGE_MODEL。", 503);
  }
  if (apiKey.length > 4096 || model.length > 200) {
    throw fail("视觉模型配置长度无效，请检查环境变量。", 503);
  }
  let base;
  try {
    base = new URL(baseURL);
  } catch {
    throw fail("视觉模型服务地址无效，请检查 COLLAGE_API_BASE_URL。", 503);
  }
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) {
    throw fail("视觉模型服务地址无效，请使用不含账号密码的 HTTP(S) 地址。", 503);
  }
  base.pathname = base.pathname.replace(/\/+$/, "");
  if (!base.pathname || base.pathname === "/") base.pathname = "/v1";
  return { baseURL: base.toString().replace(/\/$/, ""), apiKey, model, provider: providerName() };
}

export async function health() {
  const { editorialHealth } = await import("./editorial-image.js");
  const editorial = await editorialHealth();
  try {
    const config = await configuration();
    return { configured: true, provider: config.provider, model: config.model, mode: "photo-poster", editorial };
  } catch (error) {
    return { configured: false, provider: providerName(), model: modelName(), mode: "photo-poster", editorial, error: error.message };
  }
}

function parseJson(text) {
  if (typeof text !== "string") throw fail("模型没有返回有效的海报设计数据，请重试。");
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(cleaned); } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { /* handled below */ }
    }
    throw fail("模型没有返回有效的海报设计数据，请重试。");
  }
}

function safeText(value, fallback, max = 80) {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f]/g, "").trim().slice(0, max) || fallback : fallback;
}

export function parsePosterPlan(text) {
  const data = parseJson(text);
  if (!data || typeof data !== "object" || Array.isArray(data)) throw fail("模型海报结构无效，请重试。");

  const sceneInput = safeText(data.scene, "", 80);
  const titleInput = safeText(data.title, "", 56);
  if (!sceneInput && !titleInput) throw fail("模型海报结构无效，请重试。");

  const paletteInput = data.palette && typeof data.palette === "object" ? data.palette : {};
  const defaults = {
    paper: "#efe6d2",
    sky: "#3e6fa4",
    ink: "#252824",
    accent: "#d5523e",
    cloud: "#f7f0df",
    road: "#87909a"
  };
  const palette = Object.fromEntries(paletteNames.map(name => [name, hex.test(paletteInput[name]) ? paletteInput[name] : defaults[name]]));

  let colors;
  if (data.colors === undefined) {
    colors = [...new Map(paletteNames.map(name => [palette[name].toLowerCase(), palette[name]])).values()];
  } else {
    if (!Array.isArray(data.colors) || data.colors.length < 5 || data.colors.length > 9 || !data.colors.every(color => hex.test(color))) {
      throw fail("模型海报颜色结构无效，请重试。");
    }
    colors = [...new Map(data.colors.map(color => [color.toLowerCase(), color])).values()];
    if (colors.length < 5) throw fail("模型海报颜色数量不足，请重试。");
  }

  const scene = sceneInput || "场景海报";
  const title = (titleInput || "THE LONG WAY HOME").toUpperCase();
  const subtitle = safeText(data.subtitle, sceneInput || "A STUDY OF PLACE", 80).toUpperCase();
  return {
    scene,
    title,
    subtitle,
    palette,
    colors,
    provider: providerName(),
    model: modelName(),
    mode: "photo-poster"
  };
}

export async function callVisionModel(imageDataUrl, prompt, maxTokens = 1800) {
  const image = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(imageDataUrl || "");
  if (!image || imageDataUrl.length > 12 * 1024 * 1024) throw fail("请上传有效的 JPG、PNG 或 WebP 图片（压缩后不超过 9 MB）。", 400);
  const config = await configuration();
  let response;
  try {
    response = await fetch(`${config.baseURL.replace(/\/$/, "")}/messages`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(150000),
      headers: {
        "Content-Type": "application/json",
        accept: "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({ model: config.model, max_tokens: maxTokens, stream: true, messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: image[1], data: image[2] } },
        { type: "text", text: prompt }
      ] }] })
    });
  } catch (error) {
    throw fail(error.name === "TimeoutError" ? "模型识别超时，请稍后重试。" : "无法连接视觉模型服务，请检查网络或供应商状态。", 504);
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw fail(`视觉模型服务返回 HTTP ${response.status}。${[401, 403].includes(response.status) ? "请检查 API Key 和模型授权。" : response.status === 429 ? "请求受限，请稍后重试。" : "请检查模型可用性与图片输入支持。"}`);
  }
  let stream;
  try { stream = await readAnthropicStream(response); } catch (error) {
    if (error.statusCode) throw error;
    throw fail("自定义模型返回了无法解析的流式响应。");
  }
  if (stream.stopReason === "max_tokens") throw fail("模型海报设计响应被截断，请重试。");
  return stream.text;
}

export async function segmentImage(imageDataUrl) {
  const prompt = `You are designing a minimalist screen-print photo poster from the attached photograph. Analyze the entire scene and return JSON ONLY, with no markdown or explanation, using exactly this schema: {"scene":"short Chinese scene description","title":"short English poster title","subtitle":"short English subtitle","palette":{"paper":"#rrggbb","sky":"#rrggbb","ink":"#rrggbb","accent":"#rrggbb","cloud":"#rrggbb","road":"#rrggbb"},"colors":["#rrggbb","#rrggbb","#rrggbb","#rrggbb","#rrggbb"]}. Return 5-9 distinct six-digit hex colors in colors. Do not return layers, composition, coordinates, polygons, masks, or any other fields. Preserve the original color relationships: white clothing stays white or warm white; a black dog stays neutral black; never shift neutral colors toward green; preserve skin tones as a separate color family. Use a restrained palette with no gradients, shadows, transparency, URLs, base64, or explanations outside JSON.`;
  const text = await callVisionModel(imageDataUrl, prompt, 1800);
  return parsePosterPlan(text);
}
