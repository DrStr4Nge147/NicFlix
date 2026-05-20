import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { apiFetch } from "../lib/api.js";
import MediaCard from "../components/MediaCard.jsx";

export default function SearchResults() {
  const [params] = useSearchParams();
  const query = params.get("q") || "";
  const [results, setResults] = useState([]);

  useEffect(() => {
    apiFetch(`/search?q=${encodeURIComponent(query)}`).then((data) => setResults(data.results));
  }, [query]);

  return (
    <section className="page-pad">
      <h1>Search</h1>
      <p className="muted">{results.length} result{results.length === 1 ? "" : "s"} for "{query}"</p>
      <div className="grid-list">
        {results.map((item) => <MediaCard key={item.id} item={item} />)}
      </div>
    </section>
  );
}

