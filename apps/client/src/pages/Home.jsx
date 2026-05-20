import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Play, RefreshCw } from "lucide-react";
import { apiFetch, backdropUrl } from "../lib/api.js";
import MediaRow from "../components/MediaRow.jsx";

export default function Home() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const hero = rows.flatMap((row) => row.items)[0];
  const heroDetailsTo = hero?.type === "tv" ? `/shows/${hero.id}` : `/movies/${hero?.id}`;
  const heroPlayLabel = hero?.resume ? "Resume" : "Play";
  const heroEyebrow = hero?.resume
    ? hero.episode_number ? `Continue S${hero.season_number}:E${hero.episode_number}` : "Continue watching"
    : "Recently ready";

  useEffect(() => {
    apiFetch("/home").then((data) => setRows(data.rows)).finally(() => setLoading(false));
  }, []);

  const removeContinueItem = async (item) => {
    if (!item.file_id) return;
    await apiFetch(`/progress/${item.file_id}`, {
      method: "POST",
      body: JSON.stringify({ position: 0, duration: item.file_duration || item.duration || 0, watched: false })
    });
    setRows((currentRows) => currentRows
      .map((row) => row.title === "Continue Watching"
        ? { ...row, items: row.items.filter((rowItem) => rowItem.file_id !== item.file_id) }
        : row)
      .filter((row) => row.items.length));
  };

  if (loading) return <div className="empty-state">Loading your library...</div>;

  return (
    <>
      {hero ? (
        <section className="hero" style={{ backgroundImage: `linear-gradient(90deg, #08090d 0%, rgba(8,9,13,.78) 42%, rgba(8,9,13,.2) 100%), url(${backdropUrl(hero)})` }}>
          <div className="hero-content">
            <span className="eyebrow">{heroEyebrow}</span>
            <h1>{hero.title}</h1>
            {hero.resume && hero.episode_title ? <h2>{hero.episode_title}</h2> : null}
            <p>{hero.overview || "Your local library is scanned and ready to play on this network."}</p>
            <div className="hero-actions">
              {hero.file_id ? <Link className="primary-button" to={`/watch/${hero.file_id}`}><Play size={18} fill="currentColor" /> {heroPlayLabel}</Link> : null}
              <Link className="ghost-button" to={heroDetailsTo}>Details</Link>
            </div>
          </div>
        </section>
      ) : (
        <div className="empty-state">
          <RefreshCw size={32} />
          <h1>No media yet</h1>
          <p>Edit `config.json`, then use Admin to scan your folders.</p>
          <Link className="primary-button" to="/admin">Open Admin</Link>
        </div>
      )}
      <div className="content-stack">
        {rows.map((row) => (
          <MediaRow
            key={row.title}
            title={row.title}
            items={row.items}
            onRemoveItem={row.title === "Continue Watching" ? removeContinueItem : undefined}
          />
        ))}
      </div>
    </>
  );
}
