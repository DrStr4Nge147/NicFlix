import axios from "axios";
import fs from "node:fs";
import path from "node:path";
import { backdropsRoot, postersRoot } from "../config/paths.js";

const apiKey = process.env.TMDB_API_KEY;
const client = axios.create({
  baseURL: "https://api.themoviedb.org/3",
  timeout: 10000
});

export function hasTmdbKey() {
  return Boolean(apiKey && apiKey !== "your_tmdb_api_key_here");
}

async function tmdbGet(url, params = {}) {
  if (!hasTmdbKey()) return null;
  const response = await client.get(url, { params: { api_key: apiKey, ...params } });
  return response.data;
}

async function downloadImage(imagePath, folder, prefix) {
  if (!imagePath) return null;
  const ext = path.extname(imagePath) || ".jpg";
  const localName = `${prefix}-${imagePath.replace(/[^a-z0-9]/gi, "")}${ext}`;
  const fullPath = path.join(folder, localName);
  if (!fs.existsSync(fullPath)) {
    const url = `https://image.tmdb.org/t/p/w780${imagePath}`;
    const response = await axios.get(url, { responseType: "arraybuffer", timeout: 15000 });
    fs.writeFileSync(fullPath, response.data);
  }
  return path.relative(path.resolve(folder, ".."), fullPath).replaceAll("\\", "/");
}

export async function fetchMovieMetadata(title, year) {
  const search = await tmdbGet("/search/movie", { query: title, year: year || undefined });
  const result = search?.results?.[0];
  if (!result) return null;
  const details = await tmdbGet(`/movie/${result.id}`);
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

export async function fetchTvMetadata(title) {
  const search = await tmdbGet("/search/tv", { query: title });
  const result = search?.results?.[0];
  if (!result) return null;
  const details = await tmdbGet(`/tv/${result.id}`);
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

export async function searchTmdb(type, query) {
  const pathName = type === "tv" ? "/search/tv" : "/search/movie";
  const data = await tmdbGet(pathName, { query });
  return data?.results || [];
}

