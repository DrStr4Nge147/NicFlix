import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Play } from "lucide-react";
import { apiFetch, backdropUrl, posterUrl } from "../lib/api.js";
import ProgressBar from "../components/ProgressBar.jsx";
import MediaRow from "../components/MediaRow.jsx";
import RowCarousel from "../components/RowCarousel.jsx";

function episodeStillUrl(episode, show) {
  if (episode?.still_path?.startsWith?.("http")) return episode.still_path;
  if (episode?.still_path?.startsWith?.("/assets/")) return episode.still_path;
  if (episode?.still_path?.startsWith?.("/")) return `https://image.tmdb.org/t/p/w500${episode.still_path}`;
  return backdropUrl(show) || posterUrl(show);
}

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
  const resumeEpisode = useMemo(() => {
    return (payload?.episodes || [])
      .filter((episode) => episode.file_id && episode.position > 30 && !episode.watched)
      .sort((a, b) => String(b.progress_updated_at || "").localeCompare(String(a.progress_updated_at || "")))[0];
  }, [payload]);

  if (!payload) return <div className="empty-state">Loading show...</div>;
  const { show, seasons } = payload;
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
        <RowCarousel
          ariaLabel={`Season ${season} episodes`}
          className="episode-row-carousel"
          scrollerClassName="episode-carousel"
          scrollKey={season}
        >
          {episodes.map((episode) => (
            <Link
              className={`episode-card ${!episode.file_id ? "disabled" : ""}`}
              key={episode.id}
              to={episode.file_id ? `/watch/${episode.file_id}` : "#"}
              aria-disabled={!episode.file_id}
              onClick={(event) => {
                if (!episode.file_id) event.preventDefault();
              }}
            >
              <div className="episode-thumb">
                {episodeStillUrl(episode, show) ? <img src={episodeStillUrl(episode, show)} alt="" loading="lazy" /> : null}
                <span className="episode-index">E{episode.episode_number}</span>
                {episode.file_id ? (
                  <span className="episode-play" aria-label="Play episode">
                    <Play size={18} fill="currentColor" />
                  </span>
                ) : null}
              </div>
              <div className="episode-card-meta">
                <h3>{episode.title || `Episode ${episode.episode_number}`}</h3>
                <p>{episode.overview || "Episode metadata can be filled in after a TMDB match."}</p>
                <ProgressBar position={episode.position} duration={episode.file_duration} />
              </div>
            </Link>
          ))}
        </RowCarousel>
      </div>
      <MediaRow title="Suggested TV Shows" items={payload.relatedShows} />
    </section>
  );
}
