import fs from "node:fs/promises";
import path from "node:path";
import { db, nowIso } from "../db/database.js";
import { readAppConfig } from "../config/appConfig.js";
import { parseMediaFile } from "../parser/filename.js";
import { probeFile } from "./ffprobe.js";
import { fetchMovieMetadata, fetchTvMetadata, fetchTvSeasonMetadata, hasTmdbKey } from "../metadata/tmdb.js";

const mediaExtensions = new Set([".mp4", ".mkv", ".mov", ".avi", ".webm"]);
const subtitleExtensions = new Set([
  ".srt",
  ".vtt",
  ".webvtt",
  ".ass",
  ".ssa",
  ".sub",
  ".sbv",
  ".smi",
  ".ttml",
  ".dfxp"
]);
const subtitleDirectoryNames = new Set(["subs", "subtitles", "subtitle"]);
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

async function directoryHasSingleMediaFile(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isFile() && mediaExtensions.has(path.extname(entry.name).toLowerCase())).length === 1;
}

async function subtitleCandidates(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  const candidates = entries
    .filter((entry) => entry.isFile())
    .map((entry) => ({ entry, directory, fromSubtitleDirectory: false }));

  const subtitleDirectories = entries.filter((entry) => {
    return entry.isDirectory() && subtitleDirectoryNames.has(entry.name.toLowerCase());
  });

  for (const subtitleDirectory of subtitleDirectories) {
    const nestedDirectory = path.join(directory, subtitleDirectory.name);
    const nestedEntries = await fs.readdir(nestedDirectory, { withFileTypes: true }).catch(() => []);
    candidates.push(...nestedEntries
      .filter((entry) => entry.isFile())
      .map((entry) => ({ entry, directory: nestedDirectory, fromSubtitleDirectory: true })));
  }

  return candidates;
}

function subtitleLanguage(value) {
  const normalized = String(value || "").trim();
  return normalized && normalized.length <= 3 ? normalized : null;
}

export async function findExternalSubtitles(filePath) {
  const directory = path.dirname(filePath);
  const parsed = path.parse(filePath);
  const normalizedBase = parsed.name.toLowerCase();
  const hasSingleMediaFile = await directoryHasSingleMediaFile(directory);

  return (await subtitleCandidates(directory))
    .filter(({ entry }) => subtitleExtensions.has(path.extname(entry.name).toLowerCase()))
    .filter(({ entry, fromSubtitleDirectory }) => {
      const subtitleBase = path.parse(entry.name).name.toLowerCase();
      return subtitleBase === normalizedBase
        || subtitleBase.startsWith(`${normalizedBase}.`)
        || (fromSubtitleDirectory && hasSingleMediaFile);
    })
    .map(({ entry, directory: subtitleDirectory, fromSubtitleDirectory }, index) => {
      const subtitleBase = path.parse(entry.name).name;
      const extension = path.extname(entry.name).toLowerCase();
      const suffix = subtitleBase.slice(parsed.name.length).replace(/^\./, "");
      const label = suffix || (fromSubtitleDirectory ? subtitleBase : "Subtitles");
      return {
        index,
        fileName: entry.name,
        filePath: path.join(subtitleDirectory, entry.name),
        extension,
        format: extension.replace(/^\./, ""),
        label,
        language: subtitleLanguage(suffix) || subtitleLanguage(subtitleBase)
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

function expectedMediaType(libraryType) {
  return libraryType === "tv" ? "tv" : "movie";
}

function getExistingFileScanState(filePath) {
  return db.prepare(`
    SELECT
      f.id,
      f.file_size,
      f.modified_at,
      m.library_id,
      m.type AS media_type
    FROM files f
    LEFT JOIN media_items m ON m.id = f.media_item_id
    WHERE f.file_path = ?
  `).get(filePath);
}

function fileScanIsCurrent(existingFile, library, stats) {
  return Boolean(
    existingFile
      && Number(existingFile.library_id) === Number(library.id)
      && existingFile.media_type === expectedMediaType(library.type)
      && Number(existingFile.file_size) === Number(stats.size)
      && existingFile.modified_at === stats.mtime.toISOString()
  );
}

function normalizeMediaTitle(value) {
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
    const exactMatch = db.prepare(`
      SELECT * FROM media_items
      WHERE library_id = ? AND type = 'tv' AND (
        lower(title) = lower(?) OR lower(COALESCE(original_title, '')) = lower(?)
      )
      ORDER BY added_at
      LIMIT 1
    `).get(library.id, parsed.title, parsed.title);
    if (exactMatch) return exactMatch;

    const normalizedParsedTitle = normalizeMediaTitle(parsed.title);
    if (!normalizedParsedTitle) return null;

    return db.prepare(`
      SELECT *
      FROM media_items
      WHERE library_id = ? AND type = 'tv'
      ORDER BY added_at
    `).all(library.id).find((item) => {
      return normalizeMediaTitle(item.title) === normalizedParsedTitle
        || normalizeMediaTitle(item.original_title) === normalizedParsedTitle;
    }) || null;
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

function pruneMissingLibraryFiles(library, scannedPaths) {
  const knownFiles = db.prepare(`
    SELECT f.id, f.file_path
    FROM files f
    JOIN media_items m ON m.id = f.media_item_id
    WHERE m.library_id = ?
  `).all(library.id);
  const missingFileIds = knownFiles
    .filter((file) => !scannedPaths.has(file.file_path))
    .map((file) => file.id);

  return db.transaction((fileIds) => {
    let removedFiles = 0;
    let removedEpisodes = 0;
    let removedSeasons = 0;
    let removedMediaItems = 0;

    for (const fileId of fileIds) {
      db.prepare("DELETE FROM watch_progress WHERE file_id = ?").run(fileId);
      removedFiles += db.prepare("DELETE FROM files WHERE id = ?").run(fileId).changes;
    }

    removedEpisodes = db.prepare(`
      DELETE FROM episodes
      WHERE media_item_id IN (SELECT id FROM media_items WHERE library_id = ?)
        AND NOT EXISTS (
          SELECT 1
          FROM files f
          WHERE f.episode_id = episodes.id
        )
    `).run(library.id).changes;

    removedSeasons = db.prepare(`
      DELETE FROM seasons
      WHERE media_item_id IN (SELECT id FROM media_items WHERE library_id = ?)
        AND NOT EXISTS (
          SELECT 1
          FROM episodes e
          WHERE e.media_item_id = seasons.media_item_id
            AND e.season_number = seasons.season_number
        )
    `).run(library.id).changes;

    removedMediaItems = db.prepare(`
      DELETE FROM media_items
      WHERE library_id = ?
        AND NOT EXISTS (
          SELECT 1
          FROM files f
          WHERE f.media_item_id = media_items.id
        )
    `).run(library.id).changes;

    return { removedFiles, removedEpisodes, removedSeasons, removedMediaItems };
  })(missingFileIds);
}

export async function scanLibrary(libraryId, options = {}) {
  const library = db.prepare("SELECT * FROM libraries WHERE id = ?").get(libraryId);
  if (!library) throw new Error("Library not found");
  const rootStats = await fs.stat(library.path).catch(() => null);
  if (!rootStats?.isDirectory()) {
    throw new Error(`Library folder does not exist or is not readable: ${library.path}`);
  }

  const files = await walk(library.path);
  const scannedPaths = new Set(files);
  let added = 0;
  let updated = 0;
  let skipped = 0;

  for (const filePath of files) {
    const stats = await fs.stat(filePath);
    const existingFile = getExistingFileScanState(filePath);
    if (!options.force && fileScanIsCurrent(existingFile, library, stats)) {
      skipped += 1;
      continue;
    }

    const parsed = parseMediaFile(filePath, library.type);
    const mediaItem = await upsertMedia({ library, parsed });
    const episode = await upsertEpisode(mediaItem, parsed);
    const technical = await probeFile(filePath);
    const externalSubtitles = await findExternalSubtitles(filePath);
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

  const pruned = pruneMissingLibraryFiles(library, scannedPaths);

  return { scanned: files.length, added, updated, skipped, ...pruned };
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
