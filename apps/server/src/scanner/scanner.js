import fs from "node:fs/promises";
import path from "node:path";
import { db, nowIso } from "../db/database.js";
import { readAppConfig } from "../config/appConfig.js";
import { parseMediaFile } from "../parser/filename.js";
import { probeFile } from "./ffprobe.js";
import { fetchMovieMetadata, fetchTvMetadata, fetchTvSeasonMetadata, hasTmdbKey } from "../metadata/tmdb.js";

const mediaExtensions = new Set([".mp4", ".mkv", ".mov", ".avi", ".webm"]);
const subtitleExtensions = new Set([".srt"]);
const metadataCache = new Map();
const seasonMetadataCache = new Map();

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(fullPath));
    } else if (mediaExtensions.has(path.extname(entry.name).toLowerCase())) {
      files.push(fullPath);
    }
  }
  return files;
}

async function findExternalSubtitles(filePath) {
  const directory = path.dirname(filePath);
  const parsed = path.parse(filePath);
  const normalizedBase = parsed.name.toLowerCase();
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);

  return entries
    .filter((entry) => entry.isFile() && subtitleExtensions.has(path.extname(entry.name).toLowerCase()))
    .filter((entry) => {
      const subtitleBase = path.parse(entry.name).name.toLowerCase();
      return subtitleBase === normalizedBase || subtitleBase.startsWith(`${normalizedBase}.`);
    })
    .map((entry, index) => {
      const subtitleBase = path.parse(entry.name).name;
      const suffix = subtitleBase.slice(parsed.name.length).replace(/^\./, "");
      return {
        index,
        fileName: entry.name,
        filePath: path.join(directory, entry.name),
        label: suffix || "Subtitles",
        language: suffix && suffix.length <= 3 ? suffix : null
      };
    });
}

function upsertLibrary(library) {
  const existing = db.prepare("SELECT * FROM libraries WHERE path = ?").get(library.path);
  if (existing) return existing;
  const result = db.prepare("INSERT INTO libraries (name, type, path, created_at) VALUES (?, ?, ?, ?)")
    .run(library.name, library.type, library.path, nowIso());
  return db.prepare("SELECT * FROM libraries WHERE id = ?").get(result.lastInsertRowid);
}

async function enrichMedia(type, title, year) {
  if (!hasTmdbKey()) return null;
  const cacheKey = `${type}:${title.toLowerCase()}:${year || ""}`;
  if (metadataCache.has(cacheKey)) return metadataCache.get(cacheKey);

  try {
    const metadata = type === "tv" ? await fetchTvMetadata(title, year) : await fetchMovieMetadata(title, year);
    metadataCache.set(cacheKey, metadata);
    return metadata;
  } catch (error) {
    console.warn(`TMDB lookup failed for ${title}:`, error.message);
    metadataCache.set(cacheKey, null);
    return null;
  }
}

async function enrichSeason(tmdbId, seasonNumber) {
  if (!hasTmdbKey() || !tmdbId || !seasonNumber) return null;
  const cacheKey = `${tmdbId}:${seasonNumber}`;
  if (seasonMetadataCache.has(cacheKey)) return seasonMetadataCache.get(cacheKey);

  try {
    const metadata = await fetchTvSeasonMetadata(tmdbId, seasonNumber);
    seasonMetadataCache.set(cacheKey, metadata);
    return metadata;
  } catch (error) {
    console.warn(`TMDB season lookup failed for ${tmdbId} season ${seasonNumber}:`, error.message);
    seasonMetadataCache.set(cacheKey, null);
    return null;
  }
}

function needsMetadataRefresh(item) {
  return !item.tmdb_id || !item.overview || !item.poster_path || !item.backdrop_path;
}

async function refreshMissingMetadata(item, parsed) {
  if (!needsMetadataRefresh(item)) return item;

  const metadata = await enrichMedia(parsed.type, parsed.title, parsed.year);
  if (!metadata) return item;

  db.prepare(`
    UPDATE media_items SET
      original_title = COALESCE(original_title, ?),
      year = COALESCE(year, ?),
      overview = COALESCE(overview, ?),
      poster_path = COALESCE(poster_path, ?),
      backdrop_path = COALESCE(backdrop_path, ?),
      tmdb_id = COALESCE(tmdb_id, ?),
      genres = CASE WHEN genres IS NULL OR genres = '[]' THEN ? ELSE genres END,
      runtime = COALESCE(runtime, ?),
      rating = COALESCE(rating, ?),
      updated_at = ?
    WHERE id = ?
  `).run(
    metadata.originalTitle || null,
    Number(metadata.year || parsed.year) || null,
    metadata.overview || null,
    metadata.posterPath || null,
    metadata.backdropPath || null,
    metadata.tmdbId || null,
    JSON.stringify(metadata.genres || []),
    metadata.runtime || null,
    metadata.rating || null,
    nowIso(),
    item.id
  );

  if (parsed.type === "tv" && metadata.seasons?.length) {
    const insertSeason = db.prepare(`
      INSERT OR IGNORE INTO seasons (media_item_id, season_number, title, overview, poster_path)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const season of metadata.seasons) {
      insertSeason.run(item.id, season.season_number, season.name, season.overview || null, season.poster_path || null);
    }
  }

  return db.prepare("SELECT * FROM media_items WHERE id = ?").get(item.id);
}

function findExistingMedia(library, parsed, metadata = null) {
  if (metadata?.tmdbId) {
    const byTmdb = db.prepare(`
      SELECT * FROM media_items
      WHERE library_id = ? AND type = ? AND tmdb_id = ?
    `).get(library.id, parsed.type, metadata.tmdbId);
    if (byTmdb) return byTmdb;
  }

  if (parsed.type === "tv") {
    return db.prepare(`
      SELECT * FROM media_items
      WHERE library_id = ? AND type = 'tv' AND (
        lower(title) = lower(?) OR lower(COALESCE(original_title, '')) = lower(?)
      )
      ORDER BY added_at
      LIMIT 1
    `).get(library.id, parsed.title, parsed.title);
  }

  return db.prepare(`
    SELECT * FROM media_items
    WHERE library_id = ? AND type = ? AND lower(title) = lower(?) AND COALESCE(year, 0) = COALESCE(?, 0)
  `).get(library.id, parsed.type, parsed.title, parsed.year || null);
}

async function upsertMedia({ library, parsed }) {
  const existing = findExistingMedia(library, parsed);

  if (existing) return refreshMissingMetadata(existing, parsed);

  const metadata = await enrichMedia(parsed.type, parsed.title, parsed.year);
  const matchedByMetadata = findExistingMedia(library, parsed, metadata);
  if (matchedByMetadata) return refreshMissingMetadata(matchedByMetadata, parsed);

  const created = nowIso();
  const result = db.prepare(`
    INSERT INTO media_items (
      library_id, type, title, original_title, year, overview, poster_path, backdrop_path,
      tmdb_id, added_at, updated_at, genres, runtime, rating
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    library.id,
    parsed.type,
    metadata?.title || parsed.title,
    metadata?.originalTitle || null,
    Number(metadata?.year || parsed.year) || null,
    metadata?.overview || null,
    metadata?.posterPath || null,
    metadata?.backdropPath || null,
    metadata?.tmdbId || null,
    created,
    created,
    JSON.stringify(metadata?.genres || []),
    metadata?.runtime || null,
    metadata?.rating || null
  );
  const item = db.prepare("SELECT * FROM media_items WHERE id = ?").get(result.lastInsertRowid);

  if (parsed.type === "tv" && metadata?.seasons?.length) {
    const insertSeason = db.prepare(`
      INSERT OR IGNORE INTO seasons (media_item_id, season_number, title, overview, poster_path)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const season of metadata.seasons) {
      insertSeason.run(item.id, season.season_number, season.name, season.overview || null, season.poster_path || null);
    }
  }

  return item;
}

async function upsertEpisode(mediaItem, parsed) {
  if (parsed.type !== "tv" || !parsed.seasonNumber || !parsed.episodeNumber) return null;

  const seasonMetadata = await enrichSeason(mediaItem.tmdb_id, parsed.seasonNumber);
  const episodeMetadata = seasonMetadata?.episodes?.find((episode) => episode.episodeNumber === parsed.episodeNumber);

  db.prepare(`
    INSERT OR IGNORE INTO seasons (media_item_id, season_number, title, overview, poster_path)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    mediaItem.id,
    parsed.seasonNumber,
    seasonMetadata?.title || `Season ${parsed.seasonNumber}`,
    seasonMetadata?.overview || null,
    seasonMetadata?.posterPath || null
  );

  if (seasonMetadata) {
    db.prepare(`
      UPDATE seasons SET
        title = COALESCE(NULLIF(title, ?), ?),
        overview = COALESCE(overview, ?),
        poster_path = COALESCE(poster_path, ?)
      WHERE media_item_id = ? AND season_number = ?
    `).run(
      `Season ${parsed.seasonNumber}`,
      seasonMetadata.title,
      seasonMetadata.overview,
      seasonMetadata.posterPath,
      mediaItem.id,
      parsed.seasonNumber
    );
  }

  const season = db.prepare("SELECT * FROM seasons WHERE media_item_id = ? AND season_number = ?")
    .get(mediaItem.id, parsed.seasonNumber);

  db.prepare(`
    INSERT OR IGNORE INTO episodes (
      media_item_id, season_id, season_number, episode_number, title, overview, still_path, air_date
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    mediaItem.id,
    season.id,
    parsed.seasonNumber,
    parsed.episodeNumber,
    episodeMetadata?.title || `Episode ${parsed.episodeNumber}`,
    episodeMetadata?.overview || null,
    episodeMetadata?.stillPath || null,
    episodeMetadata?.airDate || null
  );

  if (episodeMetadata) {
    db.prepare(`
      UPDATE episodes SET
        title = COALESCE(NULLIF(title, ?), ?),
        overview = COALESCE(overview, ?),
        still_path = COALESCE(still_path, ?),
        air_date = COALESCE(air_date, ?)
      WHERE media_item_id = ? AND season_number = ? AND episode_number = ?
    `).run(
      `Episode ${parsed.episodeNumber}`,
      episodeMetadata.title,
      episodeMetadata.overview,
      episodeMetadata.stillPath,
      episodeMetadata.airDate,
      mediaItem.id,
      parsed.seasonNumber,
      parsed.episodeNumber
    );
  }

  return db.prepare(`
    SELECT * FROM episodes
    WHERE media_item_id = ? AND season_number = ? AND episode_number = ?
  `).get(mediaItem.id, parsed.seasonNumber, parsed.episodeNumber);
}

export async function scanLibrary(libraryId) {
  const library = db.prepare("SELECT * FROM libraries WHERE id = ?").get(libraryId);
  if (!library) throw new Error("Library not found");
  const rootStats = await fs.stat(library.path).catch(() => null);
  if (!rootStats?.isDirectory()) {
    throw new Error(`Library folder does not exist or is not readable: ${library.path}`);
  }

  const files = await walk(library.path);
  let added = 0;
  let updated = 0;

  for (const filePath of files) {
    const stats = await fs.stat(filePath);
    const parsed = parseMediaFile(filePath, library.type);
    const mediaItem = await upsertMedia({ library, parsed });
    const episode = await upsertEpisode(mediaItem, parsed);
    const technical = await probeFile(filePath);
    const externalSubtitles = await findExternalSubtitles(filePath);
    const existingFile = db.prepare("SELECT id FROM files WHERE file_path = ?").get(filePath);
    const values = [
      mediaItem.id,
      episode?.id || null,
      filePath,
      path.basename(filePath),
      stats.size,
      technical.duration || null,
      technical.width || null,
      technical.height || null,
      technical.videoCodec || null,
      technical.audioCodec || null,
      JSON.stringify(technical.audioTracks || []),
      JSON.stringify(technical.subtitleTracks || []),
      JSON.stringify(externalSubtitles),
      technical.container || null,
      stats.mtime.toISOString(),
      nowIso()
    ];

    db.prepare(`
      INSERT INTO files (
        media_item_id, episode_id, file_path, file_name, file_size, duration, width, height,
        video_codec, audio_codec, audio_tracks, subtitle_tracks, external_subtitles, container, modified_at, added_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(file_path) DO UPDATE SET
        media_item_id = excluded.media_item_id,
        episode_id = excluded.episode_id,
        file_size = excluded.file_size,
        duration = excluded.duration,
        width = excluded.width,
        height = excluded.height,
        video_codec = excluded.video_codec,
        audio_codec = excluded.audio_codec,
        audio_tracks = excluded.audio_tracks,
        subtitle_tracks = excluded.subtitle_tracks,
        external_subtitles = excluded.external_subtitles,
        container = excluded.container,
        modified_at = excluded.modified_at
    `).run(...values);

    if (existingFile) updated += 1;
    else added += 1;
  }

  return { scanned: files.length, added, updated };
}

export async function syncConfiguredLibraries() {
  const existingCount = db.prepare("SELECT COUNT(*) AS count FROM libraries").get().count;
  if (existingCount > 0) return db.prepare("SELECT * FROM libraries ORDER BY name").all();

  const config = readAppConfig();
  const synced = [];
  for (const library of config.libraries) {
    if (!library.path || !library.type || !library.name) continue;
    synced.push(upsertLibrary(library));
  }
  return synced;
}
