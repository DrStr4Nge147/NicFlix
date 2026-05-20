import path from "node:path";

const releaseTags = [
  "2160p", "1080p", "720p", "480p", "4k", "bluray", "brrip", "webrip",
  "web-dl", "webdl", "hdrip", "dvdrip", "x264", "x265", "h264", "h265",
  "hevc", "aac", "dts", "yify", "rarbg", "repack", "proper", "extended"
];

function cleanTitle(input, { stripTrailingEpisode = false } = {}) {
  const tagPattern = new RegExp(`\\b(${releaseTags.map(escapeRegExp).join("|")})\\b`, "ig");
  const cleaned = input
    .replace(/[._]+/g, " ")
    .replace(/\s+-\s+/g, " ")
    .replace(tagPattern, " ")
    .replace(/\[[^\]]*]/g, " ")
    .replace(/\s{2,}/g, " ");

  return (stripTrailingEpisode
    ? cleaned
      .replace(/\b(episode|ep)\s*\d{1,3}\b/ig, " ")
      .replace(/\s+\d{1,3}\s*$/g, " ")
    : cleaned
  ).replace(/\s{2,}/g, " ").trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function parseMediaFile(filePath, libraryType) {
  const base = path.basename(filePath, path.extname(filePath));
  const tvPatterns = [
    /^(?<title>.+?)[\s._-]+s(?<season>\d{1,2})e(?<episode>\d{1,3})/i,
    /^(?<title>.+?)[\s._-]+(?<season>\d{1,2})x(?<episode>\d{1,3})/i
  ];

  for (const pattern of tvPatterns) {
    const match = base.match(pattern);
    if (match?.groups) {
      return {
        type: "tv",
        title: cleanTitle(match.groups.title, { stripTrailingEpisode: true }),
        seasonNumber: Number(match.groups.season),
        episodeNumber: Number(match.groups.episode)
      };
    }
  }

  const normalizedBase = base.replace(/[._]+/g, " ");
  const yearMatches = [...normalizedBase.matchAll(/\b(19|20)\d{2}\b/g)];
  const yearMatch = [...yearMatches].reverse().find((match) => match.index > 0) || null;
  const titlePart = yearMatch ? normalizedBase.slice(0, yearMatch.index).trim() : normalizedBase;

  return {
    type: libraryType === "tv" ? "tv" : "movie",
    title: cleanTitle(titlePart || base, { stripTrailingEpisode: libraryType === "tv" }),
    year: yearMatch ? Number(yearMatch[0]) : null,
    seasonNumber: null,
    episodeNumber: null
  };
}
