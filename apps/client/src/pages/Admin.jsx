import { useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ExternalLink,
  Eye,
  EyeOff,
  FileImage,
  Folder,
  FolderPlus,
  HardDrive,
  Info,
  KeyRound,
  LayoutGrid,
  Library,
  Pencil,
  RefreshCw,
  Save,
  Search,
  Settings,
  Trash2,
  X
} from "lucide-react";
import { apiFetch } from "../lib/api.js";
import { useBulkTmdb } from "../lib/bulkTmdb.jsx";

const emptyLibraryForm = {
  id: null,
  name: "",
  type: "movies",
  path: ""
};

function scanSummary(result) {
  const removed = Number(result?.removedFiles || 0);
  const cleanup = removed ? ` Removed ${removed} stale ${removed === 1 ? "record" : "records"}.` : "";
  return `scanned ${result.scanned} files. Added ${result.added}, updated ${result.updated}.${cleanup}`;
}

export default function Admin() {
  const [activeTab, setActiveTab] = useState("general");
  const [contentTab, setContentTab] = useState("all");
  const [adminSearchQuery, setAdminSearchQuery] = useState("");
  const [contentSearchQuery, setContentSearchQuery] = useState("");
  const [libraries, setLibraries] = useState([]);
  const [unmatched, setUnmatched] = useState([]);
  const [mediaItems, setMediaItems] = useState([]);
  const [adminToast, setAdminToast] = useState(null);
  const [activeTmdbItemId, setActiveTmdbItemId] = useState(null);
  const [settings, setSettings] = useState(null);
  const [tmdbApiKey, setTmdbApiKey] = useState("");
  const [showTmdbKey, setShowTmdbKey] = useState(false);
  const [editing, setEditing] = useState(null);
  const [libraryForm, setLibraryForm] = useState(emptyLibraryForm);
  const [librarySaveTask, setLibrarySaveTask] = useState(null);
  const [browser, setBrowser] = useState(null);
  const [imageBrowser, setImageBrowser] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const posterInputRef = useRef(null);
  const backdropInputRef = useRef(null);
  const mounted = useRef(false);
  const adminToastTimer = useRef(null);
  const backdropPointerStartedOutside = useRef(false);
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
      if (adminToastTimer.current) window.clearTimeout(adminToastTimer.current);
    };
  }, []);

  function showAdminToast(message, variant = "success") {
    if (adminToastTimer.current) window.clearTimeout(adminToastTimer.current);
    setAdminToast({ message, variant });
    adminToastTimer.current = window.setTimeout(() => {
      setAdminToast(null);
    }, variant === "error" ? 7000 : 5000);
  }

  async function scan(library) {
    try {
      const result = await startScan(library);
      if (!mounted.current || !result) return;
      await load();
    } catch (error) {
      if (!mounted.current) return;
    }
  }

  async function saveLibrary(event) {
    event.preventDefault();
    if (librarySaveTask?.running) return;

    const editingLibrary = Boolean(libraryForm.id);
    const payload = {
      name: libraryForm.name.trim(),
      type: libraryForm.type,
      path: libraryForm.path.trim()
    };
    const endpoint = libraryForm.id ? `/libraries/${libraryForm.id}` : "/libraries";
    const method = libraryForm.id ? "PATCH" : "POST";
    setLibrarySaveTask({
      running: true,
      message: `${editingLibrary ? "Saving" : "Adding"} ${payload.name || "library"} and scanning media...`
    });

    try {
      const data = await apiFetch(endpoint, { method, body: JSON.stringify(payload) });
      if (!mounted.current) return;
      showAdminToast(data.scan
        ? `${editingLibrary ? "Library updated" : "Library added"} and ${scanSummary(data.scan)}`
        : editingLibrary ? "Library updated." : "Library added.");
      setLibraryForm(emptyLibraryForm);
      await load();
    } catch (error) {
      if (!mounted.current) return;
      showAdminToast(error.message, "error");
    } finally {
      if (mounted.current) setLibrarySaveTask(null);
    }
  }

  function askForConfirmation(options) {
    setConfirmDialog(options);
  }

  function trackBackdropPointerDown(event) {
    backdropPointerStartedOutside.current = event.target === event.currentTarget;
  }

  function closeOnBackdropClick(event, close) {
    if (event.target === event.currentTarget && backdropPointerStartedOutside.current) {
      close();
    }
    backdropPointerStartedOutside.current = false;
  }

  async function deleteLibrary(library) {
    try {
      await apiFetch(`/libraries/${library.id}`, { method: "DELETE" });
      showAdminToast("Library removed.");
      if (libraryForm.id === library.id) setLibraryForm(emptyLibraryForm);
      await load();
    } catch (error) {
      showAdminToast(error.message, "error");
    }
  }

  async function deleteMediaItem(item) {
    try {
      await apiFetch(`/admin/media/${item.id}`, { method: "DELETE" });
      showAdminToast(`Removed "${item.title}".`);
      if (editing?.id === item.id) setEditing(null);
      await load();
    } catch (error) {
      showAdminToast(error.message, "error");
    }
  }

  async function openBrowser(startPath = libraryForm.path) {
    try {
      const pathQuery = startPath ? `?path=${encodeURIComponent(startPath)}` : "";
      const data = await apiFetch(`/fs/directories${pathQuery}`);
      setBrowser(data);
    } catch (error) {
      showAdminToast(error.message, "error");
    }
  }

  async function browseTo(folderPath) {
    await openBrowser(folderPath);
  }

  function chooseBrowsedFolder() {
    setLibraryForm((current) => ({ ...current, path: browser.currentPath }));
    setBrowser(null);
  }

  async function openImageBrowser(kind, fieldName, folderPath) {
    try {
      const params = new URLSearchParams({ kind });
      if (folderPath !== undefined) params.set("path", folderPath);
      const data = await apiFetch(`/fs/images?${params.toString()}`);
      setImageBrowser({ ...data, kind, fieldName });
    } catch (error) {
      showAdminToast(error.message, "error");
    }
  }

  async function browseImagesTo(folderPath) {
    if (!imageBrowser) return;
    await openImageBrowser(imageBrowser.kind, imageBrowser.fieldName, folderPath);
  }

  async function chooseBrowsedImage(filePath) {
    if (!imageBrowser) return;
    try {
      const data = await apiFetch("/admin/assets/local-image", {
        method: "POST",
        body: JSON.stringify({ kind: imageBrowser.kind, filePath })
      });
      const input = imageBrowser.fieldName === "backdrop_path" ? backdropInputRef.current : posterInputRef.current;
      if (input) input.value = data.storedPath;
      showAdminToast(`${imageBrowser.kind === "backdrop" ? "Backdrop" : "Poster"} image selected: ${data.storedPath}`);
      setImageBrowser(null);
    } catch (error) {
      showAdminToast(error.message, "error");
    }
  }

  async function saveEdit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const numberOrNull = (name) => {
      const value = String(form.get(name) || "").trim();
      return value ? Number(value) : null;
    };
    try {
      await apiFetch(`/admin/media/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: form.get("title"),
          original_title: form.get("original_title"),
          year: numberOrNull("year"),
          overview: form.get("overview"),
          poster_path: form.get("poster_path"),
          backdrop_path: form.get("backdrop_path"),
          genres: form.get("genres"),
          runtime: numberOrNull("runtime"),
          rating: numberOrNull("rating"),
          tmdb_id: numberOrNull("tmdb_id"),
          imdb_id: form.get("imdb_id")
        })
      });
      showAdminToast("Metadata saved.");
      setEditing(null);
      await load();
    } catch (error) {
      showAdminToast(error.message, "error");
    }
  }

  async function fixMatch(item) {
    try {
      setActiveTmdbItemId(item.id);
      showAdminToast(`Searching TMDB for ${item.title}...`, "info");
      const data = await apiFetch(`/admin/media/${item.id}/fix-match`, {
        method: "POST",
        body: JSON.stringify({ title: item.title, year: item.year })
      });
      showAdminToast(`TMDB metadata updated for "${data.media?.title || item.title}".`);
      await load();
    } catch (error) {
      showAdminToast(error.message, "error");
    } finally {
      setActiveTmdbItemId(null);
    }
  }

  async function fixAllMatches(items) {
    if (!items.length || bulkTmdb.running) return;

    await startBulkTmdb(items);
    await load();
  }

  async function saveTmdbSettings(event) {
    event.preventDefault();
    try {
      const data = await apiFetch("/admin/settings/tmdb", {
        method: "PATCH",
        body: JSON.stringify({ tmdbApiKey })
      });
      setSettings(data.settings);
      window.dispatchEvent(new CustomEvent("nicflix:settings-updated", { detail: data.settings }));
      setTmdbApiKey("");
      showAdminToast(data.test?.message || "TMDB settings saved.");
    } catch (error) {
      showAdminToast(error.message, "error");
    }
  }

  async function testTmdbSettings() {
    try {
      const data = await apiFetch("/admin/settings/tmdb", {
        method: "PATCH",
        body: JSON.stringify({ tmdbApiKey, testOnly: true })
      });
      showAdminToast(data.test?.message || "TMDB connected successfully.");
    } catch (error) {
      showAdminToast(error.message, "error");
    }
  }

  async function disconnectTmdbSettings() {
    try {
      const data = await apiFetch("/admin/settings/tmdb", { method: "DELETE" });
      setSettings(data.settings);
      window.dispatchEvent(new CustomEvent("nicflix:settings-updated", { detail: data.settings }));
      setTmdbApiKey("");
      showAdminToast(data.message || "TMDB API key disconnected.");
    } catch (error) {
      showAdminToast(error.message, "error");
    }
  }

  async function togglePlayerSetting(key, value) {
    try {
      const data = await apiFetch("/admin/settings/player", {
        method: "PATCH",
        body: JSON.stringify({ [key]: value })
      });
      setSettings((current) => ({ ...current, ...data.settings }));
      window.dispatchEvent(new CustomEvent("nicflix:settings-updated", { detail: data.settings }));
      showAdminToast("Player settings updated.");
    } catch (error) {
      showAdminToast(error.message, "error");
    }
  }

  const adminSearchItems = [
    {
      tab: "general",
      title: "General settings",
      description: "TMDB API, metadata connection, player features, skip intro, auto-play next",
      icon: Settings
    },
    {
      tab: "libraries",
      title: "Libraries",
      description: "Add folders, browse paths, scan movie and TV libraries",
      icon: Library
    },
    {
      tab: "content",
      title: "Content management",
      description: "Scanned media, unmatched items, TMDB matching, metadata edits",
      icon: LayoutGrid
    }
  ];

  const filteredAdminSearchItems = adminSearchItems.filter((item) => {
    const query = adminSearchQuery.trim().toLowerCase();
    if (!query) return false;
    return `${item.title} ${item.description}`.toLowerCase().includes(query);
  });

  function openAdminSearchItem(tab) {
    setActiveTab(tab);
    setAdminSearchQuery("");
  }

  const matchesContentSearch = (text) => {
    if (!contentSearchQuery) return true;
    return text?.toLowerCase().includes(contentSearchQuery.toLowerCase());
  };

  const filteredMedia = mediaItems.filter(item =>
    matchesContentSearch(item.title) ||
    matchesContentSearch(item.file_name) ||
    matchesContentSearch(item.year?.toString())
  );

  const filteredUnmatched = unmatched.filter(item =>
    matchesContentSearch(item.title) ||
    matchesContentSearch(item.file_name)
  );

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

  function renderGeneralSettings() {
    return (
      <div className="admin-content">
        <div className="admin-section-title">
          <Settings size={28} />
          <h2>General Settings</h2>
        </div>

        <div className="panel tmdb-panel">
          <div className="panel-header">
            <div>
              <h3>TMDB Metadata API</h3>
              <p className="muted">
                {settings?.tmdbDisconnected
                  ? "Disconnected. NicFlix will not use TMDB until you connect a key again."
                  : settings?.tmdbConfigured
                  ? `Connected from ${settings.tmdbApiKeySource === "env" ? "server environment" : "app settings"} (${settings.tmdbApiKeyMasked}).`
                  : "Not connected yet. Add the short TMDB API Key from your TMDB account settings to enable metadata matching."}
              </p>
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
              TMDB v3 API Key
              <div className="secret-input">
                <input
                  type={showTmdbKey ? "text" : "password"}
                  value={tmdbApiKey}
                  onChange={(event) => setTmdbApiKey(event.target.value)}
                  placeholder={settings?.tmdbConfigured ? "Paste a new v3 API Key to replace the saved one" : "Paste the short API Key from TMDB settings"}
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
              <span className="field-help">
                Use the shorter field named "API Key" on TMDB. Do not paste the long "API Read Access Token".
              </span>
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
            <summary>First time? Get the right TMDB key</summary>
            <ol>
              <li>Create or sign in to a free TMDB account.</li>
              <li>Open the TMDB API settings page. The correct page is www.themoviedb.org/settings/api.</li>
              <li>If TMDB asks what type of access you need, choose Developer. You do not need to be a software developer; this is just TMDB's name for a personal API key.</li>
              <li>For the app details, use NicFlix as the app name and personal home media metadata as the purpose.</li>
              <li>On the API page, copy the shorter value under "API Key". Do not copy the long "API Read Access Token" above it.</li>
              <li>Paste the API Key above, press Test, then Save API Key.</li>
            </ol>
            <a className="guide-link" href="https://www.themoviedb.org/settings/api" target="_blank" rel="noreferrer">
              Open the correct TMDB API settings page <ExternalLink size={15} />
            </a>
          </details>
        </div>

        <div className="panel player-settings-panel">
          <h3>Player Features</h3>
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
      </div>
    );
  }

  function renderLibrarySettings() {
    const librarySaveRunning = Boolean(librarySaveTask?.running);

    return (
      <div className="admin-content">
        <div className="admin-section-title">
          <Library size={28} />
          <h2>Manage Libraries</h2>
        </div>

        <div className="panel">
          <h3>Libraries</h3>
          <form className="library-form" onSubmit={saveLibrary}>
            <label>
              Name
              <input
                value={libraryForm.name}
                onChange={(event) => setLibraryForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="Movies"
                disabled={librarySaveRunning}
                required
              />
            </label>
            <label>
              Type
              <select
                value={libraryForm.type}
                onChange={(event) => setLibraryForm((current) => ({ ...current, type: event.target.value }))}
                disabled={librarySaveRunning}
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
                  disabled={librarySaveRunning}
                  required
                />
                <button className="ghost-button" type="button" onClick={() => openBrowser()} disabled={librarySaveRunning}>
                  <Folder size={17} /> Browse
                </button>
              </div>
            </label>
            <div className="library-form-actions">
              <button className="primary-button" type="submit" disabled={librarySaveRunning}>
                {librarySaveRunning
                  ? <RefreshCw className="spin-icon" size={17} />
                  : libraryForm.id ? <Save size={17} /> : <FolderPlus size={17} />}
                {librarySaveRunning ? (libraryForm.id ? "Saving" : "Adding") : libraryForm.id ? "Save" : "Add"}
              </button>
              {libraryForm.id ? (
                <button className="ghost-button" type="button" onClick={() => setLibraryForm(emptyLibraryForm)} disabled={librarySaveRunning}>Cancel</button>
              ) : null}
            </div>
            {librarySaveRunning ? (
              <div className="library-save-progress" role="status" aria-live="polite">
                <span>{librarySaveTask.message}</span>
                <div className="task-progress task-progress-active" aria-label="Library scan in progress">
                  <div />
                </div>
              </div>
            ) : null}
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
        </div>
      </div>
    );
  }

  function renderContentSettings() {
    const activeItems = contentTab === "all" ? filteredMedia : filteredUnmatched;
    const bulkTmdbItems = contentTab === "all" ? mediaItems : unmatched;
    const searchPlaceholder = contentTab === "all" ? "Search scanned media..." : "Search pending metadata...";

    return (
      <div className="admin-content">
        <div className="admin-section-title">
          <LayoutGrid size={28} />
          <h2>Content Management</h2>
        </div>

        <div className="content-tabs">
          <button 
            className={`content-tab ${contentTab === "all" ? "active" : ""}`}
            onClick={() => setContentTab("all")}
          >
            All Media ({mediaItems.length})
          </button>
          <button 
            className={`content-tab ${contentTab === "needs-review" ? "active" : ""}`}
            onClick={() => setContentTab("needs-review")}
          >
            Needs Review ({unmatched.length})
          </button>
        </div>

        <div className="panel admin-wide-panel">
          <div className="panel-header">
            <div>
              <h3>{contentTab === "all" ? "Scanned Media" : "Pending Metadata"}</h3>
              <p className="muted">
                {activeItems.length} {contentTab === "all" ? "items in your library" : "items need matching"}
              </p>
            </div>
            <div className="content-panel-tools">
              <label className="metadata-search" aria-label={searchPlaceholder}>
                <Search size={16} />
                <input
                  value={contentSearchQuery}
                  onChange={(event) => setContentSearchQuery(event.target.value)}
                  placeholder={searchPlaceholder}
                />
              </label>
              <button
                className="primary-button compact"
                type="button"
                onClick={() => fixAllMatches(bulkTmdbItems)}
                disabled={!bulkTmdbItems.length || bulkTmdb.running}
              >
                <Search size={15} /> {bulkTmdb.running ? "TMDB Running" : "TMDB Detect All"}
              </button>
            </div>
          </div>

          <div className="admin-list movie-admin-list">
            {activeItems.map((item) => (
              <article className="review-item" key={item.id}>
                <div>
                  <strong>{item.title}</strong>
                  <span>{[item.type === "tv" ? "TV Show" : "Movie", item.year, item.file_name].filter(Boolean).join(" - ")}</span>
                </div>
                <div className="row-actions">
                  <button
                    className="ghost-button compact"
                    type="button"
                    onClick={() => fixMatch(item)}
                    disabled={activeTmdbItemId !== null}
                    title="Force TMDB Search"
                  >
                    <Search size={15} /> {activeTmdbItemId === item.id ? "Searching" : "TMDB"}
                  </button>
                  <button className="ghost-button compact" onClick={() => setEditing(item)}>
                    Edit
                  </button>
                  <button 
                    className="icon-button danger" 
                    onClick={() => confirmDeleteMediaItem(item)} 
                    aria-label={`Remove ${item.title}`}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </article>
            ))}
            {!activeItems.length && (
              <p className="muted">
                {contentSearchQuery ? "No results match your media search." : contentTab === "all" ? "Library is empty." : "All good! No items need manual review."}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  const activeTaskToastCount = [bulkTmdb, scanTask].filter((task) => task.running || task.message).length;

  return (
    <section className="page-pad admin-page">
      <aside className="admin-nav">
        <div className="admin-nav-header">
          <h1>NicFlix Admin</h1>
        </div>
        <button 
          className={`admin-nav-item ${activeTab === "general" ? "active" : ""}`}
          onClick={() => setActiveTab("general")}
        >
          <Settings size={20} /> General
        </button>
        <button 
          className={`admin-nav-item ${activeTab === "libraries" ? "active" : ""}`}
          onClick={() => setActiveTab("libraries")}
        >
          <Library size={20} /> Libraries
        </button>
        <button 
          className={`admin-nav-item ${activeTab === "content" ? "active" : ""}`}
          onClick={() => setActiveTab("content")}
        >
          <LayoutGrid size={20} /> Content
        </button>
        <div className="admin-server-status">
          <div className="settings-pill connected">
            <Activity size={14} /> Server Online
          </div>
          <div className="admin-version">
            Build {settings?.buildVersion || settings?.appVersion || "0.0.0"}
          </div>
        </div>
      </aside>

      <main className="admin-main">
        <header className="admin-header">
          <div>
            <p className="muted">Control your media server, metadata, and libraries.</p>
          </div>
          <div className="admin-search-wrapper">
            <Search size={18} />
            <input 
              className="admin-search-input"
              value={adminSearchQuery}
              onChange={(e) => setAdminSearchQuery(e.target.value)}
              placeholder="Search admin settings..."
            />
            {adminSearchQuery.trim() ? (
              <div className="admin-search-results" role="listbox" aria-label="Admin search results">
                {filteredAdminSearchItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.tab}
                      type="button"
                      role="option"
                      className="admin-search-result"
                      onClick={() => openAdminSearchItem(item.tab)}
                    >
                      <Icon size={17} />
                      <span>
                        <strong>{item.title}</strong>
                        <small>{item.description}</small>
                      </span>
                    </button>
                  );
                })}
                {!filteredAdminSearchItems.length ? <p className="admin-search-empty">No admin settings found.</p> : null}
              </div>
            ) : null}
          </div>
        </header>

        {activeTab === "general" && renderGeneralSettings()}
        {activeTab === "libraries" && renderLibrarySettings()}
        {activeTab === "content" && renderContentSettings()}
      </main>

      <AdminStatusToast
        toast={adminToast}
        activeTaskToastCount={activeTaskToastCount}
        onDismiss={() => setAdminToast(null)}
      />

      {editing ? (
        <div
          className="modal-backdrop"
          onPointerDown={trackBackdropPointerDown}
          onClick={(event) => closeOnBackdropClick(event, () => setEditing(null))}
        >
          <form className="modal metadata-modal" onSubmit={saveEdit} onClick={(event) => event.stopPropagation()}>
            <h2>Edit Metadata</h2>
            <div className="modal-field-grid">
              <label>Title<input name="title" defaultValue={editing.title} required /></label>
              <label>Original Title<input name="original_title" defaultValue={editing.original_title || ""} /></label>
              <label>Year<input name="year" type="number" defaultValue={editing.year || ""} /></label>
              <label>Runtime<input name="runtime" type="number" min="0" defaultValue={editing.runtime || ""} /></label>
              <label>Rating<input name="rating" type="number" min="0" max="10" step="0.1" defaultValue={editing.rating || ""} /></label>
              <label>Genres<input name="genres" defaultValue={editing.genres?.join(", ") || ""} placeholder="Action, Drama, Sci-Fi" /></label>
              <label>TMDB ID<input name="tmdb_id" type="number" min="0" defaultValue={editing.tmdb_id || ""} /></label>
              <label>IMDb ID<input name="imdb_id" defaultValue={editing.imdb_id || ""} placeholder="tt1234567" /></label>
            </div>
            <div className="asset-path-note">
              <strong>Asset folders</strong>
              <span>Posters: {settings?.assetPaths?.posters || "data/posters"}</span>
              <span>Backdrops: {settings?.assetPaths?.backdrops || "data/backdrops"}</span>
            </div>
            <label>
              Poster Image
              <div className="path-picker">
                <input
                  ref={posterInputRef}
                  name="poster_path"
                  defaultValue={editing.poster_path || ""}
                  placeholder="https://... or posters/file.jpg"
                />
                <button className="ghost-button" type="button" onClick={() => openImageBrowser("poster", "poster_path")}>
                  <FileImage size={17} /> Browse
                </button>
              </div>
            </label>
            <label>
              Backdrop Image
              <div className="path-picker">
                <input
                  ref={backdropInputRef}
                  name="backdrop_path"
                  defaultValue={editing.backdrop_path || ""}
                  placeholder="https://... or backdrops/file.jpg"
                />
                <button className="ghost-button" type="button" onClick={() => openImageBrowser("backdrop", "backdrop_path")}>
                  <FileImage size={17} /> Browse
                </button>
              </div>
            </label>
            <label>Synopsis<textarea name="overview" defaultValue={editing.overview || ""} /></label>
            <div className="modal-actions">
              <button className="ghost-button" type="button" onClick={() => setEditing(null)}>Cancel</button>
              <button className="primary-button" type="submit"><Save size={17} /> Save</button>
            </div>
          </form>
        </div>
      ) : null}

      {confirmDialog ? (
        <div
          className="modal-backdrop"
          onPointerDown={trackBackdropPointerDown}
          onClick={(event) => closeOnBackdropClick(event, () => setConfirmDialog(null))}
        >
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
        <div
          className="modal-backdrop"
          onPointerDown={trackBackdropPointerDown}
          onClick={(event) => closeOnBackdropClick(event, () => setBrowser(null))}
        >
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

      {imageBrowser ? (
        <div
          className="modal-backdrop"
          onPointerDown={trackBackdropPointerDown}
          onClick={(event) => closeOnBackdropClick(event, () => setImageBrowser(null))}
        >
          <div className="modal folder-modal" onClick={(event) => event.stopPropagation()}>
            <h2>Choose {imageBrowser.kind === "backdrop" ? "Backdrop" : "Poster"} Image</h2>
            <div className="current-folder">
              <span>{imageBrowser.currentPath || "Computer"}</span>
            </div>
            <div className="folder-toolbar">
              {imageBrowser.parentPath ? (
                <button className="ghost-button compact" type="button" onClick={() => browseImagesTo(imageBrowser.parentPath)}>
                  <ChevronLeft size={16} /> Back
                </button>
              ) : null}
              <button className="ghost-button compact" type="button" onClick={() => browseImagesTo(undefined)}>
                <Folder size={16} /> Asset Folder
              </button>
              <button className="ghost-button compact" type="button" onClick={() => browseImagesTo("")}>
                <HardDrive size={16} /> Drives
              </button>
            </div>
            <div className="folder-list">
              {imageBrowser.directories.map((directory) => (
                <button className="folder-row" type="button" key={directory.path} onClick={() => browseImagesTo(directory.path)}>
                  <Folder size={17} />
                  <span>{directory.name}</span>
                </button>
              ))}
              {imageBrowser.files.map((file) => (
                <button className="folder-row image-file-row" type="button" key={file.path} onClick={() => chooseBrowsedImage(file.path)}>
                  <FileImage size={17} />
                  <span>{file.name}</span>
                </button>
              ))}
              {!imageBrowser.directories.length && !imageBrowser.files.length ? <p className="muted">No folders or image files inside this location.</p> : null}
            </div>
            <div className="modal-actions">
              <button className="ghost-button" type="button" onClick={() => setImageBrowser(null)}>Cancel</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function AdminStatusToast({ toast, activeTaskToastCount, onDismiss }) {
  if (!toast) return null;

  const Icon = toast.variant === "error" ? AlertCircle : toast.variant === "info" ? Info : CheckCircle2;
  const title = toast.variant === "error" ? "Admin needs attention" : toast.variant === "info" ? "Admin update" : "Admin saved";
  const bottom = `${1 + activeTaskToastCount * 7.7}rem`;

  return (
    <aside
      className={`task-toast admin-toast admin-toast-${toast.variant}`}
      role="status"
      aria-live="polite"
      style={{ "--toast-bottom": bottom }}
    >
      <div className="task-toast-header">
        <Icon size={17} />
        <strong>{title}</strong>
        <button type="button" className="task-toast-close" onClick={onDismiss} aria-label="Dismiss admin notification">
          <X size={15} />
        </button>
      </div>
      <p>{toast.message}</p>
    </aside>
  );
}
