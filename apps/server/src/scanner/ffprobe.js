import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { dataRoot } from "../config/paths.js";
import { ffprobePath } from "../media/ffmpegTools.js";

function logProbeFailure(filePath, error, stderr) {
  try {
    const logPath = path.join(dataRoot, "ffprobe.log");
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(
      logPath,
      [
        `[${new Date().toISOString()}] ffprobe failed`,
        `ffprobe: ${ffprobePath}`,
        `file: ${filePath}`,
        error ? `error: ${error.message || String(error)}` : null,
        stderr ? `stderr: ${String(stderr).trim()}` : null,
        ""
      ].filter(Boolean).join("\n")
    );
  } catch {
    // Probe logging should never break library scans.
  }
}

function streamLabel(stream, fallback) {
  const language = stream.tags?.language && stream.tags.language !== "und" ? stream.tags.language : null;
  return stream.tags?.title || language || fallback;
}

export function probeFile(filePath) {
  return new Promise((resolve) => {
    try {
      execFile(
        ffprobePath,
        ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", filePath],
        { windowsHide: true, maxBuffer: 1024 * 1024 * 8 },
        (error, stdout, stderr) => {
          if (error || !stdout) {
            logProbeFailure(filePath, error || new Error("ffprobe returned no output"), stderr);
            return resolve({});
          }

          let data;
          try {
            data = JSON.parse(stdout);
          } catch {
            return resolve({});
          }
          const video = data.streams?.find((stream) => stream.codec_type === "video");
          const audio = data.streams?.find((stream) => stream.codec_type === "audio");
          const audioTracks = (data.streams || [])
            .filter((stream) => stream.codec_type === "audio")
            .map((stream, index) => ({
              index: stream.index,
              codec: stream.codec_name || null,
              language: stream.tags?.language || null,
              title: stream.tags?.title || null,
              label: streamLabel(stream, `Audio ${index + 1}`),
              default: stream.disposition?.default === 1
            }));
          const subtitleTracks = (data.streams || [])
            .filter((stream) => stream.codec_type === "subtitle")
            .map((stream, index) => ({
              index: stream.index,
              codec: stream.codec_name || null,
              language: stream.tags?.language || null,
              title: stream.tags?.title || null,
              label: streamLabel(stream, `Subtitle ${index + 1}`),
              default: stream.disposition?.default === 1
            }));

          resolve({
            duration: data.format?.duration || null,
            width: video?.width || null,
            height: video?.height || null,
            videoCodec: video?.codec_name || null,
            audioCodec: audio?.codec_name || null,
            container: data.format?.format_name || null,
            audioTracks,
            subtitleTracks
          });
        }
      );
    } catch {
      resolve({});
    }
  });
}
