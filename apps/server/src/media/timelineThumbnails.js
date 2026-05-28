import fs from "node:fs";
import path from "node:path";
import { thumbnailsRoot } from "../config/paths.js";
import { ffmpeg } from "./ffmpegTools.js";

const VERSION = 2;
const THUMB_WIDTH = 160;
const THUMB_HEIGHT = 90;
const SHEET_COLUMNS = 5;
const SHEET_ROWS = 5;
const FRAMES_PER_SHEET = SHEET_COLUMNS * SHEET_ROWS;
const MAX_FRAMES = 360;

const jobs = new Map();

function numericFileId(file) {
  const id = Number(file?.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function durationSeconds(file) {
  const duration = Number(file?.duration);
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

function cacheKey(file) {
  return [
    VERSION,
    file.id,
    file.file_size || 0,
    file.modified_at || "",
    Math.round(durationSeconds(file))
  ].join(":");
}

function cacheDir(file) {
  return path.join(thumbnailsRoot, String(file.id));
}

function manifestPath(file) {
  return path.join(cacheDir(file), "manifest.json");
}

function publicSheetUrl(fileId, sheetName, key) {
  return `/assets/thumbnails/${fileId}/${sheetName}?v=${encodeURIComponent(key)}`;
}

function previewInterval(duration) {
  const preferred = duration <= 20 * 60 ? 10 : 20;
  const capped = Math.ceil(duration / MAX_FRAMES / 5) * 5;
  return Math.max(preferred, capped || preferred);
}

function expectedFrameCount(duration, interval) {
  if (!duration || !interval) return 0;
  return Math.max(1, Math.min(MAX_FRAMES, Math.floor(duration / interval) + 1));
}

async function readManifest(file, options = {}) {
  try {
    const manifest = JSON.parse(await fs.promises.readFile(manifestPath(file), "utf8"));
    if (manifest.cacheKey !== cacheKey(file)) return null;
    if (manifest.status !== "ready") return options.includePending ? manifest : null;

    const sheets = new Set(manifest.thumbnails.map((item) => item.sheet));
    for (const sheet of sheets) {
      await fs.promises.access(path.join(cacheDir(file), sheet), fs.constants.R_OK);
    }
    return manifest;
  } catch {
    return null;
  }
}

async function writeManifest(file, manifest) {
  await fs.promises.mkdir(cacheDir(file), { recursive: true });
  await fs.promises.writeFile(manifestPath(file), JSON.stringify(manifest, null, 2));
}

async function resetCache(file) {
  await fs.promises.rm(cacheDir(file), { recursive: true, force: true });
  await fs.promises.mkdir(cacheDir(file), { recursive: true });
}

function buildManifest(file, sheets) {
  const duration = durationSeconds(file);
  const interval = previewInterval(duration);
  const key = cacheKey(file);
  const frameCount = Math.min(expectedFrameCount(duration, interval), sheets.length * FRAMES_PER_SHEET);
  const sheetWidth = THUMB_WIDTH * SHEET_COLUMNS;
  const sheetHeight = THUMB_HEIGHT * SHEET_ROWS;

  return {
    status: "ready",
    cacheKey: key,
    generatedAt: new Date().toISOString(),
    interval,
    width: THUMB_WIDTH,
    height: THUMB_HEIGHT,
    thumbnails: Array.from({ length: frameCount }, (_, index) => {
      const sheetIndex = Math.floor(index / FRAMES_PER_SHEET);
      const cellIndex = index % FRAMES_PER_SHEET;
      const column = cellIndex % SHEET_COLUMNS;
      const row = Math.floor(cellIndex / SHEET_COLUMNS);
      const sheet = sheets[sheetIndex];

      return {
        time: Math.min(duration, index * interval),
        src: publicSheetUrl(file.id, sheet, key),
        sheet,
        x: column * THUMB_WIDTH,
        y: row * THUMB_HEIGHT,
        width: THUMB_WIDTH,
        height: THUMB_HEIGHT,
        sheetWidth,
        sheetHeight
      };
    })
  };
}

async function buildPartialManifest(file) {
  const sheets = await generatedSheets(file);
  if (!sheets.length) return null;
  return {
    ...buildManifest(file, sheets),
    status: "generating"
  };
}

function runFfmpeg(file, interval) {
  const outputPattern = path.join(cacheDir(file), "sheet-%03d.jpg");
  const filter = [
    `fps=1/${interval}`,
    `scale=${THUMB_WIDTH}:${THUMB_HEIGHT}:force_original_aspect_ratio=decrease`,
    `pad=${THUMB_WIDTH}:${THUMB_HEIGHT}:(ow-iw)/2:(oh-ih)/2`,
    `tile=${SHEET_COLUMNS}x${SHEET_ROWS}`
  ].join(",");

  return new Promise((resolve, reject) => {
    ffmpeg(file.file_path)
      .outputOptions([
        "-vf", filter,
        "-q:v", "5",
        "-an",
        "-sn",
        "-dn",
        "-threads", "1",
        "-vsync", "0"
      ])
      .output(outputPattern)
      .on("end", resolve)
      .on("error", reject)
      .run();
  });
}

async function generatedSheets(file) {
  const entries = await fs.promises.readdir(cacheDir(file), { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /^sheet-\d{3}\.jpg$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

async function generateThumbnails(file) {
  await resetCache(file);
  const duration = durationSeconds(file);
  const interval = previewInterval(duration);
  await writeManifest(file, {
    status: "generating",
    cacheKey: cacheKey(file),
    generatedAt: new Date().toISOString(),
    interval,
    width: THUMB_WIDTH,
    height: THUMB_HEIGHT,
    thumbnails: []
  });

  await runFfmpeg(file, interval);
  const sheets = await generatedSheets(file);
  if (!sheets.length) throw new Error("No timeline thumbnails were generated.");

  const manifest = buildManifest(file, sheets);
  await writeManifest(file, manifest);
  return manifest;
}

function startGeneration(file) {
  const id = numericFileId(file);
  if (!id) return null;
  const existing = jobs.get(id);
  if (existing) return existing;

  const job = generateThumbnails(file)
    .catch(async (error) => {
      await writeManifest(file, {
        status: "unavailable",
        cacheKey: cacheKey(file),
        generatedAt: new Date().toISOString(),
        interval: previewInterval(durationSeconds(file)),
        width: THUMB_WIDTH,
        height: THUMB_HEIGHT,
        thumbnails: []
      }).catch(() => {});
      throw error;
    })
    .finally(() => {
      jobs.delete(id);
    });
  jobs.set(id, job);
  return job;
}

export async function getTimelineThumbnails(file) {
  const id = numericFileId(file);
  const duration = durationSeconds(file);
  if (!id || !duration || !file?.file_path || !fs.existsSync(file.file_path)) {
    return { status: "unavailable", interval: 0, width: THUMB_WIDTH, height: THUMB_HEIGHT, thumbnails: [] };
  }

  const manifest = await readManifest(file, { includePending: true });
  if (manifest?.status === "ready" || manifest?.status === "unavailable") return manifest;
  if (manifest?.status === "generating" && jobs.has(id)) {
    return await buildPartialManifest(file) || manifest;
  }

  const partialManifest = manifest?.status === "generating" ? await buildPartialManifest(file) : null;
  startGeneration(file)?.catch((error) => {
    console.error(`Timeline thumbnail generation failed for file ${id}:`, error.message);
  });

  return partialManifest || {
    status: "generating",
    interval: previewInterval(duration),
    width: THUMB_WIDTH,
    height: THUMB_HEIGHT,
    thumbnails: []
  };
}
