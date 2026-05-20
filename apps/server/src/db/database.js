import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { databasePath, ensureDataDirs } from "../config/paths.js";

ensureDataDirs();
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

export const db = new Database(databasePath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

export function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS libraries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS media_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      library_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      original_title TEXT,
      year INTEGER,
      overview TEXT,
      poster_path TEXT,
      backdrop_path TEXT,
      tmdb_id INTEGER,
      imdb_id TEXT,
      added_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      ignored INTEGER DEFAULT 0,
      genres TEXT,
      runtime INTEGER,
      rating REAL,
      FOREIGN KEY (library_id) REFERENCES libraries(id)
    );

    CREATE TABLE IF NOT EXISTS seasons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      media_item_id INTEGER NOT NULL,
      season_number INTEGER NOT NULL,
      title TEXT,
      overview TEXT,
      poster_path TEXT,
      UNIQUE(media_item_id, season_number),
      FOREIGN KEY (media_item_id) REFERENCES media_items(id)
    );

    CREATE TABLE IF NOT EXISTS episodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      media_item_id INTEGER NOT NULL,
      season_id INTEGER,
      season_number INTEGER NOT NULL,
      episode_number INTEGER NOT NULL,
      title TEXT,
      overview TEXT,
      still_path TEXT,
      air_date TEXT,
      UNIQUE(media_item_id, season_number, episode_number),
      FOREIGN KEY (media_item_id) REFERENCES media_items(id),
      FOREIGN KEY (season_id) REFERENCES seasons(id)
    );

    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      media_item_id INTEGER,
      episode_id INTEGER,
      file_path TEXT NOT NULL UNIQUE,
      file_name TEXT NOT NULL,
      file_size INTEGER,
      duration REAL,
      width INTEGER,
      height INTEGER,
      video_codec TEXT,
      audio_codec TEXT,
      audio_tracks TEXT,
      subtitle_tracks TEXT,
      external_subtitles TEXT,
      container TEXT,
      modified_at TEXT,
      added_at TEXT NOT NULL,
      FOREIGN KEY (media_item_id) REFERENCES media_items(id),
      FOREIGN KEY (episode_id) REFERENCES episodes(id)
    );

    CREATE TABLE IF NOT EXISTS watch_progress (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_id INTEGER NOT NULL UNIQUE,
      position REAL NOT NULL DEFAULT 0,
      duration REAL,
      watched INTEGER DEFAULT 0,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (file_id) REFERENCES files(id)
    );
  `);

  const fileColumns = db.prepare("PRAGMA table_info(files)").all().map((column) => column.name);
  const addColumn = (name, sql) => {
    if (!fileColumns.includes(name)) db.prepare(`ALTER TABLE files ADD COLUMN ${name} ${sql}`).run();
  };
  addColumn("audio_tracks", "TEXT");
  addColumn("subtitle_tracks", "TEXT");
  addColumn("external_subtitles", "TEXT");

  const mediaColumns = db.prepare("PRAGMA table_info(media_items)").all().map((column) => column.name);
  if (!mediaColumns.includes("imdb_id")) {
    db.prepare("ALTER TABLE media_items ADD COLUMN imdb_id TEXT").run();
  }

  consolidateDuplicateTvShows();
  consolidateDuplicateMovies();
  createMediaUniquenessIndexes();
}

function mergeMediaMetadata(canonical, duplicate) {
  db.prepare(`
    UPDATE media_items SET
      original_title = COALESCE(original_title, ?),
      year = COALESCE(year, ?),
      overview = COALESCE(overview, ?),
      poster_path = COALESCE(poster_path, ?),
      backdrop_path = COALESCE(backdrop_path, ?),
      tmdb_id = COALESCE(tmdb_id, ?),
      imdb_id = COALESCE(imdb_id, ?),
      genres = CASE WHEN genres IS NULL OR genres = '[]' THEN ? ELSE genres END,
      runtime = COALESCE(runtime, ?),
      rating = COALESCE(rating, ?),
      updated_at = ?
    WHERE id = ?
  `).run(
    duplicate.original_title,
    duplicate.year,
    duplicate.overview,
    duplicate.poster_path,
    duplicate.backdrop_path,
    duplicate.tmdb_id,
    duplicate.imdb_id,
    duplicate.genres,
    duplicate.runtime,
    duplicate.rating,
    nowIso(),
    canonical.id
  );
}

function consolidateDuplicateTvShows() {
  const groups = db.prepare(`
    SELECT library_id, duplicate_key, COUNT(*) AS count
    FROM (
      SELECT
        library_id,
        CASE
          WHEN tmdb_id IS NOT NULL THEN 'tmdb:' || tmdb_id
          ELSE 'title:' || lower(title)
        END AS duplicate_key
      FROM media_items
      WHERE type = 'tv'
    )
    GROUP BY library_id, duplicate_key
    HAVING count > 1
  `).all();

  if (!groups.length) return;

  const mergeGroup = db.transaction((libraryId, duplicateKey) => {
    const items = db.prepare(`
      SELECT *
      FROM media_items
      WHERE type = 'tv'
        AND library_id = ?
        AND (CASE
          WHEN tmdb_id IS NOT NULL THEN 'tmdb:' || tmdb_id
          ELSE 'title:' || lower(title)
        END) = ?
      ORDER BY ignored ASC, id ASC
    `).all(libraryId, duplicateKey);

    const canonical = items[0];
    if (!canonical) return;

    const insertSeason = db.prepare(`
      INSERT OR IGNORE INTO seasons (media_item_id, season_number, title, overview, poster_path)
      VALUES (?, ?, ?, ?, ?)
    `);
    const getSeason = db.prepare("SELECT * FROM seasons WHERE media_item_id = ? AND season_number = ?");
    const getEpisode = db.prepare(`
      SELECT * FROM episodes
      WHERE media_item_id = ? AND season_number = ? AND episode_number = ?
    `);
    const updateEpisode = db.prepare("UPDATE episodes SET media_item_id = ?, season_id = ? WHERE id = ?");
    const updateEpisodeFiles = db.prepare("UPDATE files SET media_item_id = ?, episode_id = ? WHERE episode_id = ?");
    const deleteEpisode = db.prepare("DELETE FROM episodes WHERE id = ?");

    for (const duplicate of items.slice(1)) {
      mergeMediaMetadata(canonical, duplicate);

      const seasons = db.prepare("SELECT * FROM seasons WHERE media_item_id = ? ORDER BY season_number").all(duplicate.id);
      for (const season of seasons) {
        insertSeason.run(canonical.id, season.season_number, season.title, season.overview, season.poster_path);
      }

      const episodes = db.prepare("SELECT * FROM episodes WHERE media_item_id = ? ORDER BY season_number, episode_number").all(duplicate.id);
      for (const episode of episodes) {
        const season = getSeason.get(canonical.id, episode.season_number);
        const existingEpisode = getEpisode.get(canonical.id, episode.season_number, episode.episode_number);

        if (existingEpisode) {
          updateEpisodeFiles.run(canonical.id, existingEpisode.id, episode.id);
          deleteEpisode.run(episode.id);
        } else {
          updateEpisode.run(canonical.id, season?.id || null, episode.id);
          db.prepare("UPDATE files SET media_item_id = ? WHERE episode_id = ?").run(canonical.id, episode.id);
        }
      }

      db.prepare("UPDATE files SET media_item_id = ? WHERE media_item_id = ?").run(canonical.id, duplicate.id);
      db.prepare("DELETE FROM seasons WHERE media_item_id = ?").run(duplicate.id);
      db.prepare("DELETE FROM media_items WHERE id = ?").run(duplicate.id);
    }
  });

  for (const group of groups) {
    mergeGroup(group.library_id, group.duplicate_key);
  }
}

function consolidateDuplicateMovies() {
  const groups = db.prepare(`
    SELECT library_id, duplicate_key, COUNT(*) AS count
    FROM (
      SELECT
        library_id,
        CASE
          WHEN tmdb_id IS NOT NULL THEN 'tmdb:' || tmdb_id
          ELSE 'title:' || lower(title) || ':year:' || COALESCE(year, 0)
        END AS duplicate_key
      FROM media_items
      WHERE type = 'movie'
    )
    GROUP BY library_id, duplicate_key
    HAVING count > 1
  `).all();

  if (!groups.length) return;

  const mergeGroup = db.transaction((libraryId, duplicateKey) => {
    const items = db.prepare(`
      SELECT *
      FROM media_items
      WHERE type = 'movie'
        AND library_id = ?
        AND (CASE
          WHEN tmdb_id IS NOT NULL THEN 'tmdb:' || tmdb_id
          ELSE 'title:' || lower(title) || ':year:' || COALESCE(year, 0)
        END) = ?
      ORDER BY ignored ASC, id ASC
    `).all(libraryId, duplicateKey);

    const canonical = items[0];
    if (!canonical) return;

    for (const duplicate of items.slice(1)) {
      mergeMediaMetadata(canonical, duplicate);
      db.prepare("UPDATE files SET media_item_id = ? WHERE media_item_id = ?").run(canonical.id, duplicate.id);
      db.prepare("DELETE FROM media_items WHERE id = ?").run(duplicate.id);
    }
  });

  for (const group of groups) {
    mergeGroup(group.library_id, group.duplicate_key);
  }
}

function createMediaUniquenessIndexes() {
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_media_items_unique_tmdb
      ON media_items(library_id, type, tmdb_id)
      WHERE tmdb_id IS NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_media_items_unique_movie_title_year_unmatched
      ON media_items(library_id, lower(title), COALESCE(year, 0))
      WHERE type = 'movie' AND tmdb_id IS NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_media_items_unique_tv_title_unmatched
      ON media_items(library_id, lower(title))
      WHERE type = 'tv' AND tmdb_id IS NULL;
  `);
}

export function nowIso() {
  return new Date().toISOString();
}

export function rowToMedia(row) {
  if (!row) return null;
  return {
    ...row,
    genres: row.genres ? JSON.parse(row.genres) : [],
    audio_tracks: row.audio_tracks ? JSON.parse(row.audio_tracks) : [],
    subtitle_tracks: row.subtitle_tracks ? JSON.parse(row.subtitle_tracks) : [],
    external_subtitles: row.external_subtitles ? JSON.parse(row.external_subtitles) : []
  };
}
