import { Link, NavLink, Outlet, useNavigate, useSearchParams } from "react-router-dom";
import { Film, Search, Settings } from "lucide-react";
import { useEffect, useState } from "react";

export default function AppLayout() {
  const [params] = useSearchParams();
  const urlQuery = params.get("q") || "";
  const [query, setQuery] = useState(urlQuery);
  const navigate = useNavigate();

  useEffect(() => {
    setQuery(urlQuery);
  }, [urlQuery]);

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
    <div className="app-shell">
      <header className="topbar">
        <Link className="brand" to="/"><Film size={24} /> NicFlix</Link>
        <nav className="navlinks">
          <NavLink to="/movies">Movies</NavLink>
          <NavLink to="/shows">TV Shows</NavLink>
          <NavLink to="/admin"><Settings size={17} /> Admin</NavLink>
        </nav>
        <form className="search-form" onSubmit={submit}>
          <Search size={17} />
          <input value={query} onChange={updateQuery} placeholder="Search library" />
        </form>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
