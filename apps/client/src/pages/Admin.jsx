import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronLeft,
  ExternalLink,
  Eye,
  EyeOff,
  Folder,
  FolderPlus,
  HardDrive,
  KeyRound,
  Pencil,
  RefreshCw,
  Save,
  Search,
  Trash2
} from "lucide-react";
import { apiFetch } from "../lib/api.js";
import { useBulkTmdb } from "../lib/bulkTmdb.jsx";

const emptyLibraryForm = {
  id: null,
  name: "",
  type: "movies",
  path: ""
};

export default function Admin() {
  const [libraries, setLibraries] = useState([]);
  const [unmatched, setUnmatched] = useState([]);
  const [mediaItems, setMediaItems] = useState([]);
  const [mediaQuery, setMediaQuery] = useState("");
  const [status, setStatus] = useState("");
  const [tmdbStatus, setTmdbStatus] = useState("");
  const [settings, setSettings] = useState(null);
  const [tmdbApiKey, setTmdbApiKey] = useState("");
  const [showTmdbKey, setShowTmdbKey] = useState(false);
  const [editing, setEditing] = useState(null);
  const [libraryForm, setLibraryForm] = useState(emptyLibraryForm);
  const [browser, setBrowser] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const mounted = useRef(false);
  const { task: bulkTmdb, startBulkTmdb, scanTask, startScan } = useBulkTmdb();

  async function load() {
    const [libraryData, unmatchedData, movieData, showData, settingsData] = await Promise.all([
      apiFetch("/libraries"),
      apiFetch("/admin/unmatched"),
      apiFetch("/admin/media?type=movie"),
      apiFetch("/admin/media?type=tv"),
      apiFetch("/admin/settings")
    ]);
    setLibraries(libraryData.libraries);
    setUnmatched(unmatchedData.items);
    setMediaItems([...movieData.items, ...showData.items].sort((a, b) => a.title.localeCompare(b.title)));
    setSettings(settingsData.settings);
  }

  useEffect(() => {
    mounted.current = true;
    load();

    return () => {
      mounted.current = false;
    };
  }, []);

  async function scan(library) {
    try {
      const result = await startScan(library);
      if (!mounted.current || !result) return;
      setStatus(`Scanned ${result.scanned} files. Added ${result.added}, updated ${result.updated}.`);
      await load();
    } catch (error) {
      if (!mounted.current) return;
      setStatus(error.message);
    }
  }

  async function saveLibrary(event) {
    event.preventDefault();
    const payload = {
      name: libraryForm.name.trim(),
      type: libraryForm.type,
      path: libraryForm.path.trim()
    };
    const endpoint = libraryForm.id ? `/libraries/${libraryForm.id}` : "/libraries";
    const method = libraryForm.id ? "PATCH" : "POST";
    try {
      const data = await apiFetch(endpoint, { method, body: JSON.stringify(payload) });
      setStatus(data.scan
        ? `${libraryForm.id ? "Library updated" : "Library added"} and scanned ${data.scan.scanned} files. Added ${data.scan.added}, updated ${data.scan.updated}.`
        : libraryForm.id ? "Library updated." : "Library added.");
      setLibraryForm(emptyLibraryForm);
      await load();
    } catch (error) {
      setStatus(error.message);
    }
  }

  function askForConfirmation(options) {
    setConfirmDialog(options);
  }

  async function deleteLibrary(library) {
    try {
      await apiFetch(`/libraries/${library.id}`, { method: "DELETE" });
      setStatus("Library removed.");
      if (libraryForm.id === library.id) setLibraryForm(emptyLibraryForm);
      await load();
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function deleteMediaItem(item) {
    try {
      await apiFetch(`/admin/media/${item.id}`, { method: "DELETE" });
      setStatus(`Removed "${item.title}".`);
      if (editing?.id === item.id) setEditing(null);
      await load();
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function openBrowser(startPath = libraryForm.path) {
    try {
      const pathQuery = startPath ? `?path=${encodeURIComponent(startPath)}` : "";
      const data = await apiFetch(`/fs/directories${pathQuery}`);
      setBrowser(data);
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function browseTo(folderPath) {
    await openBrowser(folderPath);
  }

  function chooseBrowsedFolder() {
    setLibraryForm((current) => ({ ...current, path: browser.currentPath }));
    setBrowser(null);
  }

  async function saveEdit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await apiFetch(`/admin/media/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: form.get("title"),
          year: form.get("year") ? Number(form.get("year")) : null,
          overview: form.get("overview")
        })
      });
      setStatus("Metadata saved.");
      setEditing(null);
      await load();
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function fixMatch(item) {
    try {
      setStatus(`Searching TMDB for ${item.title}...`);
      await apiFetch(`/admin/media/${item.id}/fix-match`, {
        method: "POST",
        body: JSON.stringify({ title: item.title, year: item.year })
      });
      setStatus("Metadata updated.");
      await load();
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function fixAllMatches() {
    if (!unmatched.length || bulkTmdb.running) return;

    const result = await startBulkTmdb(unmatched);
    await load();
    setStatus(result.missed
      ? `Updated ${result.updated}. ${result.missed} still need review.`
      : `Updated ${result.updated} items from TMDB.`);
  }

  async function saveTmdbSettings(event) {
    event.preventDefault();
    try {
      const data = await apiFetch("/admin/settings/tmdb", {
        method: "PATCH",
        body: JSON.stringify({ tmdbApiKey })
      });
      setSettings(data.settings);
      setTmdbApiKey("");
      setTmdbStatus(data.test?.message || "TMDB settings saved.");
    } catch (error) {
      setTmdbStatus(error.message);
    }
  }

  async function testTmdbSettings() {
    try {
      const data = await apiFetch("/admin/settings/tmdb", {
        method: "PATCH",
        body: JSON.stringify({ tmdbApiKey, testOnly: true })
      });
      setTmdbStatus(data.test?.message || "TMDB connected successfully.");
    } catch (error) {
      setTmdbStatus(error.message);
    }
  }

  async function disconnectTmdbSettings() {
    try {
      const data = await apiFetch("/admin/settings/tmdb", { method: "DELETE" });
      setSettings(data.settings);
      setTmdbApiKey("");
      setTmdbStatus(data.message || "TMDB API key disconnected.");
    } catch (error) {
      setTmdbStatus(error.message);
    }
  }

  async function togglePlayerSetting(key, value) {
    try {
      const data = await apiFetch("/admin/settings/player", {
        method: "PATCH",
        body: JSON.stringify({ [key]: value })
      });
      setSettings((current) => ({ ...current, ...data.settings }));
    } catch (error) {
      setStatus(error.message);
    }
  }

  const visibleMediaItems = mediaItems.filter((item) => {
    const query = mediaQuery.trim().toLowerCase();
    if (!query) return true;
    return [
      item.title,
      item.original_title,
      item.type === "tv" ? "tv show" : "movie",
      item.year ? String(item.year) : "",
      item.file_name
    ].some((value) => value?.toLowerCase().includes(query));
  });
  const canDisconnectTmdb = Boolean(
    settings?.canDisconnectTmdb
    || settings?.tmdbConfigured
    || (settings?.tmdbApiKeySource && settings.tmdbApiKeySource !== "none")
  );

  function confirmDeleteLibrary(library) {
    askForConfirmation({
      title: "Remove Library",
      message: `Remove "${library.name}" and its scanned media from NicFlix? Files on disk are not deleted.`,
      confirmLabel: "Remove Library",
      onConfirm: () => deleteLibrary(library)
    });
  }

  function confirmDeleteMediaItem(item) {
    const label = item.type === "tv" ? "TV show" : "movie";
    askForConfirmation({
      title: "Remove Media",
      message: `Remove "${item.title}" from NicFlix? The ${label} file${item.type === "tv" ? "s" : ""} on disk will not be deleted.`,
      confirmLabel: "Remove Media",
      onConfirm: () => deleteMediaItem(item)
    });
  }

  function confirmDisconnectTmdbSettings() {
    askForConfirmation({
      title: "Disconnect TMDB",
      message: "NicFlix will stop fetching posters, plots, ratings, and episode details until a key is connected again.",
      confirmLabel: "Disconnect",
      onConfirm: disconnectTmdbSettings
    });
  }

  async function handleConfirmDialog() {
    const action = confirmDialog?.onConfirm;
    setConfirmDialog(null);
    await action?.();
  }

  return (
    <section className="page-pad admin-page">
      <h1>Admin</h1>
      <p className="muted">Add local folder paths, scan them, and connect TMDB for posters, plots, ratings, and episode metadata.</p>
      <div className="panel tmdb-panel">
        <div className="panel-header">
          <div>
            <h2>TMDB Metadata API</h2>
            <p className="muted">
              {settings?.tmdbDisconnected
                ? "Disconnected. NicFlix will not use TMDB until you connect a key again."
                : settings?.tmdbConfigured
                ? `Connected from ${settings.tmdbApiKeySource === "env" ? "server environment" : "app settings"} (${settings.tmdbApiKeyMasked}).`
                : "Not connected yet. Matching still works best after adding your free TMDB developer API key."}
            </p>
            <p className="muted">Saved app keys are encrypted at rest and are never sent back to the browser.</p>
          </div>
          <div className="tmdb-header-actions">
            <span className={settings?.tmdbConfigured ? "settings-pill connected" : "settings-pill"}>
              {settings?.tmdbConfigured ? <CheckCircle2 size={16} /> : <KeyRound size={16} />}
              {settings?.tmdbConfigured ? "Connected" : "Setup Needed"}
            </span>
            {canDisconnectTmdb ? (
              <button className="ghost-button compact danger-button" type="button" onClick={confirmDisconnectTmdbSettings}>
                <Trash2 size={15} /> Disconnect
              </button>
            ) : null}
          </div>
        </div>
        <form className="tmdb-settings-form" onSubmit={saveTmdbSettings}>
          <label>
            TMDB API Key
            <div className="secret-input">
              <input
                type={showTmdbKey ? "text" : "password"}
                value={tmdbApiKey}
                onChange={(event) => setTmdbApiKey(event.target.value)}
                placeholder={settings?.tmdbConfigured ? "Paste a new key to replace the saved one" : "Paste your v3 API Key here"}
                autoComplete="off"
              />
              <button
                className="icon-button"
                type="button"
                onClick={() => setShowTmdbKey((current) => !current)}
                aria-label={showTmdbKey ? "Hide API key" : "Show API key"}
              >
                {showTmdbKey ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </label>
          <div className="tmdb-button-row">
            <button className="ghost-button" type="button" onClick={testTmdbSettings} disabled={!tmdbApiKey.trim()}>
              <RefreshCw size={17} /> Test
            </button>
            <button className="primary-button" type="submit" disabled={!tmdbApiKey.trim()}>
              <Save size={17} /> Save API Key
            </button>
          </div>
        </form>
        <details className="setup-guide" open={!settings?.tmdbConfigured}>
          <summary>First time? Get a free TMDB key without being a developer</summary>
          <ol>
            <li>Create or sign in to a free TMDB account, then use a desktop browser for the API page.</li>
            <li>Open your account settings and choose API. Accept the terms when asked.</li>
            <li>When it asks about your use, choose Developer. For app details, use NicFlix as the app name and personal home media metadata as the purpose.</li>
            <li>Copy the v3 API Key, not the long API Read Access Token, then paste it above and press Test.</li>
          </ol>
          <a className="guide-link" href="https://www.themoviedb.org/settings/api" target="_blank" rel="noreferrer">
            Open TMDB API settings <ExternalLink size={15} />
          </a>
        </details>
        {tmdbStatus ? <p className={tmdbStatus.toLowerCase().includes("success") || tmdbStatus.toLowerCase().includes("connected") ? "status" : "settings-error"}>{tmdbStatus}</p> : null}
      </div>
      <div className="panel player-settings-panel">
        <h2>Player Features</h2>
        <p className="muted">Global defaults for the video player. Users can still adjust these during playback.</p>
        <div className="settings-toggles">
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={settings?.autoSkipEnabled ?? true}
              onChange={(e) => togglePlayerSetting("autoSkipEnabled", e.target.checked)}
            />
            <div>
              <strong>Enable "Skip Intro / Outro" (Experimental)</strong>
              <p className="muted">Fetches segment timing from IntroDB and shows a skip button during playback.</p>
            </div>
          </label>
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={settings?.autoPlayNextEnabled ?? true}
              onChange={(e) => togglePlayerSetting("autoPlayNextEnabled", e.target.checked)}
            />
            <div>
              <strong>Default Auto-play Next Episode</strong>
              <p className="muted">Automatically counts down to the next episode when the current one ends.</p>
            </div>
          </label>
        </div>
      </div>
      <div className="admin-grid">
        <div className="panel">
          <h2>Libraries</h2>
          <form className="library-form" onSubmit={saveLibrary}>
            <label>
              Name
              <input
                value={libraryForm.name}
                onChange={(event) => setLibraryForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="Movies"
                required
              />
            </label>
            <label>
              Type
              <select
                value={libraryForm.type}
                onChange={(event) => setLibraryForm((current) => ({ ...current, type: event.target.value }))}
              >
                <option value="movies">Movies</option>
                <option value="tv">TV Shows</option>
              </select>
            </label>
            <label className="wide-field">
              Folder Path
              <div className="path-picker">
                <input
                  value={libraryForm.path}
                  onChange={(event) => setLibraryForm((current) => ({ ...current, path: event.target.value }))}
                  placeholder="C:/Media/Movies"
                  required
                />
                <button className="ghost-button" type="button" onClick={() => openBrowser()}>
                  <Folder size={17} /> Browse
                </button>
              </div>
            </label>
            <div className="library-form-actions">
              <button className="primary-button" type="submit">
                {libraryForm.id ? <Save size={17} /> : <FolderPlus size={17} />}
                {libraryForm.id ? "Save" : "Add"}
              </button>
              {libraryForm.id ? (
                <button className="ghost-button" type="button" onClick={() => setLibraryForm(emptyLibraryForm)}>Cancel</button>
              ) : null}
            </div>
          </form>
          {libraries.map((library) => (
            <div className="library-line" key={library.id}>
              <div>
                <strong>{library.name} <small>{library.type === "tv" ? "TV" : "Movies"}</small></strong>
                <span title={library.path}>{library.path}</span>
              </div>
              <div className="row-actions">
                <button
                  className="icon-button"
                  onClick={() => scan(library)}
                  disabled={scanTask.running}
                  aria-label={`Scan ${library.name}`}
                >
                  <RefreshCw size={18} />
                </button>
                <button className="icon-button" onClick={() => setLibraryForm(library)} aria-label={`Edit ${library.name}`}>
                  <Pencil size={17} />
                </button>
                <button className="icon-button danger" onClick={() => confirmDeleteLibrary(library)} aria-label={`Remove ${library.name}`}>
                  <Trash2 size={17} />
                </button>
              </div>
            </div>
          ))}
          {!libraries.length ? <p className="muted">No libraries yet. Add your first media folder above.</p> : null}
          {status ? <p className="status">{status}</p> : null}
        </div>
        <div className="panel">
          <div className="panel-header">
            <h2>Needs Review</h2>
            <button
              className="primary-button compact"
              type="button"
              onClick={fixAllMatches}
              disabled={!unmatched.length || bulkTmdb.running}
            >
              <Search size={15} /> {bulkTmdb.running ? "TMDB Running" : "TMDB All"}
            </button>
          </div>
          <div className="admin-list">
            {unmatched.map((item) => (
              <article className="review-item" key={item.id}>
                <div>
                  <strong>{item.title}</strong>
                  <span>{item.file_name || item.type}</span>
                </div>
                <button className="ghost-button compact" onClick={() => fixMatch(item)}><Search size={15} /> TMDB</button>
                <button className="ghost-button compact" onClick={() => setEditing(item)}>Edit</button>
              </article>
            ))}
            {!unmatched.length ? <p className="muted">Everything has at least basic metadata.</p> : null}
          </div>
        </div>
      </div>
      <div className="panel admin-wide-panel">
        <div className="panel-header admin-tools">
          <div>
            <h2>All Media</h2>
            <p className="muted">{mediaItems.length} scanned item{mediaItems.length === 1 ? "" : "s"} available for metadata edits.</p>
          </div>
          <label className="metadata-search">
            <Search size={16} />
            <input
              value={mediaQuery}
              onChange={(event) => setMediaQuery(event.target.value)}
              placeholder="Search movies and TV shows"
            />
          </label>
        </div>
        <div className="admin-list movie-admin-list">
          {visibleMediaItems.map((item) => (
            <article className="review-item" key={item.id}>
              <div>
                <strong>{item.title}</strong>
                <span>{[item.type === "tv" ? "TV Show" : "Movie", item.year, item.file_name].filter(Boolean).join(" - ")}</span>
              </div>
              <button className="ghost-button compact" onClick={() => fixMatch(item)}><Search size={15} /> TMDB</button>
              <button className="ghost-button compact" onClick={() => setEditing(item)}>Edit</button>
              <button className="icon-button danger" onClick={() => confirmDeleteMediaItem(item)} aria-label={`Remove ${item.title}`}>
                <Trash2 size={16} />
              </button>
            </article>
          ))}
          {!visibleMediaItems.length ? <p className="muted">No media items match that search.</p> : null}
        </div>
      </div>
      {editing ? (
        <div className="modal-backdrop" onClick={() => setEditing(null)}>
          <form className="modal" onSubmit={saveEdit} onClick={(event) => event.stopPropagation()}>
            <h2>Edit Metadata</h2>
            <label>Title<input name="title" defaultValue={editing.title} /></label>
            <label>Year<input name="year" type="number" defaultValue={editing.year || ""} /></label>
            <label>Overview<textarea name="overview" defaultValue={editing.overview || ""} /></label>
            <div className="modal-actions">
              <button className="ghost-button" type="button" onClick={() => setEditing(null)}>Cancel</button>
              <button className="primary-button" type="submit"><Save size={17} /> Save</button>
            </div>
          </form>
        </div>
      ) : null}
      {confirmDialog ? (
        <div className="modal-backdrop" onClick={() => setConfirmDialog(null)}>
          <div
            className="modal confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="confirm-modal-title">{confirmDialog.title}</h2>
            <p className="muted">{confirmDialog.message}</p>
            <div className="modal-actions">
              <button className="ghost-button" type="button" onClick={() => setConfirmDialog(null)}>Cancel</button>
              <button className="ghost-button danger-button" type="button" onClick={handleConfirmDialog}>
                <Trash2 size={17} /> {confirmDialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {browser ? (
        <div className="modal-backdrop" onClick={() => setBrowser(null)}>
          <div className="modal folder-modal" onClick={(event) => event.stopPropagation()}>
            <h2>Choose Folder</h2>
            <div className="current-folder">
              <span>{browser.currentPath || "Computer"}</span>
            </div>
            <div className="folder-toolbar">
              {browser.parentPath ? (
                <button className="ghost-button compact" type="button" onClick={() => browseTo(browser.parentPath)}>
                  <ChevronLeft size={16} /> Back
                </button>
              ) : null}
              <button className="ghost-button compact" type="button" onClick={() => browseTo("")}>
                <HardDrive size={16} /> Drives
              </button>
            </div>
            <div className="folder-list">
              {browser.directories.map((directory) => (
                <button className="folder-row" type="button" key={directory.path} onClick={() => browseTo(directory.path)}>
                  <Folder size={17} />
                  <span>{directory.name}</span>
                </button>
              ))}
              {!browser.directories.length ? <p className="muted">No folders inside this location.</p> : null}
            </div>
            <div className="modal-actions">
              <button className="ghost-button" type="button" onClick={() => setBrowser(null)}>Cancel</button>
              {browser.currentPath ? (
                <button className="primary-button" type="button" onClick={chooseBrowsedFolder}>
                  <Save size={17} /> Select This Folder
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
