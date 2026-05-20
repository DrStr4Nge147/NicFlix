# NicFlix

Local-first media library MVP built with Node.js, Express, SQLite, Vite, and React.

## Setup

### One-click Windows install

Double click `install.bat`.

The installer creates local files from the checked-in examples and installs all npm dependencies:

- `apps/server/.env` from `apps/server/.env.example`
- `config.json` from `config.example.json`

After install, edit `config.json` so the library paths point to your media folders. Add a TMDB API key to `apps/server/.env` if you want metadata lookup.

Then double click `Start NicFlix.bat`.

### Manual setup

1. Copy `apps/server/.env.example` to `apps/server/.env`.
2. Copy `config.example.json` to `config.json`.
3. Add your TMDB API key if you want metadata lookup.
4. Edit `config.json` so the library paths point to your media folders.
5. Install dependencies:

```sh
npm install
```

6. Start both apps:

```sh
npm run dev
```

Frontend: `http://localhost:5173`  
Backend: `http://localhost:4000/api`

## Notes

The MVP supports direct browser playback. MP4/H.264/AAC files are most reliable. Other containers may scan correctly but may not play in every browser until transcoding is added.
