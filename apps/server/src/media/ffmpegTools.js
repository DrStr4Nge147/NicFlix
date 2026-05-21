import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ffmpeg from "fluent-ffmpeg";

const require = createRequire(import.meta.url);

function existingPath(value) {
  return value && fs.existsSync(value) ? value : null;
}

function resolvePackagePath(packageName, accessor = (moduleValue) => moduleValue) {
  try {
    return existingPath(accessor(require(packageName)));
  } catch {
    return null;
  }
}

function resolveResourcePath(fileName) {
  return existingPath(process.resourcesPath && path.join(process.resourcesPath, "bin", fileName));
}

export const ffmpegPath =
  existingPath(process.env.FFMPEG_PATH)
  || resolveResourcePath(process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg")
  || resolvePackagePath("ffmpeg-static")
  || "ffmpeg";

export const ffprobePath =
  existingPath(process.env.FFPROBE_PATH)
  || resolveResourcePath(process.platform === "win32" ? "ffprobe.exe" : "ffprobe")
  || resolvePackagePath("ffprobe-static", (moduleValue) => moduleValue.path)
  || "ffprobe";

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

export { ffmpeg };
