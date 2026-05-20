import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Play } from "lucide-react";
import { apiFetch, backdropUrl, posterUrl } from "../lib/api.js";

export default function MovieDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [movie, setMovie] = useState(null);

  useEffect(() => {
    apiFetch(`/movies/${id}`).then((data) => setMovie(data.movie));
  }, [id]);

  if (!movie) return <div className="empty-state">Loading movie...</div>;
  const playLabel = movie.position > 30 && !movie.watched ? "Resume" : "Play";

  return (
    <section className="detail-page" style={{ backgroundImage: `linear-gradient(90deg, #08090d 0%, rgba(8,9,13,.88) 48%, rgba(8,9,13,.25) 100%), url(${backdropUrl(movie)})` }}>
      <button className="back-button" type="button" onClick={() => navigate(-1)} aria-label="Go back">
        <ArrowLeft size={18} /> Back
      </button>
      <div className="detail-content">
        {posterUrl(movie) ? <img className="detail-poster" src={posterUrl(movie)} alt="" /> : null}
        <div>
          <span className="eyebrow">{movie.year || "Movie"}</span>
          <h1>{movie.title}</h1>
          <p>{movie.overview || "No overview stored yet."}</p>
          <div className="fact-row">
            {movie.runtime ? <span>{movie.runtime} min</span> : null}
            {movie.rating ? <span>{Number(movie.rating).toFixed(1)} TMDB</span> : null}
            {movie.video_codec ? <span>{movie.video_codec}</span> : null}
            {movie.width && movie.height ? <span>{movie.width}x{movie.height}</span> : null}
          </div>
          {movie.file_id ? <Link className="primary-button" to={`/watch/${movie.file_id}`}><Play size={18} fill="currentColor" /> {playLabel}</Link> : null}
        </div>
      </div>
    </section>
  );
}
