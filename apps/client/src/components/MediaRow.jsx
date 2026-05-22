import MediaCard from "./MediaCard.jsx";
import RowCarousel from "./RowCarousel.jsx";

export default function MediaRow({ title, items, onRemoveItem }) {
  if (!items?.length) return null;

  return (
    <section className="media-row">
      <h2>{title}</h2>
      <RowCarousel ariaLabel={title} scrollKey={items.length}>
        {items.map((item) => (
          <MediaCard
            key={`${title}-${item.id}-${item.file_id || "details"}`}
            item={item}
            onRemove={onRemoveItem ? () => onRemoveItem(item) : undefined}
          />
        ))}
      </RowCarousel>
    </section>
  );
}
