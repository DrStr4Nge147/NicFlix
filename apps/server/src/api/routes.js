import express from "express";
import fs from "node:fs";
import path from "node:path";
import mime from "mime-types";
import ffmpeg from "fluent-ffmpeg";
import { db, nowIso, rowToMedia } from "../db/database.js";
import { scanLibrary } from "../scanner/scanner.js";
import { searchTmdb, fetchMovieMetadata, fetchTvMetadata } from "../metadata/tmdb.js";

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
    JOIN files f ON f.episode_id = e.id
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
    JOIN files f ON f.episode_id = e.id
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
      m.title AS media_title,
      m.type,
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
    title: row.media_title || row.file_name,
    subtitle: row.episode_number
      ? `S${row.season_number}:E${row.episode_number}${row.episode_title ? ` - ${row.episode_title}` : ""}`
      : null,
    type: row.type
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

api.post("/libraries", (req, res) => {
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
  res.status(201).json({ library });
});

api.patch("/libraries/:id", (req, res) => {
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
    res.json({ library: db.prepare("SELECT * FROM libraries WHERE id = ?").get(req.params.id) });
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
      res.status(409).json({ error: "A library with that path already exists" });
      return;
    }
    throw error;
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
      e.episode_number
    FROM watch_progress wp
    JOIN files f ON f.id = wp.file_id
    JOIN media_items m ON m.id = f.media_item_id
    LEFT JOIN episodes e ON e.id = f.episode_id
    WHERE wp.watched = 0 AND wp.position > 30 AND m.ignored = 0
    ORDER BY wp.updated_at DESC
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
    LEFT JOIN files f ON f.episode_id = e.id
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
    res.json({ results: [] });
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

api.get("/admin/unmatched", (_req, res) => {
  const items = db.prepare(`
    SELECT m.*, f.id AS file_id, f.file_name
    FROM media_items m
    LEFT JOIN files f ON f.media_item_id = m.id
    WHERE m.tmdb_id IS NULL OR m.overview IS NULL
    GROUP BY m.id
    ORDER BY m.added_at DESC
  `).all().map(mediaWithFile);
  res.json({ items });
});

api.get("/admin/media", (req, res) => {
  const requestedType = String(req.query.type || "").trim();
  const type = requestedType === "tv" ? "tv" : "movie";
  const items = db.prepare(`
    SELECT m.*, f.id AS file_id, f.file_name
    FROM media_items m
    LEFT JOIN files f ON f.media_item_id = m.id AND f.episode_id IS NULL
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
    const item = db.prepare("SELECT * FROM media_items WHERE id = ?").get(req.params.id);
    if (!item) {
      res.status(404).json({ error: "Media item not found" });
      return;
    }
    const metadata = item.type === "tv"
      ? await fetchTvMetadata(req.body.title || item.title)
      : await fetchMovieMetadata(req.body.title || item.title, req.body.year || item.year);
    if (!metadata) {
      res.status(404).json({ error: "No TMDB match found" });
      return;
    }
    db.prepare(`
      UPDATE media_items SET title = ?, original_title = ?, year = ?, overview = ?, poster_path = ?,
        backdrop_path = ?, tmdb_id = ?, genres = ?, runtime = ?, rating = ?, updated_at = ?
      WHERE id = ?
    `).run(
      metadata.title,
      metadata.originalTitle,
      Number(metadata.year) || null,
      metadata.overview,
      metadata.posterPath,
      metadata.backdropPath,
      metadata.tmdbId,
      JSON.stringify(metadata.genres || []),
      metadata.runtime,
      metadata.rating,
      nowIso(),
      item.id
    );
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

api.patch("/admin/files/:id/ignore", (req, res) => {
  const file = db.prepare("SELECT * FROM files WHERE id = ?").get(req.params.id);
  if (!file?.media_item_id) {
    res.status(404).json({ error: "File not found" });
    return;
  }
  db.prepare("UPDATE media_items SET ignored = 1, updated_at = ? WHERE id = ?").run(nowIso(), file.media_item_id);
  res.json({ ok: true });
});
