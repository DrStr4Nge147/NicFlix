import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api.js";
import MediaCard from "../components/MediaCard.jsx";

export default function Library({ type }) {
  const [items, setItems] = useState([]);
  const title = type === "tv" ? "TV Shows" : "Movies";

  useEffect(() => {
    apiFetch(type === "tv" ? "/shows" : "/movies").then((data) => setItems(data.shows || data.movies || []));
  }, [type]);

  return (
    <section className="page-pad">
      <h1>{title}</h1>
      <div className="grid-list">
        {items.map((item) => <MediaCard key={item.id} item={item} />)}
      </div>
      {!items.length ? <p className="muted">Nothing scanned here yet.</p> : null}
    </section>
  );
}

