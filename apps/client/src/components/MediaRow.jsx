import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import MediaCard from "./MediaCard.jsx";

const easeOutQuart = (value) => 1 - Math.pow(1 - value, 4);
const MAX_GLIDE_DISTANCE = 900;
const MIN_GLIDE_VELOCITY = 0.08;
const MOMENTUM_MULTIPLIER = 720;
const SCROLL_EDGE_TOLERANCE = 2;

function clampScroll(scroller, value) {
  const maxScroll = scroller.scrollWidth - scroller.clientWidth;
  return Math.max(0, Math.min(maxScroll, value));
}

export default function MediaRow({ title, items, onRemoveItem }) {
  const scrollerRef = useRef(null);
  const animationRef = useRef(null);
  const dragRef = useRef({
    active: false,
    moved: false,
    startX: 0,
    lastX: 0,
    lastTime: 0,
    scrollLeft: 0,
    velocity: 0
  });
  const [canScrollPrevious, setCanScrollPrevious] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => () => {
    if (animationRef.current) {
      window.cancelAnimationFrame(animationRef.current);
    }
  }, []);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return undefined;

    const updateScrollButtons = () => {
      const maxScroll = scroller.scrollWidth - scroller.clientWidth;
      setCanScrollPrevious(scroller.scrollLeft > SCROLL_EDGE_TOLERANCE);
      setCanScrollNext(scroller.scrollLeft < maxScroll - SCROLL_EDGE_TOLERANCE);
    };

    updateScrollButtons();
    scroller.addEventListener("scroll", updateScrollButtons, { passive: true });
    window.addEventListener("resize", updateScrollButtons);

    return () => {
      scroller.removeEventListener("scroll", updateScrollButtons);
      window.removeEventListener("resize", updateScrollButtons);
    };
  }, [items?.length]);

  if (!items?.length) return null;

  const cancelSettleAnimation = () => {
    if (!animationRef.current) return;
    window.cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
  };

  const animateToScroll = (targetScroll, durationMultiplier = 1.05) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    cancelSettleAnimation();

    const startScroll = scroller.scrollLeft;
    const endScroll = clampScroll(scroller, targetScroll);
    const distance = endScroll - startScroll;

    if (
      Math.abs(distance) < 1 ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      scroller.scrollLeft = endScroll;
      return;
    }

    const duration = Math.min(900, Math.max(360, Math.abs(distance) * durationMultiplier));
    const startTime = performance.now();

    const animate = (time) => {
      const progress = Math.min(1, (time - startTime) / duration);
      scroller.scrollLeft = startScroll + distance * easeOutQuart(progress);

      if (progress < 1) {
        animationRef.current = window.requestAnimationFrame(animate);
      } else {
        animationRef.current = null;
      }
    };

    animationRef.current = window.requestAnimationFrame(animate);
  };

  const glideFromVelocity = (velocity) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const projectedDistance = Math.max(
      -MAX_GLIDE_DISTANCE,
      Math.min(MAX_GLIDE_DISTANCE, velocity * MOMENTUM_MULTIPLIER)
    );

    if (Math.abs(velocity) < MIN_GLIDE_VELOCITY) return;

    animateToScroll(scroller.scrollLeft + projectedDistance);
  };

  const scrollByPage = (direction) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const pageDistance = scroller.clientWidth * 0.82;
    animateToScroll(scroller.scrollLeft + pageDistance * direction, 0.72);
  };

  const stopDragging = () => {
    const drag = dragRef.current;
    if (!drag.active) return;

    drag.active = false;
    setIsDragging(false);

    if (drag.moved) {
      glideFromVelocity(drag.velocity);

      window.setTimeout(() => {
        dragRef.current.moved = false;
      }, 0);
    }
  };

  const handlePointerDown = (event) => {
    if (event.pointerType !== "mouse" || event.button !== 0) return;

    const scroller = scrollerRef.current;
    if (!scroller || scroller.scrollWidth <= scroller.clientWidth) return;

    cancelSettleAnimation();

    dragRef.current = {
      active: true,
      moved: false,
      startX: event.clientX,
      lastX: event.clientX,
      lastTime: event.timeStamp,
      scrollLeft: scroller.scrollLeft,
      velocity: 0
    };

    event.currentTarget.setPointerCapture?.(event.pointerId);
    setIsDragging(true);
  };

  const handlePointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag.active || !scrollerRef.current) return;

    const distance = event.clientX - drag.startX;
    const elapsed = Math.max(1, event.timeStamp - drag.lastTime);
    const instantVelocity = -(event.clientX - drag.lastX) / elapsed;

    if (Math.abs(distance) > 5) {
      drag.moved = true;
    }

    drag.velocity = drag.velocity * 0.72 + instantVelocity * 0.28;
    drag.lastX = event.clientX;
    drag.lastTime = event.timeStamp;

    scrollerRef.current.scrollLeft = drag.scrollLeft - distance;
    event.preventDefault();
  };

  const handleClickCapture = (event) => {
    if (!dragRef.current.moved) return;
    event.preventDefault();
    event.stopPropagation();
    dragRef.current.moved = false;
  };

  return (
    <section className="media-row">
      <h2>{title}</h2>
      <div className={`row-carousel${canScrollPrevious ? " has-previous" : ""}${canScrollNext ? " has-next" : ""}`}>
        <button
          className="row-arrow row-arrow-left"
          type="button"
          aria-label={`Scroll ${title} left`}
          aria-hidden={!canScrollPrevious}
          disabled={!canScrollPrevious}
          tabIndex={canScrollPrevious ? 0 : -1}
          onClick={() => scrollByPage(-1)}
        >
          <ChevronLeft size={26} strokeWidth={2.6} />
        </button>
        <div
          ref={scrollerRef}
          className={`row-scroller${isDragging ? " is-dragging" : ""}`}
          onClickCapture={handleClickCapture}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={stopDragging}
          onPointerCancel={stopDragging}
          onLostPointerCapture={stopDragging}
        >
          {items.map((item) => (
            <MediaCard
              key={`${title}-${item.id}-${item.file_id || "details"}`}
              item={item}
              onRemove={onRemoveItem ? () => onRemoveItem(item) : undefined}
            />
          ))}
        </div>
        <button
          className="row-arrow row-arrow-right"
          type="button"
          aria-label={`Scroll ${title} right`}
          aria-hidden={!canScrollNext}
          disabled={!canScrollNext}
          tabIndex={canScrollNext ? 0 : -1}
          onClick={() => scrollByPage(1)}
        >
          <ChevronRight size={26} strokeWidth={2.6} />
        </button>
      </div>
    </section>
  );
}
