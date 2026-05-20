import axios from "axios";
import fs from "node:fs";
import path from "node:path";
import { backdropsRoot, postersRoot } from "../config/paths.js";
import { getTmdbApiKey } from "../config/appConfig.js";

const client = axios.create({
  baseURL: "https://api.themoviedb.org/3",
  timeout: 10000
});

export function hasTmdbKey() {
  const apiKey = getTmdbApiKey();
  return Boolean(apiKey && apiKey !== "your_tmdb_api_key_here");
}

function isTmdbNotFound(error) {
  return error.response?.status === 404;
}

async function tmdbGet(url, params = {}, options = {}) {
  if (!hasTmdbKey()) return null;
  const apiKey = getTmdbApiKey();
  try {
    const response = await client.get(url, { params: { api_key: apiKey, ...params } });
    return response.data;
  } catch (error) {
    if (options.allowNotFound && isTmdbNotFound(error)) return null;
    throw error;
  }
}

export async function testTmdbApiKey(apiKey = getTmdbApiKey()) {
  const candidate = String(apiKey || "").trim();
  if (!candidate || candidate === "your_tmdb_api_key_here") {
    return { ok: false, message: "Enter your TMDB API key first." };
  }

  try {
    await client.get("/configuration", { params: { api_key: candidate } });
    return { ok: true, message: "TMDB connected successfully." };
  } catch (error) {
    const tmdbMessage = error.response?.data?.status_message;
    return {
      ok: false,
      message: tmdbMessage || "TMDB rejected that key. Check that you copied the v3 API Key exactly."
    };
  }
}

function uniqueValues(values) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeComparableTitle(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(the|a|an)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function tmdbQueryVariants(title) {
  const withoutBrackets = title.replace(/\[[^\]]*]/g, " ");
  const withoutParentheses = title.replace(/\([^)]*\)/g, " ");
  const withoutYear = title.replace(/\b(19|20)\d{2}\b/g, " ");
  const withoutEpisodeCode = title.replace(/\b(s\d{1,2}e\d{1,3}|\d{1,2}x\d{1,3})\b/ig, " ");
  const withoutTrailingEpisode = title.replace(/\s*[-._ ]+\d{1,3}\s*$/g, " ");
  const beforeDashEpisode = title.replace(/\s+-\s+(episode\s+)?\d{1,3}\b.*$/i, " ");
  const beforeDashSeason = title.replace(/\s+-\s+(season|part)\s+\d+\b.*$/i, " ");

  return uniqueValues([
    title,
    withoutBrackets,
    withoutParentheses,
    withoutYear,
    title.replace(/[._-]+/g, " "),
    withoutEpisodeCode,
    withoutTrailingEpisode,
    beforeDashEpisode,
    beforeDashSeason,
    withoutBrackets.replace(/\([^)]*\)/g, " "),
    withoutParentheses.replace(/\[[^\]]*]/g, " ")
  ].map((value) => value.replace(/\s{2,}/g, " ")));
}

function resultTitles(result, type) {
  return type === "tv"
    ? [result.name, result.original_name]
    : [result.title, result.original_title];
}

function resultYear(result, type) {
  const date = type === "tv" ? result.first_air_date : result.release_date;
  return Number(String(date || "").slice(0, 4)) || null;
}

function scoreSearchResult(result, query, type, year) {
  const normalizedQuery = normalizeComparableTitle(query);
  const titles = resultTitles(result, type).map(normalizeComparableTitle).filter(Boolean);
  const exactTitle = titles.some((title) => title === normalizedQuery);
  const containsTitle = titles.some((title) => title.includes(normalizedQuery) || normalizedQuery.includes(title));
  const candidateYear = resultYear(result, type);
  const yearDistance = year && candidateYear ? Math.abs(Number(year) - candidateYear) : null;

  let score = 0;
  if (exactTitle) score += 100;
  else if (containsTitle) score += 45;
  if (yearDistance === 0) score += 35;
  else if (yearDistance === 1) score += 15;
  else if (year && candidateYear && yearDistance > 1) score -= 20;
  if (result.poster_path) score += 8;
  if (result.overview) score += 5;
  score += Math.min(Number(result.popularity || 0), 50) / 5;
  score += Math.min(Number(result.vote_count || 0), 1000) / 250;
  return score;
}

async function bestSearchResult(pathName, attempts, type, year = null) {
  const candidates = new Map();
  for (const params of attempts) {
    const data = await tmdbGet(pathName, { include_adult: false, ...params });
    for (const [index, result] of (data?.results || []).entries()) {
      const previous = candidates.get(result.id);
      const score = scoreSearchResult(result, params.query, type, year) - (index * 0.05);
      if (!previous || score > previous.score) {
        candidates.set(result.id, { result, score });
      }
    }
  }
  return [...candidates.values()].sort((a, b) => b.score - a.score)[0]?.result || null;
}

async function downloadImage(imagePath, folder, prefix) {
  if (!imagePath) return null;
  const ext = path.extname(imagePath) || ".jpg";
  const localName = `${prefix}-${imagePath.replace(/[^a-z0-9]/gi, "")}${ext}`;
  const fullPath = path.join(folder, localName);
  if (!fs.existsSync(fullPath)) {
    const url = `https://image.tmdb.org/t/p/w780${imagePath}`;
    try {
      const response = await axios.get(url, { responseType: "arraybuffer", timeout: 15000 });
      fs.writeFileSync(fullPath, response.data);
    } catch {
      return null;
    }
  }
  return path.relative(path.resolve(folder, ".."), fullPath).replaceAll("\\", "/");
}

export async function fetchMovieMetadata(title, year) {
  const attempts = tmdbQueryVariants(title).flatMap((query) => (year
    ? [
        { query, year },
        { query, primary_release_year: year },
        { query }
      ]
    : [{ query }]
  ));
  const result = await bestSearchResult("/search/movie", attempts, "movie", year);
  if (!result) return null;
  const details = await tmdbGet(`/movie/${result.id}`, {}, { allowNotFound: true });
  return {
    tmdbId: result.id,
    title: details?.title || result.title || title,
    originalTitle: details?.original_title || result.original_title || null,
    year: (details?.release_date || result.release_date || "").slice(0, 4) || year || null,
    overview: details?.overview || result.overview || null,
    posterPath: await downloadImage(details?.poster_path || result.poster_path, postersRoot, `movie-${result.id}`),
    backdropPath: await downloadImage(details?.backdrop_path || result.backdrop_path, backdropsRoot, `movie-${result.id}`),
    genres: details?.genres?.map((genre) => genre.name) || [],
    runtime: details?.runtime || null,
    rating: details?.vote_average || result.vote_average || null
  };
}

function movieMetadataAsTvMetadata(metadata) {
  if (!metadata) return null;
  return {
    ...metadata,
    runtime: metadata.runtime || null,
    seasons: []
  };
}

export async function fetchTvMetadata(title, year = null) {
  const attempts = tmdbQueryVariants(title).flatMap((query) => (year
    ? [
        { query, first_air_date_year: year },
        { query }
      ]
    : [{ query }]
  ));
  const result = await bestSearchResult("/search/tv", attempts, "tv", year);
  if (!result) return movieMetadataAsTvMetadata(await fetchMovieMetadata(title, year));
  const details = await tmdbGet(`/tv/${result.id}`, {}, { allowNotFound: true });
  return {
    tmdbId: result.id,
    title: details?.name || result.name || title,
    originalTitle: details?.original_name || result.original_name || null,
    year: (details?.first_air_date || result.first_air_date || "").slice(0, 4) || null,
    overview: details?.overview || result.overview || null,
    posterPath: await downloadImage(details?.poster_path || result.poster_path, postersRoot, `tv-${result.id}`),
    backdropPath: await downloadImage(details?.backdrop_path || result.backdrop_path, backdropsRoot, `tv-${result.id}`),
    genres: details?.genres?.map((genre) => genre.name) || [],
    runtime: details?.episode_run_time?.[0] || null,
    rating: details?.vote_average || result.vote_average || null,
    seasons: details?.seasons || []
  };
}

export async function fetchTvSeasonMetadata(tmdbId, seasonNumber) {
  const details = await tmdbGet(`/tv/${tmdbId}/season/${seasonNumber}`, {}, { allowNotFound: true });
  if (!details) return null;

  return {
    seasonNumber: details.season_number,
    title: details.name || `Season ${seasonNumber}`,
    overview: details.overview || null,
    posterPath: await downloadImage(details.poster_path, postersRoot, `tv-${tmdbId}-season-${seasonNumber}`),
    episodes: (details.episodes || []).map((episode) => ({
      episodeNumber: episode.episode_number,
      title: episode.name || `Episode ${episode.episode_number}`,
      overview: episode.overview || null,
      stillPath: episode.still_path || null,
      airDate: episode.air_date || null
    }))
  };
}

export async function searchTmdb(type, query) {
  const pathName = type === "tv" ? "/search/tv" : "/search/movie";
  const data = await tmdbGet(pathName, { query });
  return data?.results || [];
}
