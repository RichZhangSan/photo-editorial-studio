import "./lib/load-env.js";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { segmentImage, health } from "./lib/vision.js";
import { analyzeEditorial, generateMotif, validateEditorialPlan } from "./lib/editorial-image.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, "public");
const port = Number(process.env.PORT || 8787);
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon"
};

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 16 * 1024 * 1024) {
        reject(Object.assign(new Error("图片请求过大，请先压缩图片。"), { statusCode: 413, safe: true }));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(Object.assign(new Error("请求格式不是有效 JSON。"), { statusCode: 400, safe: true }));
      }
    });
    req.on("error", reject);
  });
}

let busy = false;
async function handleApi(req, res, url) {
  if (req.method === "OPTIONS") {
    json(res, 403, { error: "仅支持本机页面的同源请求。" });
    return true;
  }
  if (url.pathname === "/api/health" && req.method === "GET") {
    json(res, 200, await health());
    return true;
  }
  const isCollage = url.pathname === "/api/collage";
  const isEditorialPlan = url.pathname === "/api/editorial/plan";
  const isEditorialMotif = url.pathname === "/api/editorial/motif";
  if (!isCollage && !isEditorialPlan && !isEditorialMotif) return false;
  if (req.method !== "POST") {
    json(res, 405, { error: `只支持 POST ${url.pathname}` });
    return true;
  }
  if ((req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) || req.headers["sec-fetch-site"] === "cross-site") {
    json(res, 403, { error: "仅支持本机页面的同源请求。" });
    return true;
  }
  if (!req.headers["content-type"]?.startsWith("application/json")) {
    json(res, 415, { error: "需要 application/json 请求。" });
    return true;
  }
  if (busy) {
    json(res, 429, { error: "已有图片正在处理，请等待完成。" });
    return true;
  }
  busy = true;
  try {
    const body = await readBody(req);
    if (typeof body.image !== "string" || !body.image.startsWith("data:image/")) {
      throw Object.assign(new Error("请上传有效的图片。"), { statusCode: 400, safe: true });
    }
    let result;
    if (isCollage) result = await segmentImage(body.image);
    else if (isEditorialPlan) result = await analyzeEditorial(body.image);
    else {
      validateEditorialPlan(body.plan);
      result = await generateMotif(body.image, body.plan);
    }
    json(res, 200, result);
  } catch (error) {
    const safe = error?.safe === true;
    json(res, safe ? (error.statusCode || 500) : 500, { error: safe ? error.message : "服务器处理失败。" });
  } finally {
    busy = false;
  }
  return true;
}

function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  const filePath = path.normalize(path.join(publicDir, pathname));
  const relativePath = path.relative(publicDir, filePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    json(res, 403, { error: "Forbidden" });
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      if (pathname !== "/index.html") {
        res.statusCode = 404;
        res.end("Not found");
      } else {
        res.statusCode = 500;
        res.end("Missing public/index.html");
      }
      return;
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", mime[path.extname(filePath)] || "application/octet-stream");
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(req.headers.host)) {
      json(res, 403, { error: "仅支持本机访问。" });
      return;
    }
    const url = new URL(req.url, `http://${req.headers.host}`);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (url.pathname.startsWith("/api/")) {
      const handled = await handleApi(req, res, url);
      if (!handled) json(res, 404, { error: "接口不存在。" });
      return;
    }
    serveStatic(req, res, url);
  } catch {
    if (!res.headersSent) json(res, 400, { error: "无效请求。" });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Photo Editorial Studio running at http://127.0.0.1:${port}`);
});
