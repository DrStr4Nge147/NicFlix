import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Play, RefreshCw } from "lucide-react";
import { apiFetch, backdropUrl } from "../lib/api.js";
import MediaRow from "../components/MediaRow.jsx";
import ConfirmationModal from "../components/ConfirmationModal.jsx";

export default function Home() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [itemToReset, setItemToReset] = useState(null);

  const hero = rows.flatMap((row) => row.items)[0];
  const heroDetailsTo = hero?.type === "tv" ? `/shows/${hero.id}` : `/movies/${hero?.id}`;
  const heroPlayLabel = hero?.resume ? "Resume" : "Play";
  const heroEyebrow = hero?.resume
    ? hero.episode_number ? `Continue S${hero.season_number}:E${hero.episode_number}` : "Continue watching"
    : "Recently ready";

  useEffect(() => {
    apiFetch("/home").then((data) => setRows(data.rows)).finally(() => setLoading(false));
  }, []);

  const handleConfirmReset = async () => {
    if (!itemToReset) return;
    
    // Reset all progress for this media item (movie or TV show)
    await apiFetch(`/progress/media/${itemToReset.id}`, {
      method: "DELETE"
    });

    setRows((currentRows) => currentRows
      .map((row) => row.title === "Continue Watching"
        ? { ...row, items: row.items.filter((rowItem) => rowItem.id !== itemToReset.id) }
        : row)
      .filter((row) => row.items.length));
    
    setItemToReset(null);
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
            onRemoveItem={row.title === "Continue Watching" ? (item) => setItemToReset(item) : undefined}
          />
        ))}
      </div>

      {itemToReset && (
        <ConfirmationModal
          title="Reset Progress?"
          message={`This will permanently clear your watch progress for "${itemToReset.title}". ${itemToReset.type === 'tv' ? 'All seasons and episodes will be reset.' : ''}`}
          confirmLabel="Reset Everything"
          onConfirm={handleConfirmReset}
          onCancel={() => setItemToReset(null)}
        />
      )}
    </>
  );
}
