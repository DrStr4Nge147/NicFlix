import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { apiFetch } from "../lib/api.js";
import MediaCard from "../components/MediaCard.jsx";

export default function SearchResults() {
  const [params] = useSearchParams();
  const query = params.get("q") || "";
  const [results, setResults] = useState([]);
  const resultLabel = query
    ? `${results.length} result${results.length === 1 ? "" : "s"} for "${query}"`
    : `${results.length} title${results.length === 1 ? "" : "s"}`;

  useEffect(() => {
    apiFetch(`/search?q=${encodeURIComponent(query)}`).then((data) => setResults(data.results));
  }, [query]);

  return (
    <section className="page-pad">
      <h1>Search</h1>
      <p className="muted">{resultLabel}</p>
      <div className="grid-list">
        {results.map((item) => <MediaCard key={item.id} item={item} />)}
      </div>
    </section>
  );
}
