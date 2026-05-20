import { useEffect, useRef, useState } from "react";
import { ChevronLeft, Folder, FolderPlus, HardDrive, Pencil, RefreshCw, Save, Search, Trash2 } from "lucide-react";
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
  const [movies, setMovies] = useState([]);
  const [movieQuery, setMovieQuery] = useState("");
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState(null);
  const [libraryForm, setLibraryForm] = useState(emptyLibraryForm);
  const [browser, setBrowser] = useState(null);
  const mounted = useRef(false);
  const { task: bulkTmdb, startBulkTmdb, scanTask, startScan } = useBulkTmdb();

  async function load() {
    const [libraryData, unmatchedData, movieData] = await Promise.all([
      apiFetch("/libraries"),
      apiFetch("/admin/unmatched"),
      apiFetch("/admin/media?type=movie")
    ]);
    setLibraries(libraryData.libraries);
    setUnmatched(unmatchedData.items);
    setMovies(movieData.items);
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
      await apiFetch(endpoint, { method, body: JSON.stringify(payload) });
      setStatus(libraryForm.id ? "Library updated." : "Library added.");
      setLibraryForm(emptyLibraryForm);
      await load();
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function deleteLibrary(library) {
    const confirmed = window.confirm(`Remove "${library.name}" and its scanned media from NicFlix? Files on disk are not deleted.`);
    if (!confirmed) return;
    try {
      await apiFetch(`/libraries/${library.id}`, { method: "DELETE" });
      setStatus("Library removed.");
      if (libraryForm.id === library.id) setLibraryForm(emptyLibraryForm);
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

  const visibleMovies = movies.filter((movie) => {
    const query = movieQuery.trim().toLowerCase();
    if (!query) return true;
    return [
      movie.title,
      movie.original_title,
      movie.year ? String(movie.year) : "",
      movie.file_name
    ].some((value) => value?.toLowerCase().includes(query));
  });

  return (
    <section className="page-pad admin-page">
      <h1>Admin</h1>
      <p className="muted">Add local folder paths here, then scan them. TMDB corrections need `TMDB_API_KEY` in `apps/server/.env`.</p>
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
                <button className="icon-button danger" onClick={() => deleteLibrary(library)} aria-label={`Remove ${library.name}`}>
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
            <h2>All Movies</h2>
            <p className="muted">{movies.length} scanned movie{movies.length === 1 ? "" : "s"} available for metadata edits.</p>
          </div>
          <label className="metadata-search">
            <Search size={16} />
            <input
              value={movieQuery}
              onChange={(event) => setMovieQuery(event.target.value)}
              placeholder="Search movies"
            />
          </label>
        </div>
        <div className="admin-list movie-admin-list">
          {visibleMovies.map((item) => (
            <article className="review-item" key={item.id}>
              <div>
                <strong>{item.title}</strong>
                <span>{[item.year, item.file_name].filter(Boolean).join(" - ") || "Movie"}</span>
              </div>
              <button className="ghost-button compact" onClick={() => fixMatch(item)}><Search size={15} /> TMDB</button>
              <button className="ghost-button compact" onClick={() => setEditing(item)}>Edit</button>
            </article>
          ))}
          {!visibleMovies.length ? <p className="muted">No movies match that search.</p> : null}
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
