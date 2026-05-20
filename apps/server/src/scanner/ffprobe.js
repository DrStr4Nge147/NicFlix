import { execFile } from "node:child_process";

function streamLabel(stream, fallback) {
  const language = stream.tags?.language && stream.tags.language !== "und" ? stream.tags.language : null;
  return stream.tags?.title || language || fallback;
}

export function probeFile(filePath) {
  return new Promise((resolve) => {
    try {
      execFile(
        "ffprobe",
        ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", filePath],
        { windowsHide: true, maxBuffer: 1024 * 1024 * 8 },
        (error, stdout) => {
          if (error || !stdout) return resolve({});

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
