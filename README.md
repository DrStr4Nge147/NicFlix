# NicFlix

Local-first media library MVP built with Node.js, Express, SQLite, Vite, and React.

## Setup

### One-click Windows install

Double click `install.bat`.

The installer creates local files from the checked-in examples and installs all npm dependencies:

- `apps/server/.env` from `apps/server/.env.example`
- `config.json` from `config.example.json`

After install, add a TMDB API key to `apps/server/.env` if you want metadata lookup.

Then double click `Start NicFlix.bat`.

Open Admin in NicFlix to add your media folders and scan them.

### Manual setup

1. Copy `apps/server/.env.example` to `apps/server/.env`.
2. Copy `config.example.json` to `config.json`.
3. Add your TMDB API key if you want metadata lookup.
4. Install dependencies:

```sh
npm install
```

5. Start both apps:

```sh
npm run dev
```

Frontend: `http://localhost:6001`  
Backend: `http://localhost:4000/api`

Open Admin in NicFlix to add your media folders and scan them.

## Notes

The MVP supports direct browser playback. MP4/H.264/AAC files are most reliable. Other containers may scan correctly but may not play in every browser until transcoding is added.
