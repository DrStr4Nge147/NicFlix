import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { AlertTriangle, Film, House, Search, Settings } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../lib/api.js";

const PAGE_EXIT_MS = 160;

export default function AppLayout() {
  const [params] = useSearchParams();
  const location = useLocation();
  const urlQuery = params.get("q") || "";
  const [query, setQuery] = useState(urlQuery);
  const [isPageLeaving, setIsPageLeaving] = useState(false);
  const [settings, setSettings] = useState(null);
  const exitTimeoutRef = useRef(null);
  const navigate = useNavigate();
  const showTmdbWarning = settings?.tmdbConfigured === false;

  useEffect(() => {
    setQuery(urlQuery);
  }, [urlQuery]);

  useEffect(() => {
    setIsPageLeaving(false);
    window.clearTimeout(exitTimeoutRef.current);
  }, [location.pathname, location.search, location.hash]);

  useEffect(() => () => window.clearTimeout(exitTimeoutRef.current), []);

  useEffect(() => {
    let cancelled = false;

    async function loadSettings() {
      try {
        const data = await apiFetch("/settings");
        if (!cancelled) setSettings(data.settings);
      } catch (error) {
        if (!cancelled) setSettings(null);
      }
    }

    function handleSettingsUpdated(event) {
      if (event.detail) {
        setSettings((current) => ({ ...current, ...event.detail }));
      } else {
        loadSettings();
      }
    }

    loadSettings();
    window.addEventListener("nicflix:settings-updated", handleSettingsUpdated);

    return () => {
      cancelled = true;
      window.removeEventListener("nicflix:settings-updated", handleSettingsUpdated);
    };
  }, []);

  function navigateWithTransition(to) {
    window.clearTimeout(exitTimeoutRef.current);

    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      navigate(to);
      return;
    }

    setIsPageLeaving(true);
    exitTimeoutRef.current = window.setTimeout(() => navigate(to), PAGE_EXIT_MS);
  }

  function handleAppClick(event) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) {
      return;
    }

    if (!(event.target instanceof Element)) return;

    const link = event.target.closest("a[href]");
    if (!link || link.target || link.hasAttribute("download")) return;

    const nextUrl = new URL(link.href, window.location.href);
    if (nextUrl.origin !== window.location.origin) return;

    const currentPath = `${location.pathname}${location.search}${location.hash}`;
    const nextPath = `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
    if (nextPath === currentPath) return;

    event.preventDefault();
    navigateWithTransition(nextPath);
  }

  function goToSearch(value, options = {}) {
    const trimmed = value.trim();
    navigate(trimmed ? `/search?q=${encodeURIComponent(trimmed)}` : "/search", options);
  }

  function updateQuery(event) {
    const nextQuery = event.target.value;
    setQuery(nextQuery);
    goToSearch(nextQuery, { replace: true });
  }

  function submit(event) {
    event.preventDefault();
    goToSearch(query);
  }

  return (
    <div className={`app-shell ${showTmdbWarning ? "app-shell-has-alert" : ""}`} onClickCapture={handleAppClick}>
      <div className="app-chrome">
        {showTmdbWarning ? (
          <div className="tmdb-warning-banner" role="status">
            <AlertTriangle size={16} />
            <span>TMDB API key is missing. Add one in Admin for full metadata matching, posters, ratings, and episode details.</span>
            <Link to="/admin">Open Admin</Link>
          </div>
        ) : null}
        <header className="topbar">
          <Link className="brand" to="/"><Film size={24} /> NicFlix</Link>
          <nav className="navlinks">
            <NavLink to="/" end><House size={17} /> Home</NavLink>
            <NavLink to="/movies">Movies</NavLink>
            <NavLink to="/shows">TV Shows</NavLink>
          </nav>
          <div className="topbar-actions">
            <form className="search-form" onSubmit={submit}>
              <Search size={17} />
              <input value={query} onChange={updateQuery} placeholder="Search library" />
            </form>
            <NavLink className="icon-button admin-button" to="/admin" title="Admin">
              <Settings size={20} />
            </NavLink>
          </div>
        </header>
      </div>
      <main className={`page-transition-stage ${isPageLeaving ? "page-transition-leaving" : ""}`}>
        <div className="page-transition-content" key={location.pathname}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}
