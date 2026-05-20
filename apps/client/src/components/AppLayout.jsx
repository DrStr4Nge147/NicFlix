import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { Film, Search, Settings } from "lucide-react";
import { useState } from "react";

export default function AppLayout() {
  const [query, setQuery] = useState("");
  const navigate = useNavigate();

  function submit(event) {
    event.preventDefault();
    if (query.trim()) navigate(`/search?q=${encodeURIComponent(query.trim())}`);
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
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search library" />
        </form>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
