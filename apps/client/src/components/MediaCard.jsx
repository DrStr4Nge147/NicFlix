import { Link } from "react-router-dom";
import { Play } from "lucide-react";
import ProgressBar from "./ProgressBar.jsx";
import { posterUrl } from "../lib/api.js";

export default function MediaCard({ item }) {
  const to = item.resume && item.file_id
    ? `/watch/${item.file_id}`
    : item.type === "tv" ? `/shows/${item.id}` : `/movies/${item.id}`;
  const sublabel = item.resume && item.episode_number
    ? `S${item.season_number}:E${item.episode_number}${item.episode_title ? ` - ${item.episode_title}` : ""}`
    : item.year || item.type;

  return (
    <Link className="media-card" to={to}>
      <div className="poster">
        {posterUrl(item) ? <img src={posterUrl(item)} alt="" loading="lazy" /> : <div className="poster-fallback">{item.title}</div>}
        {item.file_id ? (
          <span className="play-badge" aria-label="Playable">
            <Play size={15} fill="currentColor" />
          </span>
        ) : null}
      </div>
      <div className="card-meta">
        <strong>{item.title}</strong>
        <span>{sublabel}</span>
      </div>
      <ProgressBar position={item.position} duration={item.file_duration || item.duration} />
    </Link>
  );
}
