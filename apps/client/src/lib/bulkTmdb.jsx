import { createContext, useCallback, useContext, useRef, useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import { apiFetch } from "./api.js";

const BulkTmdbContext = createContext(null);

const idleState = {
  running: false,
  completed: 0,
  total: 0,
  updated: 0,
  missed: 0,
  current: "",
  message: ""
};

export function BulkTmdbProvider({ children }) {
  const [task, setTask] = useState(idleState);
  const [scanTask, setScanTask] = useState(idleState);
  const clearTimer = useRef(null);
  const clearScanTimer = useRef(null);

  const clearFinishedTask = useCallback(() => {
    if (clearTimer.current) window.clearTimeout(clearTimer.current);
    clearTimer.current = window.setTimeout(() => {
      setTask((current) => current.running ? current : idleState);
    }, 8000);
  }, []);

  const clearFinishedScan = useCallback(() => {
    if (clearScanTimer.current) window.clearTimeout(clearScanTimer.current);
    clearScanTimer.current = window.setTimeout(() => {
      setScanTask((current) => current.running ? current : idleState);
    }, 8000);
  }, []);

  const startBulkTmdb = useCallback(async (items) => {
    if (!items?.length) return { updated: 0, missed: 0 };

    if (clearTimer.current) window.clearTimeout(clearTimer.current);
    let updated = 0;
    let missed = 0;

    setTask({
      ...idleState,
      running: true,
      total: items.length,
      message: "Starting TMDB updates..."
    });

    for (const [index, item] of items.entries()) {
      setTask((current) => ({
        ...current,
        completed: index,
        current: item.title,
        message: `Matching ${index + 1} of ${items.length}`
      }));

      try {
        await apiFetch(`/admin/media/${item.id}/fix-match`, {
          method: "POST",
          body: JSON.stringify({ title: item.title, year: item.year })
        });
        updated += 1;
      } catch {
        missed += 1;
      }

      setTask((current) => ({
        ...current,
        completed: index + 1,
        updated,
        missed
      }));
    }

    const result = { updated, missed };
    setTask({
      running: false,
      completed: items.length,
      total: items.length,
      updated,
      missed,
      current: "",
      message: missed
        ? `TMDB updated ${updated}. ${missed} still need review.`
        : `TMDB updated ${updated} items.`
    });
    clearFinishedTask();
    return result;
  }, [clearFinishedTask]);

  const startScan = useCallback(async (library) => {
    if (!library?.id) return null;

    if (clearScanTimer.current) window.clearTimeout(clearScanTimer.current);
    setScanTask({
      ...idleState,
      running: true,
      current: library.name,
      message: `Scanning ${library.name}...`
    });

    try {
      const result = await apiFetch(`/libraries/${library.id}/scan`, { method: "POST" });
      setScanTask({
        ...idleState,
        running: false,
        current: library.name,
        message: `Scanned ${result.scanned} files. Added ${result.added}, updated ${result.updated}.`
      });
      clearFinishedScan();
      return result;
    } catch (error) {
      setScanTask({
        ...idleState,
        running: false,
        current: library.name,
        message: error.message
      });
      clearFinishedScan();
      throw error;
    }
  }, [clearFinishedScan]);

  return (
    <BulkTmdbContext.Provider value={{ task, startBulkTmdb, scanTask, startScan }}>
      {children}
      <TaskToast
        task={task}
        icon={<Search size={17} />}
        title={task.running ? "TMDB running" : "TMDB finished"}
        onDismiss={() => setTask(idleState)}
      />
      <TaskToast
        task={scanTask}
        icon={<RefreshCw size={17} />}
        title={scanTask.running ? "Scan running" : "Scan finished"}
        offset={Boolean(task.running || task.message)}
        onDismiss={() => setScanTask(idleState)}
      />
    </BulkTmdbContext.Provider>
  );
}

export function useBulkTmdb() {
  const value = useContext(BulkTmdbContext);
  if (!value) throw new Error("useBulkTmdb must be used inside BulkTmdbProvider");
  return value;
}

function TaskToast({ task, icon, title, offset = false, onDismiss }) {
  if (!task.running && !task.message) return null;

  const progress = task.total ? Math.round((task.completed / task.total) * 100) : 0;

  return (
    <aside className={`task-toast${offset ? " task-toast-offset" : ""}`} role="status" aria-live="polite">
      <div className="task-toast-header">
        {icon}
        <strong>{title}</strong>
        {!task.running ? (
          <button type="button" className="task-toast-close" onClick={onDismiss} aria-label="Dismiss task status">
            x
          </button>
        ) : null}
      </div>
      <p>{task.message}</p>
      {task.current ? <span>{task.current}</span> : null}
      {task.running ? (
        <div className={`task-progress${task.total ? "" : " task-progress-active"}`} aria-label={task.total ? `${progress}% complete` : "In progress"}>
          <div style={task.total ? { width: `${progress}%` } : undefined} />
        </div>
      ) : null}
    </aside>
  );
}
