# NicFlix MVP

A local-first Plex-like / Netflix-style media library app for personal movies and TV shows.  
Built with Node.js, Vite, React, SQLite, and FFmpeg tools.

## Goal

Create a simple personal media server that can scan local movie and TV show folders, auto-detect media files, fetch metadata, display them in a Netflix-style UI, and play supported files in the browser without requiring login.

The MVP should focus on local network use first, not public remote streaming.

## Main Concept

The app has two parts:

```txt
Frontend: Vite + React
Backend: Node.js + Express
Database: SQLite
Media tools: FFmpeg / ffprobe
Metadata source: TMDB API
```

The backend scans selected folders, stores media information in SQLite, fetches posters/backdrops/plot info from TMDB, and serves media files to the React frontend.

The frontend displays movies and TV shows in a clean streaming-style interface.

## MVP Scope

### Included in MVP

- No login required
- Local network use
- Movies library
- TV shows library
- Folder scanning
- Auto-detect movies from filenames
- Auto-detect TV episodes using `S01E01` pattern
- Fetch metadata from TMDB
- Store metadata in SQLite
- Netflix-style homepage
- Movie detail page
- TV show detail page
- Season and episode list
- Video playback through browser
- Save watch progress
- Recently added row
- Continue watching row
- Manual rescan button
- Basic metadata correction page

### Not Included in MVP

- Full transcoding
- Remote access
- Multiple users
- User profiles
- Mobile app packaging
- Downloads
- Live TV
- Advanced subtitle handling
- Complex admin permissions
- Cloud sync

## Recommended MVP Limitation

For the first version, support direct playback only.

This means the app should work best with browser-friendly files:

```txt
Video: MP4 / H.264
Audio: AAC
Container: .mp4
```

Files like `.mkv`, HEVC/H.265, DTS audio, or complex subtitle formats may not play in all browsers until transcoding is added later.

## Example Media Folder Structure

```txt
C:/Media/
  Movies/
    Inception (2010)/
      Inception (2010).mp4

    Interstellar (2014)/
      Interstellar (2014).mkv

  TV Shows/
    Breaking Bad/
      Season 01/
        Breaking Bad - S01E01.mp4
        Breaking Bad - S01E02.mp4

    The Last of Us/
      Season 01/
        The Last of Us - S01E01.mp4
```

The app should allow configuring folder paths in a config file first.

Example:

```json
{
  "libraries": [
    {
      "type": "movies",
      "name": "Movies",
      "path": "C:/Media/Movies"
    },
    {
      "type": "tv",
      "name": "TV Shows",
      "path": "C:/Media/TV Shows"
    }
  ]
}
```

## Core Features

## 1. Library Scanner

The backend should scan configured folders and detect media files.

Supported file extensions for MVP:

```txt
.mp4
.mkv
.mov
.avi
.webm
```

The scanner should store:

- file name
- full path
- library type
- file size
- created date
- modified date
- duration
- resolution
- codec information
- detected title
- detected year
- season number
- episode number

Use `ffprobe` to extract technical metadata.

## 2. Filename Parsing

### Movie Parsing

Example filenames:

```txt
Inception (2010).mp4
Interstellar.2014.1080p.BluRay.mp4
The Dark Knight (2008).mkv
```

The parser should try to detect:

- title
- year
- quality tags to ignore

Common tags to remove:

```txt
1080p
720p
2160p
4K
BluRay
WEBRip
WEB-DL
HDRip
x264
x265
HEVC
AAC
DTS
YIFY
RARBG
```

### TV Episode Parsing

Example filenames:

```txt
Breaking Bad - S01E01.mp4
Breaking.Bad.S02E05.1080p.WEB-DL.mkv
The Last of Us S01E03.mp4
```

The parser should detect:

- show title
- season number
- episode number

Required pattern support:

```txt
S01E01
s01e01
S1E1
1x01
```

## 3. Metadata Fetching

Use TMDB API to fetch movie and TV metadata.

For movies, fetch:

- title
- original title
- year
- overview
- poster image
- backdrop image
- genres
- runtime
- rating

For TV shows, fetch:

- show title
- overview
- poster image
- backdrop image
- genres
- seasons
- episode titles
- episode overviews
- episode still images
- air dates

Store fetched metadata locally in SQLite.

## 4. Manual Metadata Correction

Because auto-detection can be wrong, the app needs a simple correction page.

Admin features:

- Fix movie match
- Fix TV show match
- Search TMDB manually
- Choose correct match
- Edit title
- Edit year
- Edit overview
- Change poster
- Change backdrop
- Mark item as ignored

For MVP, this can be a simple `/admin` page.

## 5. Video Player

Use the native HTML5 video player first.

Basic player features:

- play
- pause
- seek
- volume
- fullscreen
- save progress
- resume progress

Progress should be saved every 10 seconds.

Resume logic:

- If progress is less than 90%, show in Continue Watching
- If progress is 90% or more, mark as watched

## 6. Netflix-Style UI

The homepage should include rows:

```txt
Continue Watching
Recently Added
Movies
TV Shows
Action
Comedy
Drama
Sci-Fi
```

Each card should show:

- poster
- title
- year
- watched progress indicator

Clicking a movie opens its detail page.

Clicking a TV show opens its show page with seasons and episodes.

## 7. Search

Basic search should allow searching:

- movie title
- show title
- episode title

MVP search can be local database search only.

## Database

Use SQLite for the MVP.

Recommended package:

```txt
better-sqlite3
```

## Tables

### libraries

```sql
CREATE TABLE libraries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  path TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

### media_items

Used for movies and TV shows.

```sql
CREATE TABLE media_items (
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
  added_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  ignored INTEGER DEFAULT 0,
  FOREIGN KEY (library_id) REFERENCES libraries(id)
);
```

### seasons

```sql
CREATE TABLE seasons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  media_item_id INTEGER NOT NULL,
  season_number INTEGER NOT NULL,
  title TEXT,
  overview TEXT,
  poster_path TEXT,
  FOREIGN KEY (media_item_id) REFERENCES media_items(id)
);
```

### episodes

```sql
CREATE TABLE episodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  media_item_id INTEGER NOT NULL,
  season_id INTEGER,
  season_number INTEGER NOT NULL,
  episode_number INTEGER NOT NULL,
  title TEXT,
  overview TEXT,
  still_path TEXT,
  air_date TEXT,
  FOREIGN KEY (media_item_id) REFERENCES media_items(id),
  FOREIGN KEY (season_id) REFERENCES seasons(id)
);
```

### files

```sql
CREATE TABLE files (
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
  container TEXT,
  modified_at TEXT,
  added_at TEXT NOT NULL,
  FOREIGN KEY (media_item_id) REFERENCES media_items(id),
  FOREIGN KEY (episode_id) REFERENCES episodes(id)
);
```

### watch_progress

```sql
CREATE TABLE watch_progress (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id INTEGER NOT NULL UNIQUE,
  position REAL NOT NULL DEFAULT 0,
  duration REAL,
  watched INTEGER DEFAULT 0,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (file_id) REFERENCES files(id)
);
```

## Backend API Routes

Base URL:

```txt
http://localhost:4000/api
```

### Library

```txt
GET    /api/libraries
POST   /api/libraries
POST   /api/libraries/:id/scan
```

### Home

```txt
GET /api/home
```

Returns rows:

```json
{
  "rows": [
    {
      "title": "Continue Watching",
      "items": []
    },
    {
      "title": "Recently Added",
      "items": []
    },
    {
      "title": "Movies",
      "items": []
    },
    {
      "title": "TV Shows",
      "items": []
    }
  ]
}
```

### Movies

```txt
GET /api/movies
GET /api/movies/:id
```

### TV Shows

```txt
GET /api/shows
GET /api/shows/:id
GET /api/shows/:id/seasons
```

### Playback

```txt
GET  /api/stream/:fileId
GET  /api/progress/:fileId
POST /api/progress/:fileId
```

Example progress body:

```json
{
  "position": 523.2,
  "duration": 7200.0
}
```

### Search

```txt
GET /api/search?q=inception
```

### Admin Metadata

```txt
GET  /api/admin/unmatched
POST /api/admin/media/:id/fix-match
PATCH /api/admin/media/:id
PATCH /api/admin/files/:id/ignore
```

## Frontend Pages

Use React Router.

```txt
/
Homepage with media rows

/movies
Movie library

/movies/:id
Movie detail page

/shows
TV show library

/shows/:id
TV show detail page

/watch/:fileId
Video player page

/search
Search results

/admin
Admin dashboard

/admin/unmatched
Unmatched media list

/admin/media/:id/edit
Metadata editor
```

## Suggested Frontend Components

```txt
AppLayout
Navbar
Sidebar
HeroBanner
MediaRow
MediaCard
ProgressBar
MovieDetail
ShowDetail
SeasonTabs
EpisodeList
VideoPlayer
SearchBar
AdminLayout
MetadataEditor
ScanButton
```

## Suggested Project Structure

```txt
  nicflix/
  apps/
    client/
      src/
        components/
        pages/
        lib/
        styles/
        App.jsx
        main.jsx
      package.json
      vite.config.js

    server/
      src/
        api/
        db/
        scanner/
        metadata/
        parser/
        stream/
        config/
        index.js
      package.json

  data/
    app.db
    posters/
    backdrops/
    thumbnails/

  config.json
  package.json
  README.md
```

## Backend Packages

```txt
express
cors
better-sqlite3
chokidar
fluent-ffmpeg
dotenv
axios
mime-types
```

Optional:

```txt
node-cron
zod
pino
```

## Frontend Packages

```txt
react
react-dom
vite
react-router-dom
lucide-react
```

Optional UI tools:

```txt
tailwindcss
framer-motion
```

## Environment Variables

Create `.env` inside server:

```env
PORT=4000
TMDB_API_KEY=your_tmdb_api_key_here
DATABASE_PATH=../../data/app.db
CONFIG_PATH=../../config.json
```

## Streaming Route Behavior

The `/api/stream/:fileId` route should support HTTP range requests.

This is required so the browser can seek through video files.

Basic behavior:

- Get file path from database
- Check if file exists
- Read `Range` header
- Return partial content with `206`
- Set correct `Content-Range`
- Set correct `Content-Length`
- Set correct `Content-Type`

## Watch Progress Logic

When video plays:

- Send progress every 10 seconds
- Send progress when user pauses
- Send progress before leaving page

Backend rule:

```txt
if position / duration >= 0.9:
  watched = true
else:
  watched = false
```

Continue Watching should show only files where:

```txt
watched = false
position > 30 seconds
```

## Metadata Image Storage

Download poster and backdrop images locally.

Recommended folders:

```txt
data/posters/
data/backdrops/
data/thumbnails/
```

Store local paths in the database.

This avoids depending on online images after metadata is downloaded.

## MVP Development Phases

## Phase 1: Basic Setup

- Create monorepo folder
- Setup Vite React frontend
- Setup Express backend
- Setup SQLite database
- Create config file for media folders
- Create basic API health check

## Phase 2: Scanner

- Scan configured folders
- Detect media file extensions
- Save files to database
- Extract technical metadata using ffprobe
- Avoid duplicate entries using file path

## Phase 3: Filename Parser

- Parse movie title and year
- Parse TV show season and episode
- Remove common release tags
- Save parsed results

## Phase 4: TMDB Metadata

- Add TMDB API client
- Search movie metadata
- Search TV metadata
- Save poster, backdrop, overview, genres
- Download images locally
- Mark unmatched files

## Phase 5: Backend API

- Create home route
- Create movie routes
- Create TV show routes
- Create search route
- Create stream route with range support
- Create watch progress routes

## Phase 6: Frontend UI

- Create Netflix-style homepage
- Create media cards
- Create movie detail page
- Create show detail page
- Create season/episode view
- Create video player page

## Phase 7: Admin Tools

- Add scan button
- Add unmatched media page
- Add manual metadata correction
- Add ignore file option

## Phase 8: Polish

- Add loading states
- Add empty states
- Add responsive layout
- Add keyboard support for search
- Add error handling
- Add simple settings page

## Basic UI Direction

Style should feel like Netflix but not copied exactly.

Suggested mood:

```txt
Dark theme
Large poster cards
Horizontal scrolling rows
Big hero section
Clean typography
Subtle hover scale
Minimal buttons
```

Color direction:

```txt
Background: near-black
Cards: dark gray
Primary accent: red or blue
Text: white / gray
```

## App Name

```txt
NicFlix
```

## Future Features After MVP

- Full FFmpeg transcoding
- HLS streaming
- Subtitle extraction
- Subtitle upload
- Remote access
- Mobile PWA
- Multiple users
- Profiles
- Watch history
- Ratings
- Collections
- Smart playlists
- Trailer support
- Theme customization
- Desktop app using Electron
- One-click installer
- NAS support
- Cloudflare Tunnel or zrok support
- Hardware acceleration for transcoding

## Notes for AI Developer

Prioritize a working local MVP over advanced Plex-like features.

Do not start with transcoding.  
Do not start with authentication.  
Do not start with remote access.

First target:

```txt
Scan folders -> detect files -> fetch metadata -> show UI -> play video -> save progress
```

Once this core loop works, then improve compatibility and polish.
