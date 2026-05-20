import MediaCard from "./MediaCard.jsx";

export default function MediaRow({ title, items }) {
  if (!items?.length) return null;
  return (
    <section className="media-row">
      <h2>{title}</h2>
      <div className="row-scroller">
        {items.map((item) => <MediaCard key={`${title}-${item.id}-${item.file_id || "details"}`} item={item} />)}
      </div>
    </section>
  );
}
