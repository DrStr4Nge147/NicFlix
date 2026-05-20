import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Play } from "lucide-react";
import { apiFetch, backdropUrl, posterUrl } from "../lib/api.js";
import ProgressBar from "../components/ProgressBar.jsx";

export default function ShowDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [payload, setPayload] = useState(null);
  const [season, setSeason] = useState(null);

  useEffect(() => {
    apiFetch(`/shows/${id}`).then((data) => {
      setPayload(data);
      setSeason(data.seasons?.[0]?.season_number || data.episodes?.[0]?.season_number || 1);
    });
  }, [id]);

  const episodes = useMemo(() => payload?.episodes?.filter((episode) => episode.season_number === season) || [], [payload, season]);
  if (!payload) return <div className="empty-state">Loading show...</div>;
  const { show, seasons } = payload;
  const resumeEpisode = payload.episodes?.find((episode) => episode.file_id && episode.position > 30 && !episode.watched);
  const firstPlayableEpisode = payload.episodes?.find((episode) => episode.file_id);
  const primaryEpisode = resumeEpisode || firstPlayableEpisode;

  return (
    <section className="show-page">
      <div className="show-hero" style={{ backgroundImage: `linear-gradient(90deg, #08090d 0%, rgba(8,9,13,.86) 50%, rgba(8,9,13,.28) 100%), url(${backdropUrl(show)})` }}>
        <button className="back-button" type="button" onClick={() => navigate(-1)} aria-label="Go back">
          <ArrowLeft size={18} /> Back
        </button>
        {posterUrl(show) ? <img className="detail-poster" src={posterUrl(show)} alt="" /> : null}
        <div>
          <span className="eyebrow">{show.year || "Series"}</span>
          <h1>{show.title}</h1>
          <p>{show.overview || "No overview stored yet."}</p>
          {primaryEpisode ? (
            <Link className="primary-button" to={`/watch/${primaryEpisode.file_id}`}>
              <Play size={18} fill="currentColor" />
              {resumeEpisode ? "Resume" : "Play"}
            </Link>
          ) : null}
        </div>
      </div>
      <div className="page-pad">
        <div className="tabs">
          {seasons.map((item) => (
            <button className={item.season_number === season ? "active" : ""} key={item.id} onClick={() => setSeason(item.season_number)}>
              Season {item.season_number}
            </button>
          ))}
        </div>
        <div className="episode-list">
          {episodes.map((episode) => (
            <article className="episode-item" key={episode.id}>
              <div className="episode-number">{episode.episode_number}</div>
              <div>
                <h3>{episode.title || `Episode ${episode.episode_number}`}</h3>
                <p>{episode.overview || "Episode metadata can be filled in after a TMDB match."}</p>
                <ProgressBar position={episode.position} duration={episode.file_duration} />
              </div>
              {episode.file_id ? <Link className="icon-button" to={`/watch/${episode.file_id}`} aria-label="Play episode"><Play size={18} fill="currentColor" /></Link> : null}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
