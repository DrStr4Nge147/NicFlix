import express from "express";
import fs from "node:fs";
import path from "node:path";
import mime from "mime-types";
import ffmpeg from "fluent-ffmpeg";
import axios from "axios";
import { db, nowIso, rowToMedia } from "../db/database.js";
import { scanLibrary } from "../scanner/scanner.js";
import { maskSecret, readAppConfig, writeAppConfig, getTmdbApiKey, hasAppManagedTmdbKey } from "../config/appConfig.js";
import { searchTmdb, fetchMovieMetadata, fetchTvMetadata, fetchTvSeasonMetadata, hasTmdbKey, testTmdbApiKey } from "../metadata/tmdb.js";

export const api = express.Router();

function mediaWithFile(row) {
  if (!row) return null;
  return rowToMedia({
    ...row,
    poster_path: row.poster_path ? `/assets/${row.poster_path}` : null,
    backdrop_path: row.backdrop_path ? `/assets/${row.backdrop_path}` : null
  });
}

function parseJsonArray(value) {
  if (!value) return [];
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}

function getPlayableFile(fileId) {
  return db.prepare("SELECT * FROM files WHERE id = ?").get(fileId);
}

function parseTime(val) {
  if (typeof val === "number") return val;
  if (!val) return 0;
  const parts = String(val).split(":").map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return Number(val) || 0;
}

function preferredEpisodeFileJoinSql() {
  return `
    JOIN files f ON f.id = (
      SELECT candidate.id
      FROM files candidate
      LEFT JOIN watch_progress candidate_wp ON candidate_wp.file_id = candidate.id
      WHERE candidate.episode_id = e.id
      ORDER BY
        CASE WHEN candidate_wp.position > 30 AND candidate_wp.watched = 0 THEN 0 ELSE 1 END,
        CASE WHEN candidate.file_name LIKE '%[English Dub]%' THEN 1 ELSE 0 END,
        candidate.id
      LIMIT 1
    )
  `;
}

function getSeriesNavigation(fileId) {
  const current = db.prepare(`
    SELECT f.*, e.season_number, e.episode_number
    FROM files f
    LEFT JOIN episodes e ON e.id = f.episode_id
    WHERE f.id = ?
  `).get(fileId);

  if (!current?.episode_id) return { previous: null, next: null };

  const next = db.prepare(`
    SELECT f.id AS file_id, e.title AS episode_title, e.season_number, e.episode_number
    FROM episodes e
    ${preferredEpisodeFileJoinSql()}
    WHERE e.media_item_id = ?
      AND (
        e.season_number > ?
        OR (e.season_number = ? AND e.episode_number > ?)
      )
    ORDER BY e.season_number, e.episode_number
    LIMIT 1
  `).get(current.media_item_id, current.season_number, current.season_number, current.episode_number);

  const previous = db.prepare(`
    SELECT f.id AS file_id, e.title AS episode_title, e.season_number, e.episode_number
    FROM episodes e
    ${preferredEpisodeFileJoinSql()}
    WHERE e.media_item_id = ?
      AND (
        e.season_number < ?
        OR (e.season_number = ? AND e.episode_number < ?)
      )
    ORDER BY e.season_number DESC, e.episode_number DESC
    LIMIT 1
  `).get(current.media_item_id, current.season_number, current.season_number, current.episode_number);

  return { previous: previous || null, next: next || null };
}

function getPlaybackContext(fileId) {
  const row = db.prepare(`
    SELECT
      m.id AS media_item_id,
      m.title AS media_title,
      m.type,
      m.tmdb_id,
      m.imdb_id,
      e.title AS episode_title,
      e.season_number,
      e.episode_number,
      f.file_name
    FROM files f
    LEFT JOIN media_items m ON m.id = f.media_item_id
    LEFT JOIN episodes e ON e.id = f.episode_id
    WHERE f.id = ?
  `).get(fileId);

  if (!row) return null;

  return {
    mediaItemId: row.media_item_id,
    title: row.media_title || row.file_name,
    subtitle: row.episode_number
      ? `S${row.season_number}:E${row.episode_number}${row.episode_title ? ` - ${row.episode_title}` : ""}`
      : null,
    type: row.type,
    tmdbId: row.tmdb_id,
    imdbId: row.imdb_id,
    seasonNumber: row.season_number,
    episodeNumber: row.episode_number
  };
}

function srtToVtt(input) {
  return `WEBVTT\n\n${input
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2")}`;
}

function listMedia(type, limit = 60) {
  return db.prepare(`
    SELECT m.*, f.id AS file_id, f.duration AS file_duration, wp.position, wp.watched
    FROM media_items m
    LEFT JOIN files f ON f.media_item_id = m.id AND f.episode_id IS NULL
    LEFT JOIN watch_progress wp ON wp.file_id = f.id
    WHERE m.type = ? AND m.ignored = 0
    GROUP BY m.id
    ORDER BY m.added_at DESC
    LIMIT ?
  `).all(type, limit).map(mediaWithFile);
}

async function refreshTvEpisodeMetadata(itemId, tmdbId, seasons = []) {
  const insertSeason = db.prepare(`
    INSERT OR IGNORE INTO seasons (media_item_id, season_number, title, overview, poster_path)
    VALUES (?, ?, ?, ?, ?)
  `);
  const updateSeason = db.prepare(`
    UPDATE seasons SET
      title = COALESCE(NULLIF(title, ?), ?),
      overview = COALESCE(overview, ?),
      poster_path = COALESCE(poster_path, ?)
    WHERE media_item_id = ? AND season_number = ?
  `);
  const updateEpisode = db.prepare(`
    UPDATE episodes SET
      title = COALESCE(NULLIF(title, ?), ?),
      overview = COALESCE(overview, ?),
      still_path = COALESCE(still_path, ?),
      air_date = COALESCE(air_date, ?)
    WHERE media_item_id = ? AND season_number = ? AND episode_number = ?
  `);

  for (const season of seasons) {
    insertSeason.run(itemId, season.season_number, season.name, season.overview || null, season.poster_path || null);
  }

  const existingSeasonNumbers = db.prepare(`
    SELECT DISTINCT season_number
    FROM episodes
    WHERE media_item_id = ?
    ORDER BY season_number
  `).all(itemId).map((row) => row.season_number);

  for (const seasonNumber of existingSeasonNumbers) {
    let seasonMetadata = null;
    try {
      seasonMetadata = await fetchTvSeasonMetadata(tmdbId, seasonNumber);
    } catch (error) {
      console.warn(`TMDB season lookup failed for ${tmdbId} season ${seasonNumber}:`, error.message);
    }
    if (!seasonMetadata) continue;

    insertSeason.run(
      itemId,
      seasonNumber,
      seasonMetadata.title,
      seasonMetadata.overview,
      seasonMetadata.posterPath
    );
    updateSeason.run(
      `Season ${seasonNumber}`,
      seasonMetadata.title,
      seasonMetadata.overview,
      seasonMetadata.posterPath,
      itemId,
      seasonNumber
    );

    for (const episode of seasonMetadata.episodes) {
      updateEpisode.run(
        `Episode ${episode.episodeNumber}`,
        episode.title,
        episode.overview,
        episode.stillPath,
        episode.airDate,
        itemId,
        seasonNumber,
        episode.episodeNumber
      );
    }
  }
}

function windowsDriveRoots() {
  const roots = [];
  for (let code = 65; code <= 90; code += 1) {
    const drive = `${String.fromCharCode(code)}:/`;
    if (fs.existsSync(drive)) roots.push({ name: drive, path: drive });
  }
  return roots;
}

api.get("/health", (_req, res) => {
  res.json({ ok: true, app: "NicFlix" });
});

api.get("/settings", (_req, res) => {
  const config = readAppConfig();
  res.json({
    autoSkipEnabled: config.autoSkipEnabled,
    autoPlayNextEnabled: config.autoPlayNextEnabled
  });
});

api.get("/admin/settings", (_req, res) => {
  const config = readAppConfig();
  const apiKey = getTmdbApiKey();
  const appManaged = hasAppManagedTmdbKey();
  res.json({
    settings: {
      tmdbConfigured: hasTmdbKey(),
      tmdbApiKeyMasked: maskSecret(apiKey),
      tmdbApiKeySource: config.tmdbDisconnected ? "none" : (appManaged ? "app" : (process.env.TMDB_API_KEY ? "env" : "none")),
      tmdbDisconnected: config.tmdbDisconnected,
      canDisconnectTmdb: hasTmdbKey() || appManaged || Boolean(process.env.TMDB_API_KEY),
      autoSkipEnabled: config.autoSkipEnabled,
      autoPlayNextEnabled: config.autoPlayNextEnabled
    }
  });
});

api.patch("/admin/settings/player", (req, res) => {
  const updates = {};
  if (typeof req.body.autoSkipEnabled === "boolean") updates.autoSkipEnabled = req.body.autoSkipEnabled;
  if (typeof req.body.autoPlayNextEnabled === "boolean") updates.autoPlayNextEnabled = req.body.autoPlayNextEnabled;

  const nextConfig = writeAppConfig(updates);
  res.json({
    settings: {
      autoSkipEnabled: nextConfig.autoSkipEnabled,
      autoPlayNextEnabled: nextConfig.autoPlayNextEnabled
    }
  });
});

api.patch("/admin/settings/tmdb", async (req, res, next) => {
  try {
    const tmdbApiKey = String(req.body.tmdbApiKey || "").trim();
    const testOnly = req.body.testOnly === true;

    if (!tmdbApiKey) {
      writeAppConfig({ tmdbApiKey: "", tmdbDisconnected: true });
      res.json({
        settings: {
          tmdbConfigured: hasTmdbKey(),
          tmdbApiKeyMasked: maskSecret(getTmdbApiKey()),
          tmdbApiKeySource: "none",
          tmdbDisconnected: true,
          canDisconnectTmdb: false
        },
        test: { ok: true, message: "TMDB API key cleared from app settings." }
      });
      return;
    }

    const test = await testTmdbApiKey(tmdbApiKey);
    if (testOnly || !test.ok) {
      res.status(test.ok ? 200 : 400).json({ test });
      return;
    }

    writeAppConfig({ tmdbApiKey, tmdbDisconnected: false });
    res.json({
      settings: {
        tmdbConfigured: hasTmdbKey(),
        tmdbApiKeyMasked: maskSecret(tmdbApiKey),
        tmdbApiKeySource: "app",
        tmdbDisconnected: false,
        canDisconnectTmdb: true
      },
      test
    });
  } catch (error) {
    next(error);
  }
});

api.delete("/admin/settings/tmdb", (_req, res) => {
  writeAppConfig({ tmdbApiKey: "", tmdbDisconnected: true });
  res.json({
    settings: {
      tmdbConfigured: false,
      tmdbApiKeyMasked: "",
      tmdbApiKeySource: "none",
      tmdbDisconnected: true,
      canDisconnectTmdb: false
    },
    message: "TMDB API key disconnected."
  });
});

api.get("/fs/directories", async (req, res, next) => {
  try {
    const requestedPath = String(req.query.path || "").trim();
    if (!requestedPath && process.platform === "win32") {
      res.json({ currentPath: "", parentPath: null, directories: windowsDriveRoots() });
      return;
    }

    const currentPath = path.resolve(requestedPath || process.cwd());
    const parentPath = path.dirname(currentPath) === currentPath ? null : path.dirname(currentPath);
    const entries = await fs.promises.readdir(currentPath, { withFileTypes: true });
    const directories = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        name: entry.name,
        path: path.join(currentPath, entry.name)
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    res.json({ currentPath, parentPath, directories });
  } catch (error) {
    next(error);
  }
});

api.get("/libraries", (_req, res) => {
  res.json({ libraries: db.prepare("SELECT * FROM libraries ORDER BY name").all() });
});

api.post("/libraries", async (req, res, next) => {
  try {
    const { name, type, path: libraryPath } = req.body;
    if (!name || !type || !libraryPath) {
      res.status(400).json({ error: "name, type, and path are required" });
      return;
    }
    if (!["movies", "tv"].includes(type)) {
      res.status(400).json({ error: "type must be movies or tv" });
      return;
    }
    const result = db.prepare(`
      INSERT INTO libraries (name, type, path, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET name = excluded.name, type = excluded.type
    `).run(name, type, libraryPath, nowIso());
    const library = db.prepare("SELECT * FROM libraries WHERE path = ?").get(libraryPath)
      || db.prepare("SELECT * FROM libraries WHERE id = ?").get(result.lastInsertRowid);
    const scan = await scanLibrary(library.id);
    res.status(201).json({ library, scan });
  } catch (error) {
    next(error);
  }
});

api.patch("/libraries/:id", async (req, res, next) => {
  const existing = db.prepare("SELECT * FROM libraries WHERE id = ?").get(req.params.id);
  if (!existing) {
    res.status(404).json({ error: "Library not found" });
    return;
  }

  const name = String(req.body.name || "").trim();
  const type = String(req.body.type || "").trim();
  const libraryPath = String(req.body.path || "").trim();
  if (!name || !type || !libraryPath) {
    res.status(400).json({ error: "name, type, and path are required" });
    return;
  }
  if (!["movies", "tv"].includes(type)) {
    res.status(400).json({ error: "type must be movies or tv" });
    return;
  }

  try {
    db.prepare("UPDATE libraries SET name = ?, type = ?, path = ? WHERE id = ?")
      .run(name, type, libraryPath, req.params.id);
    const library = db.prepare("SELECT * FROM libraries WHERE id = ?").get(req.params.id);
    const scan = await scanLibrary(library.id);
    res.json({ library, scan });
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
      res.status(409).json({ error: "A library with that path already exists" });
      return;
    }
    next(error);
  }
});

api.delete("/libraries/:id", (req, res) => {
  const existing = db.prepare("SELECT * FROM libraries WHERE id = ?").get(req.params.id);
  if (!existing) {
    res.status(404).json({ error: "Library not found" });
    return;
  }

  const removeLibrary = db.transaction((libraryId) => {
    const mediaIds = db.prepare("SELECT id FROM media_items WHERE library_id = ?").all(libraryId).map((row) => row.id);
    if (mediaIds.length) {
      const placeholders = mediaIds.map(() => "?").join(",");
      const fileIds = db.prepare(`SELECT id FROM files WHERE media_item_id IN (${placeholders})`).all(...mediaIds).map((row) => row.id);
      if (fileIds.length) {
        db.prepare(`DELETE FROM watch_progress WHERE file_id IN (${fileIds.map(() => "?").join(",")})`).run(...fileIds);
      }
      db.prepare(`DELETE FROM files WHERE media_item_id IN (${placeholders})`).run(...mediaIds);
      db.prepare(`DELETE FROM episodes WHERE media_item_id IN (${placeholders})`).run(...mediaIds);
      db.prepare(`DELETE FROM seasons WHERE media_item_id IN (${placeholders})`).run(...mediaIds);
      db.prepare(`DELETE FROM media_items WHERE id IN (${placeholders})`).run(...mediaIds);
    }
    db.prepare("DELETE FROM libraries WHERE id = ?").run(libraryId);
  });

  removeLibrary(req.params.id);
  res.json({ ok: true });
});

api.post("/libraries/:id/scan", async (req, res, next) => {
  try {
    const result = await scanLibrary(req.params.id);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

api.get("/home", (_req, res) => {
  const continueWatching = db.prepare(`
    SELECT m.*, f.id AS file_id, f.duration AS file_duration, wp.position, wp.watched,
      1 AS resume,
      e.title AS episode_title,
      e.season_number,
      e.episode_number,
      MAX(wp.updated_at) AS latest_progress
    FROM watch_progress wp
    JOIN files f ON f.id = wp.file_id
    JOIN media_items m ON m.id = f.media_item_id
    LEFT JOIN episodes e ON e.id = f.episode_id
    WHERE wp.watched = 0 AND wp.position > 30 AND m.ignored = 0
    GROUP BY m.id
    ORDER BY latest_progress DESC
    LIMIT 20
  `).all().map(mediaWithFile);

  const recentlyAdded = db.prepare(`
    SELECT m.*, f.id AS file_id, f.duration AS file_duration, wp.position, wp.watched
    FROM media_items m
    LEFT JOIN files f ON f.media_item_id = m.id
    LEFT JOIN watch_progress wp ON wp.file_id = f.id
    WHERE m.ignored = 0
    GROUP BY m.id
    ORDER BY m.added_at DESC
    LIMIT 20
  `).all().map(mediaWithFile);

  const movies = listMedia("movie", 30);
  const shows = listMedia("tv", 30);
  const genreRows = ["Action", "Comedy", "Drama", "Sci-Fi"].map((genre) => ({
    title: genre,
    items: db.prepare(`
      SELECT m.*, f.id AS file_id, f.duration AS file_duration, wp.position, wp.watched
      FROM media_items m
      LEFT JOIN files f ON f.media_item_id = m.id
      LEFT JOIN watch_progress wp ON wp.file_id = f.id
      WHERE m.ignored = 0 AND m.genres LIKE ?
      GROUP BY m.id
      ORDER BY m.added_at DESC
      LIMIT 20
    `).all(`%${genre}%`).map(mediaWithFile)
  })).filter((row) => row.items.length);

  res.json({
    rows: [
      { title: "Continue Watching", items: continueWatching },
      { title: "Recently Added", items: recentlyAdded },
      { title: "Movies", items: movies },
      { title: "TV Shows", items: shows },
      ...genreRows
    ].filter((row) => row.items.length)
  });
});

api.get("/movies", (_req, res) => {
  res.json({ movies: listMedia("movie", 200) });
});

api.get("/movies/:id", (req, res) => {
  const movie = mediaWithFile(db.prepare(`
    SELECT m.*, f.id AS file_id, f.duration AS file_duration, f.file_name, f.width, f.height,
      f.video_codec, f.audio_codec, f.container, wp.position, wp.watched
    FROM media_items m
    LEFT JOIN files f ON f.media_item_id = m.id AND f.episode_id IS NULL
    LEFT JOIN watch_progress wp ON wp.file_id = f.id
    WHERE m.id = ? AND m.type = 'movie'
  `).get(req.params.id));
  if (!movie) {
    res.status(404).json({ error: "Movie not found" });
    return;
  }
  res.json({ movie });
});

api.get("/shows", (_req, res) => {
  res.json({ shows: listMedia("tv", 200) });
});

api.get("/shows/:id", (req, res) => {
  const show = mediaWithFile(db.prepare("SELECT * FROM media_items WHERE id = ? AND type = 'tv'").get(req.params.id));
  if (!show) {
    res.status(404).json({ error: "Show not found" });
    return;
  }

  const seasons = db.prepare(`
    SELECT s.*
    FROM seasons s
    WHERE s.media_item_id = ?
      AND EXISTS (
        SELECT 1
        FROM episodes e
        WHERE e.media_item_id = s.media_item_id
          AND e.season_number = s.season_number
      )
    ORDER BY s.season_number
  `).all(show.id);
  const episodes = db.prepare(`
    SELECT e.*, f.id AS file_id, f.duration AS file_duration, wp.position, wp.watched
    FROM episodes e
    LEFT JOIN files f ON f.id = (
      SELECT candidate.id
      FROM files candidate
      LEFT JOIN watch_progress candidate_wp ON candidate_wp.file_id = candidate.id
      WHERE candidate.episode_id = e.id
      ORDER BY
        CASE WHEN candidate_wp.position > 30 AND candidate_wp.watched = 0 THEN 0 ELSE 1 END,
        CASE WHEN candidate.file_name LIKE '%[English Dub]%' THEN 1 ELSE 0 END,
        candidate.id
      LIMIT 1
    )
    LEFT JOIN watch_progress wp ON wp.file_id = f.id
    WHERE e.media_item_id = ?
    ORDER BY e.season_number, e.episode_number
  `).all(show.id);
  res.json({ show, seasons, episodes });
});

api.get("/shows/:id/seasons", (req, res) => {
  const seasons = db.prepare(`
    SELECT s.*
    FROM seasons s
    WHERE s.media_item_id = ?
      AND EXISTS (
        SELECT 1
        FROM episodes e
        WHERE e.media_item_id = s.media_item_id
          AND e.season_number = s.season_number
      )
    ORDER BY s.season_number
  `).all(req.params.id);
  res.json({ seasons });
});

api.get("/search", (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) {
    const results = db.prepare(`
      SELECT m.*, f.id AS file_id, f.duration AS file_duration, wp.position, wp.watched
      FROM media_items m
      LEFT JOIN files f ON f.media_item_id = m.id
      LEFT JOIN watch_progress wp ON wp.file_id = f.id
      WHERE m.ignored = 0
      GROUP BY m.id
      ORDER BY m.added_at DESC
      LIMIT 200
    `).all().map(mediaWithFile);
    res.json({ results });
    return;
  }
  const like = `%${q}%`;
  const results = db.prepare(`
    SELECT m.*, f.id AS file_id, f.duration AS file_duration, wp.position, wp.watched
    FROM media_items m
    LEFT JOIN files f ON f.media_item_id = m.id
    LEFT JOIN episodes e ON e.media_item_id = m.id
    LEFT JOIN watch_progress wp ON wp.file_id = f.id
    WHERE m.ignored = 0 AND (m.title LIKE ? OR m.original_title LIKE ? OR e.title LIKE ?)
    GROUP BY m.id
    ORDER BY m.title
    LIMIT 60
  `).all(like, like, like).map(mediaWithFile);
  res.json({ results });
});

api.get("/stream/:fileId", (req, res) => {
  const file = getPlayableFile(req.params.fileId);
  if (!file || !fs.existsSync(file.file_path)) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  const stat = fs.statSync(file.file_path);
  const range = req.headers.range;
  const contentType = mime.lookup(file.file_path) || "application/octet-stream";

  if (!range) {
    res.writeHead(200, {
      "Content-Length": stat.size,
      "Content-Type": contentType,
      "Accept-Ranges": "bytes"
    });
    fs.createReadStream(file.file_path).pipe(res);
    return;
  }

  const [startRaw, endRaw] = range.replace(/bytes=/, "").split("-");
  const start = Number.parseInt(startRaw, 10);
  const end = endRaw ? Number.parseInt(endRaw, 10) : stat.size - 1;
  const chunkSize = end - start + 1;

  res.writeHead(206, {
    "Content-Range": `bytes ${start}-${end}/${stat.size}`,
    "Accept-Ranges": "bytes",
    "Content-Length": chunkSize,
    "Content-Type": contentType
  });
  fs.createReadStream(file.file_path, { start, end }).pipe(res);
});

api.get("/files/:fileId/tracks", (req, res) => {
  const file = getPlayableFile(req.params.fileId);
  if (!file) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  const externalSubtitles = parseJsonArray(file.external_subtitles)
    .filter((track) => track.filePath && fs.existsSync(track.filePath))
    .map((track, index) => ({
      index,
      label: track.label || track.language || `Subtitles ${index + 1}`,
      language: track.language || "en",
      kind: "subtitles",
      src: `/api/subtitles/${file.id}/external/${index}`
    }));

  const embeddedSubtitles = parseJsonArray(file.subtitle_tracks)
    .filter((track) => track.index !== undefined)
    .map((track, index) => ({
      index: track.index,
      label: track.label || track.language || `Embedded ${index + 1}`,
      language: track.language || "en",
      codec: track.codec,
      kind: "subtitles",
      src: `/api/subtitles/${file.id}/embedded/${track.index}`
    }));

  res.json({
    audioTracks: parseJsonArray(file.audio_tracks),
    subtitleTracks: [...externalSubtitles, ...embeddedSubtitles]
  });
});

api.get("/files/:fileId/context", (req, res) => {
  const context = getPlaybackContext(req.params.fileId);
  if (!context) {
    res.status(404).json({ error: "File not found" });
    return;
  }
  res.json({ context });
});

api.get("/files/:fileId/segments", async (req, res) => {
  const config = readAppConfig();
  if (!config.autoSkipEnabled) return res.json({ segments: [] });

  const context = getPlaybackContext(req.params.fileId);
  if (!context || !context.tmdbId) return res.json({ segments: [] });

  let { imdbId, tmdbId, seasonNumber, episodeNumber, type } = context;
  const isTv = type === "tv" && seasonNumber !== null && episodeNumber !== null;

  try {
    if (!imdbId) {
      console.log(`Missing IMDb ID for TMDB ${tmdbId}, fetching...`);
      const details = await (type === "tv" ? fetchTvMetadata(context.title) : fetchMovieMetadata(context.title));
      if (details?.imdbId) {
        imdbId = details.imdbId;
        db.prepare("UPDATE media_items SET imdb_id = ? WHERE id = ?").run(imdbId, context.mediaItemId);
      }
    }

    if (!imdbId) {
      console.warn(`Could not resolve IMDb ID for TMDB ${tmdbId}`);
      return res.json({ segments: [] });
    }

    const url = isTv
      ? `https://api.introdb.app/segments?imdb_id=${imdbId}&season=${seasonNumber}&episode=${episodeNumber}`
      : `https://api.introdb.app/segments?imdb_id=${imdbId}`;

    console.log(`Fetching segments for IMDb: ${imdbId} (TMDB: ${tmdbId}), URL: ${url}`);
    const response = await axios.get(url, {
      timeout: 5000,
      headers: { "User-Agent": "NicFlix/1.0" }
    });
    const rawData = response.data;
    console.log("Raw IntroDB data:", JSON.stringify(rawData));

    const segments = [];
    if (rawData) {
      if (Array.isArray(rawData)) {
        rawData.forEach((s) => {
          const start = s.startTime ?? s.start_sec ?? s.startAt ?? s.start ?? null;
          const end = s.endTime ?? s.end_sec ?? s.endAt ?? s.end ?? null;
          if (start !== null && end !== null) {
            segments.push({ start: parseTime(start), end: parseTime(end), type: s.segment_type || s.type || "intro" });
          }
        });
      } else {
        // Handle nested structure: { intro: { start_sec, ... }, recap: ... }
        ["intro", "recap", "outro", "credits"].forEach((key) => {
          const s = rawData[key];
          if (s && (s.start_sec !== undefined || s.startTime !== undefined)) {
            segments.push({
              start: parseTime(s.start_sec ?? s.startTime),
              end: parseTime(s.end_sec ?? s.endTime),
              type: key
            });
          }
        });
        // Handle { segments: [...] }
        if (segments.length === 0 && Array.isArray(rawData.segments)) {
          rawData.segments.forEach((s) => {
            const start = s.startTime ?? s.start_sec ?? s.startAt ?? s.start ?? null;
            const end = s.endTime ?? s.end_sec ?? s.endAt ?? s.end ?? null;
            if (start !== null && end !== null) {
              segments.push({ start: parseTime(start), end: parseTime(end), type: s.segment_type || s.type || "intro" });
            }
          });
        }
      }
    }

    console.log("Normalized segments:", segments);
    res.json({ segments });
  } catch (error) {
    if (error.response?.status === 404) {
      console.log(`No segments found in IntroDB for ${imdbId || tmdbId}`);
    } else {
      console.error("IntroDB lookup failed:", error.message);
    }
    res.json({ segments: [] });
  }
});

api.get("/files/:fileId/next", (req, res) => {
  res.json({ next: getSeriesNavigation(req.params.fileId).next });
});

api.get("/files/:fileId/navigation", (req, res) => {
  res.json(getSeriesNavigation(req.params.fileId));
});

api.get("/subtitles/:fileId/external/:trackIndex", async (req, res, next) => {
  try {
    const file = getPlayableFile(req.params.fileId);
    const track = parseJsonArray(file?.external_subtitles)[Number(req.params.trackIndex)];
    if (!file || !track?.filePath || !fs.existsSync(track.filePath)) {
      res.status(404).json({ error: "Subtitle not found" });
      return;
    }

    const subtitle = await fs.promises.readFile(track.filePath, "utf8");
    res.type("text/vtt").send(srtToVtt(subtitle));
  } catch (error) {
    next(error);
  }
});

api.get("/subtitles/:fileId/embedded/:streamIndex", (req, res, next) => {
  const file = getPlayableFile(req.params.fileId);
  const streamIndex = Number(req.params.streamIndex);
  const track = parseJsonArray(file?.subtitle_tracks).find((item) => item.index === streamIndex);
  if (!file || !fs.existsSync(file.file_path) || !track) {
    res.status(404).json({ error: "Subtitle stream not found" });
    return;
  }

  res.type("text/vtt");
  ffmpeg(file.file_path)
    .outputOptions(["-map", `0:${streamIndex}`, "-f", "webvtt"])
    .on("error", next)
    .pipe(res, { end: true });
});

api.get("/progress/:fileId", (req, res) => {
  const progress = db.prepare("SELECT * FROM watch_progress WHERE file_id = ?").get(req.params.fileId);
  res.json({ progress: progress || { file_id: Number(req.params.fileId), position: 0, duration: null, watched: 0 } });
});

api.post("/progress/:fileId", (req, res) => {
  const position = Number(req.body.position || 0);
  const duration = Number(req.body.duration || 0) || null;
  const watched = req.body.watched === true || (duration && position / duration >= 0.9) ? 1 : 0;
  const file = db.prepare("SELECT media_item_id FROM files WHERE id = ?").get(req.params.fileId);
  if (file) {
    db.prepare(`
      DELETE FROM watch_progress 
      WHERE watched = 0 
        AND file_id != ? 
        AND file_id IN (SELECT id FROM files WHERE media_item_id = ?)
    `).run(req.params.fileId, file.media_item_id);
  }

  db.prepare(`
    INSERT INTO watch_progress (file_id, position, duration, watched, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(file_id) DO UPDATE SET
      position = excluded.position,
      duration = excluded.duration,
      watched = excluded.watched,
      updated_at = excluded.updated_at
  `).run(req.params.fileId, position, duration, watched, nowIso());
  res.json({ progress: db.prepare("SELECT * FROM watch_progress WHERE file_id = ?").get(req.params.fileId) });
});

api.delete("/progress/:fileId", (req, res) => {
  db.prepare("DELETE FROM watch_progress WHERE file_id = ?").run(req.params.fileId);
  res.json({ ok: true });
});

api.get("/admin/unmatched", (_req, res) => {
  const items = db.prepare(`
    SELECT m.*, f.id AS file_id, f.file_name
    FROM media_items m
    LEFT JOIN files f ON f.id = (
      SELECT candidate.id
      FROM files candidate
      WHERE candidate.media_item_id = m.id
      ORDER BY
        CASE WHEN candidate.episode_id IS NOT NULL THEN 0 ELSE 1 END,
        candidate.id
      LIMIT 1
    )
    WHERE m.tmdb_id IS NULL OR m.overview IS NULL
    GROUP BY m.id
    ORDER BY m.added_at DESC
  `).all().map(mediaWithFile);
  res.json({ items });
});

api.get("/admin/media", (req, res) => {
  const requestedType = String(req.query.type || "").trim();
  const type = requestedType === "tv" ? "tv" : "movie";
  const filePreferenceSql = type === "tv"
    ? "CASE WHEN candidate.episode_id IS NOT NULL THEN 0 ELSE 1 END, candidate.id"
    : "CASE WHEN candidate.episode_id IS NULL THEN 0 ELSE 1 END, candidate.id";
  const items = db.prepare(`
    SELECT m.*, f.id AS file_id, f.file_name
    FROM media_items m
    LEFT JOIN files f ON f.id = (
      SELECT candidate.id
      FROM files candidate
      WHERE candidate.media_item_id = m.id
      ORDER BY ${filePreferenceSql}
      LIMIT 1
    )
    WHERE m.type = ?
    GROUP BY m.id
    ORDER BY lower(m.title)
  `).all(type).map(mediaWithFile);
  res.json({ items });
});

api.get("/admin/tmdb-search", async (req, res, next) => {
  try {
    const type = req.query.type === "tv" ? "tv" : "movie";
    const query = String(req.query.q || "").trim();
    const results = query ? await searchTmdb(type, query) : [];
    res.json({ results });
  } catch (error) {
    next(error);
  }
});

api.post("/admin/media/:id/fix-match", async (req, res, next) => {
  try {
    if (!hasTmdbKey()) {
      res.status(400).json({ error: "TMDB API key is missing. Open Admin settings and add your free TMDB API key." });
      return;
    }

    const item = db.prepare("SELECT * FROM media_items WHERE id = ?").get(req.params.id);
    if (!item) {
      res.status(404).json({ error: "Media item not found" });
      return;
    }
    const metadata = item.type === "tv"
      ? await fetchTvMetadata(req.body.title || item.title, req.body.year || item.year)
      : await fetchMovieMetadata(req.body.title || item.title, req.body.year || item.year);
    if (!metadata) {
      res.status(404).json({ error: "No TMDB match found" });
      return;
    }
    db.prepare(`
      UPDATE media_items SET title = ?, original_title = ?, year = ?, overview = ?, poster_path = ?,
        backdrop_path = ?, tmdb_id = ?, imdb_id = ?, genres = ?, runtime = ?, rating = ?, updated_at = ?
      WHERE id = ?
    `).run(
      metadata.title,
      metadata.originalTitle,
      Number(metadata.year) || null,
      metadata.overview,
      metadata.posterPath,
      metadata.backdropPath,
      metadata.tmdbId,
      metadata.imdbId,
      JSON.stringify(metadata.genres || []),
      metadata.runtime,
      metadata.rating,
      nowIso(),
      item.id
    );
    if (item.type === "tv") {
      await refreshTvEpisodeMetadata(item.id, metadata.tmdbId, metadata.seasons);
    }
    res.json({ media: mediaWithFile(db.prepare("SELECT * FROM media_items WHERE id = ?").get(item.id)) });
  } catch (error) {
    next(error);
  }
});

api.patch("/admin/media/:id", (req, res) => {
  const allowed = ["title", "year", "overview", "poster_path", "backdrop_path", "ignored"];
  const updates = Object.entries(req.body).filter(([key]) => allowed.includes(key));
  if (!updates.length) {
    res.status(400).json({ error: "No editable fields supplied" });
    return;
  }
  const setSql = updates.map(([key]) => `${key} = ?`).join(", ");
  db.prepare(`UPDATE media_items SET ${setSql}, updated_at = ? WHERE id = ?`)
    .run(...updates.map(([, value]) => value), nowIso(), req.params.id);
  res.json({ media: mediaWithFile(db.prepare("SELECT * FROM media_items WHERE id = ?").get(req.params.id)) });
});

api.delete("/admin/media/:id", (req, res) => {
  const item = db.prepare("SELECT * FROM media_items WHERE id = ?").get(req.params.id);
  if (!item) {
    res.status(404).json({ error: "Media item not found" });
    return;
  }

  const removeMediaItem = db.transaction((mediaItemId) => {
    const fileIds = db.prepare("SELECT id FROM files WHERE media_item_id = ?").all(mediaItemId).map((row) => row.id);
    if (fileIds.length) {
      db.prepare(`DELETE FROM watch_progress WHERE file_id IN (${fileIds.map(() => "?").join(",")})`).run(...fileIds);
    }
    db.prepare("DELETE FROM files WHERE media_item_id = ?").run(mediaItemId);
    db.prepare("DELETE FROM episodes WHERE media_item_id = ?").run(mediaItemId);
    db.prepare("DELETE FROM seasons WHERE media_item_id = ?").run(mediaItemId);
    db.prepare("DELETE FROM media_items WHERE id = ?").run(mediaItemId);
  });

  removeMediaItem(item.id);
  res.json({ ok: true });
});

api.patch("/admin/files/:id/ignore", (req, res) => {
  const file = db.prepare("SELECT * FROM files WHERE id = ?").get(req.params.id);
  if (!file?.media_item_id) {
    res.status(404).json({ error: "File not found" });
    return;
  }
  db.prepare("UPDATE media_items SET ignored = 1, updated_at = ? WHERE id = ?").run(nowIso(), file.media_item_id);
  res.json({ ok: true });
});
