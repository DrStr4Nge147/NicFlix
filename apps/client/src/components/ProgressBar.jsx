export default function ProgressBar({ position = 0, duration = 0 }) {
  const percent = duration ? Math.min(100, Math.max(0, (position / duration) * 100)) : 0;
  return (
    <div className="progress-track" aria-hidden="true">
      <span style={{ width: `${percent}%` }} />
    </div>
  );
}

