export function parseSegmentTime(value) {
  if (typeof value === "number") return value;
  if (!value) return 0;
  const parts = String(value).split(":").map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return Number(value) || 0;
}

export function normalizeSegmentType(value) {
  const type = String(value || "intro").toLowerCase().replace(/[\s-]+/g, "_");
  if (type === "end_credits" || type === "endcredits" || type === "credit") return "credits";
  return type;
}

export function addIntroDbSegment(segments, rawSegment, fallbackType, fallbackDuration) {
  if (!rawSegment || typeof rawSegment !== "object") return;

  const start = rawSegment.startTime ?? rawSegment.start_sec ?? rawSegment.startAt ?? rawSegment.start ?? null;
  if (start === null) return;

  const type = normalizeSegmentType(rawSegment.segment_type || rawSegment.type || fallbackType);
  const isOutro = type === "outro" || type === "credits";
  const end = rawSegment.endTime ?? rawSegment.end_sec ?? rawSegment.endAt ?? rawSegment.end ?? null;
  const parsedStart = parseSegmentTime(start);
  const parsedEnd = end === null && isOutro ? fallbackDuration : parseSegmentTime(end);

  if (!Number.isFinite(parsedStart) || parsedStart < 0) return;
  if (!isOutro && (!Number.isFinite(parsedEnd) || parsedEnd <= parsedStart)) return;

  segments.push({
    start: parsedStart,
    end: Number.isFinite(parsedEnd) && parsedEnd > parsedStart ? parsedEnd : parsedStart,
    type
  });
}

export function markerRowToSegment(row, fallbackDuration) {
  const start = Number(row.start);
  const rawEnd = Number(row.end);
  const isOutro = row.type === "outro" || row.type === "credits";
  const duration = Number(fallbackDuration);
  const end = Number.isFinite(rawEnd) && rawEnd > start
    ? rawEnd
    : (isOutro && Number.isFinite(duration) && duration > start ? duration : start);

  return {
    start,
    end,
    type: row.type,
    source: row.source || "manual"
  };
}

export function mergeSegmentSources(remoteSegments, manualSegments) {
  const manualTypes = new Set(manualSegments.map((segment) => segment.type));
  const hasManualOutro = manualTypes.has("outro") || manualTypes.has("credits");
  return [
    ...remoteSegments.filter((segment) => {
      if (hasManualOutro && (segment.type === "outro" || segment.type === "credits")) return false;
      return !manualTypes.has(segment.type);
    }),
    ...manualSegments
  ].sort((a, b) => a.start - b.start);
}
