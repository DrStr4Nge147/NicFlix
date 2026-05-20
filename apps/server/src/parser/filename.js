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

function splitTitleAndYear(input) {
  const normalized = input.replace(/[._]+/g, " ");
  const yearMatches = [...normalized.matchAll(/\b(19|20)\d{2}\b/g)];
  const yearMatch = [...yearMatches].reverse().find((match) => match.index > 0) || null;
  const titlePart = yearMatch
    ? normalized
      .slice(0, yearMatch.index)
      .replace(/[\s._-]*[\[(]\s*$/, "")
      .replace(/[\s._-]+$/, "")
      .trim()
    : normalized;

  return {
    titlePart: titlePart || input,
    year: yearMatch ? Number(yearMatch[0]) : null
  };
}

function parsedTvResult(titleInput, seasonNumber, episodeNumber) {
  const { titlePart, year } = splitTitleAndYear(titleInput);
  return {
    type: "tv",
    title: cleanTitle(titlePart, { stripTrailingEpisode: true }),
    year,
    seasonNumber: Number(seasonNumber),
    episodeNumber: Number(episodeNumber)
  };
}

function parseSeasonFolder(name) {
  const seasonMatch = name.match(/^(?:(?<title>.+?)[\s._-]+)?(?:season|series)[\s._-]*(?<season>\d{1,2})$/i)
    || name.match(/^s(?<season>\d{1,2})$/i);

  if (!seasonMatch?.groups?.season) return null;

  return {
    title: seasonMatch.groups.title || null,
    seasonNumber: Number(seasonMatch.groups.season)
  };
}

function parseUntitledEpisodeCode(input) {
  const codeMatch = input.match(/(?:^|[\s._-]+)s(?<season>\d{1,2})[\s._-]*(?:ep|e)(?<episode>\d{1,3})(?:\D|$)/i)
    || input.match(/(?:^|[\s._-]+)(?<season>\d{1,2})x(?<episode>\d{1,3})(?:\D|$)/i);

  if (!codeMatch?.groups) return null;

  return {
    seasonNumber: Number(codeMatch.groups.season),
    episodeNumber: Number(codeMatch.groups.episode)
  };
}

function parseEpisodeNumberFromName(input) {
  const episodeMatch = input.match(/(?:^|[\s._-]+)(?:episode|ep|e)[\s._-]*(?<episode>\d{1,3})(?:\D|$)/i)
    || input.match(/^(?<episode>\d{1,3})(?:\s*[-._ ]|$)/);

  return episodeMatch?.groups?.episode ? Number(episodeMatch.groups.episode) : null;
}

function parseTvFromFolders(filePath, base) {
  const parts = filePath.split(/[\\/]+/).filter(Boolean);
  const directoryParts = parts.slice(0, -1);
  const seasonDirectory = [...directoryParts].reverse()
    .map((name, reverseIndex) => ({
      index: directoryParts.length - 1 - reverseIndex,
      ...parseSeasonFolder(name)
    }))
    .find((entry) => entry.seasonNumber);

  const untitledCode = parseUntitledEpisodeCode(base);
  const seasonNumber = untitledCode?.seasonNumber || seasonDirectory?.seasonNumber || null;
  const episodeNumber = untitledCode?.episodeNumber || (seasonNumber ? parseEpisodeNumberFromName(base) : null);
  if (!seasonNumber || !episodeNumber) return null;

  const showTitle = seasonDirectory?.title
    || (seasonDirectory ? directoryParts[seasonDirectory.index - 1] : directoryParts.at(-1))
    || null;

  if (!showTitle) return null;

  return parsedTvResult(showTitle, seasonNumber, episodeNumber);
}

export function parseMediaFile(filePath, libraryType) {
  const base = path.basename(filePath, path.extname(filePath));
  const tvPatterns = [
    /^(?<title>.+?)[\s._-]+s(?<season>\d{1,2})[\s._-]*(?:ep|e)(?<episode>\d{1,3})/i,
    /^(?<title>.+?)[\s._-]+(?<season>\d{1,2})x(?<episode>\d{1,3})/i,
    /^(?<title>.+?)[\s._-]+(?:season|series)[\s._-]*(?<season>\d{1,2})[\s._-]+(?:episode|ep|e)[\s._-]*(?<episode>\d{1,3})/i
  ];

  for (const pattern of tvPatterns) {
    const match = base.match(pattern);
    if (match?.groups) {
      return parsedTvResult(match.groups.title, match.groups.season, match.groups.episode);
    }
  }

  if (libraryType === "tv") {
    const folderParsed = parseTvFromFolders(filePath, base);
    if (folderParsed) return folderParsed;
  }

  const { titlePart, year } = splitTitleAndYear(base);

  return {
    type: libraryType === "tv" ? "tv" : "movie",
    title: cleanTitle(titlePart || base, { stripTrailingEpisode: libraryType === "tv" }),
    year,
    seasonNumber: null,
    episodeNumber: null
  };
}
