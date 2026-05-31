import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, AudioLines, Captions, Clock3, List, Maximize, Pause, PictureInPicture2, Play, SkipBack, SkipForward, Volume2, VolumeX } from "lucide-react";
import { apiFetch } from "../lib/api.js";

function formatTime(seconds = 0) {
  if (!Number.isFinite(seconds)) return "0:00";
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${secs}` : `${minutes}:${secs}`;
}

function lockLandscape() {
  const orientation = window.screen?.orientation;
  if (!orientation?.lock) return Promise.resolve(false);

  return orientation.lock("landscape").then(
    () => true,
    () => false
  );
}

function unlockOrientation() {
  window.screen?.orientation?.unlock?.();
}

function getFullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

function subtitleSrc(track, offset) {
  if (!track?.src || offset <= 0.25) return track?.src || "";
  const separator = track.src.includes("?") ? "&" : "?";
  return `${track.src}${separator}start=${encodeURIComponent(offset.toFixed(2))}`;
}

function cueTextLines(cue) {
  const fragment = typeof cue?.getCueAsHTML === "function" ? cue.getCueAsHTML() : null;
  const text = fragment?.textContent || cue?.text || "";
  return String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

const PLAYER_VOLUME_KEY = "nicflix.playerVolume";
const PLAYER_MUTED_KEY = "nicflix.playerMuted";
const NEXT_UP_COUNTDOWN_SECONDS = 5;
const OUTRO_SEGMENT_TYPES = new Set(["outro", "credits"]);

function isOutroSegment(segment) {
  return OUTRO_SEGMENT_TYPES.has(segment?.type);
}

function clampVolume(value) {
  const volume = Number(value);
  if (!Number.isFinite(volume)) return 1;
  return Math.min(1, Math.max(0, volume));
}

function getStoredVolume() {
  try {
    const storedVolume = localStorage.getItem(PLAYER_VOLUME_KEY);
    return storedVolume === null ? 1 : clampVolume(storedVolume);
  } catch {
    return 1;
  }
}

function getStoredMuted() {
  try {
    return localStorage.getItem(PLAYER_MUTED_KEY) === "true";
  } catch {
    return false;
  }
}

function saveStoredPlayerVolume(nextVolume, nextMuted) {
  try {
    localStorage.setItem(PLAYER_VOLUME_KEY, String(clampVolume(nextVolume)));
    localStorage.setItem(PLAYER_MUTED_KEY, String(Boolean(nextMuted)));
  } catch {
    // Ignore unavailable storage; the in-memory video state still updates.
  }
}

function applyPlayerVolume(video, nextVolume, nextMuted) {
  if (!video) return;
  const clampedVolume = clampVolume(nextVolume);
  video.volume = clampedVolume;
  video.muted = nextMuted || clampedVolume === 0;
}

function reliableDuration(video, fallbackDuration) {
  const videoDuration = Number(video?.duration);
  if (Number.isFinite(videoDuration) && videoDuration > 0) return videoDuration;

  const fileDuration = Number(fallbackDuration);
  return Number.isFinite(fileDuration) && fileDuration > 0 ? fileDuration : 0;
}

function nearestTimelineThumbnail(timelineThumbnails, time) {
  const thumbnails = timelineThumbnails?.thumbnails || [];
  if (!thumbnails.length) return null;
  const interval = Number(timelineThumbnails.interval || 0);
  if (interval > 0) {
    const index = Math.min(thumbnails.length - 1, Math.max(0, Math.round(time / interval)));
    return thumbnails[index] || null;
  }
  return thumbnails.reduce((nearest, item) => (
    Math.abs(item.time - time) < Math.abs(nearest.time - time) ? item : nearest
  ), thumbnails[0]);
}

export default function Watch() {
  const { fileId } = useParams();
  const navigate = useNavigate();
  const playerRef = useRef(null);
  const videoRef = useRef(null);
  const resumeAfterSourceChangeRef = useRef(null);
  const [tracks, setTracks] = useState({ audioTracks: [], subtitleTracks: [] });
  const [playbackInfo, setPlaybackInfo] = useState(null);
  const [selectedAudio, setSelectedAudio] = useState("");
  const [selectedSubtitle, setSelectedSubtitle] = useState("off");
  const [activeSubtitles, setActiveSubtitles] = useState([]);
  const [openTrackMenu, setOpenTrackMenu] = useState(null);
  const [playbackContext, setPlaybackContext] = useState(null);
  const [openSeasons, setOpenSeasons] = useState({});
  const [showData, setShowData] = useState({ seasons: [], episodes: [] });
  const [episodeNav, setEpisodeNav] = useState({ previous: null, next: null });
  const [nextUp, setNextUp] = useState(null);
  const [countdown, setCountdown] = useState(null);
  const [autoPlayNext, setAutoPlayNext] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [streamOffset, setStreamOffset] = useState(0);
  const [volume, setVolume] = useState(getStoredVolume);
  const [muted, setMuted] = useState(getStoredMuted);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [segments, setSegments] = useState([]);
  const [activeSegment, setActiveSegment] = useState(null);
  const [dismissedNextUpKey, setDismissedNextUpKey] = useState(null);
  const [nextUpTriggerKey, setNextUpTriggerKey] = useState(null);
  const [globalSettings, setGlobalSettings] = useState(null);
  const [markerSaveStatus, setMarkerSaveStatus] = useState(null);
  const [timelineThumbnails, setTimelineThumbnails] = useState({ status: "idle", thumbnails: [] });
  const [seekPreview, setSeekPreview] = useState(null);
  const isTranscodedPlayback = playbackInfo?.directPlay === false || playbackContext?.directPlay === false;
  const fileDuration = Number(playbackInfo?.duration || playbackContext?.duration || 0) || 0;
  const hasPlaybackMetadata = Boolean(playbackInfo || playbackContext);

  const bindVideoRef = useCallback((video) => {
    videoRef.current = video;
    applyPlayerVolume(video, volume, muted);
  }, [muted, volume]);

  const saveProgress = useCallback((watched = false, options = {}) => {
    const video = options.video || videoRef.current;
    if (!video || video.dataset.fileId !== String(fileId)) return Promise.resolve();

    const mediaDuration = isTranscodedPlayback
      ? fileDuration
      : reliableDuration(video, fileDuration);
    if (!mediaDuration) return Promise.resolve();

    const rawPosition = isTranscodedPlayback ? streamOffset + (video.currentTime || 0) : (video.currentTime || 0);
    const position = Math.min(mediaDuration, Math.max(0, rawPosition));
    if (!watched && position <= 0.5) return Promise.resolve();

    return apiFetch(`/progress/${fileId}`, {
      method: "POST",
      keepalive: options.keepalive === true,
      body: JSON.stringify({
        position: watched ? mediaDuration : position,
        duration: mediaDuration,
        watched
      })
    }).catch(() => {});
  }, [fileDuration, fileId, isTranscodedPlayback, streamOffset]);

  useEffect(() => {
    if (!isPlaying) {
      setControlsVisible(true);
      return undefined;
    }

    const timer = window.setTimeout(() => setControlsVisible(false), 3000);
    return () => window.clearTimeout(timer);
  }, [controlsVisible, isPlaying]);

  useEffect(() => {
    lockLandscape();
    return () => unlockOrientation();
  }, []);

  const syncPlayerViewport = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;

    const width = window.innerWidth || document.documentElement.clientWidth;
    const height = window.innerHeight || document.documentElement.clientHeight;
    if (width) player.style.setProperty("--watch-viewport-width", `${width}px`);
    if (height) player.style.setProperty("--watch-viewport-height", `${height}px`);
  }, []);

  const refreshPlayerLayout = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;

    syncPlayerViewport();
    player.classList.add("watch-layout-refresh");
    void player.offsetHeight;

    const finishRefresh = () => {
      player.classList.remove("watch-layout-refresh");
      syncPlayerViewport();
    };

    window.requestAnimationFrame(() => {
      void player.offsetHeight;
      window.requestAnimationFrame(finishRefresh);
    });
    window.setTimeout(finishRefresh, 160);
  }, [syncPlayerViewport]);

  useEffect(() => {
    let timeoutId;

    function scheduleViewportSync() {
      syncPlayerViewport();
      window.requestAnimationFrame(syncPlayerViewport);
      timeoutId = window.setTimeout(syncPlayerViewport, 120);
    }

    function handleFullscreenChange() {
      scheduleViewportSync();
      if (!getFullscreenElement()) refreshPlayerLayout();
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") refreshPlayerLayout();
    }

    const orientation = window.screen?.orientation;

    scheduleViewportSync();
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("resize", scheduleViewportSync);
    orientation?.addEventListener?.("change", scheduleViewportSync);

    return () => {
      window.clearTimeout(timeoutId);
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", handleFullscreenChange);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("resize", scheduleViewportSync);
      orientation?.removeEventListener?.("change", scheduleViewportSync);
    };
  }, [refreshPlayerLayout, syncPlayerViewport]);

  useEffect(() => {
    if (isPlaying) lockLandscape();
  }, [isPlaying]);

  useEffect(() => {
    setNextUp(null);
    setCountdown(null);
    setPlaybackContext(null);
    setPlaybackInfo(null);
    setEpisodeNav({ previous: null, next: null });
    setSelectedAudio("");
    setSelectedSubtitle("off");
    setOpenTrackMenu(null);
    setCurrentTime(0);
    setDuration(0);
    setStreamOffset(0);
    setTimelineThumbnails({ status: "idle", thumbnails: [] });
    setSeekPreview(null);
    resumeAfterSourceChangeRef.current = null;
    let cancelled = false;
    apiFetch(`/files/${fileId}/tracks`)
      .then((data) => {
        if (!cancelled) {
          setTracks({ audioTracks: data.audioTracks || [], subtitleTracks: data.subtitleTracks || [] });
          setPlaybackInfo(data.playback || null);
          if (data.playback?.duration) setDuration(Number(data.playback.duration) || 0);
          if (data.subtitleTracks?.length > 0) {
            const englishIndex = data.subtitleTracks.findIndex((t) =>
              (t.language || "").toLowerCase().includes("en")
              || (t.label || "").toLowerCase().includes("eng")
            );
            setSelectedSubtitle(englishIndex !== -1 ? String(englishIndex) : "0");
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTracks({ audioTracks: [], subtitleTracks: [] });
          setPlaybackInfo(null);
        }
      });
    apiFetch(`/files/${fileId}/context`)
      .then(({ context }) => {
        if (!cancelled) {
          setPlaybackContext(context);
          if (context?.duration) setDuration(Number(context.duration) || 0);
        }
      })
      .catch(() => {
        if (!cancelled) setPlaybackContext(null);
      });
    apiFetch(`/files/${fileId}/navigation`)
      .then((data) => {
        if (!cancelled) setEpisodeNav(data);
      })
      .catch(() => {
        if (!cancelled) setEpisodeNav({ previous: null, next: null });
      });

    setSegments([]);
    setActiveSegment(null);
    setDismissedNextUpKey(null);
    setNextUpTriggerKey(null);
    apiFetch(`/files/${fileId}/segments`)
      .then((data) => {
        if (!cancelled && data.segments) setSegments(data.segments);
      })
      .catch(() => {
        if (!cancelled) setSegments([]);
      });

    apiFetch("/settings")
      .then((data) => {
        if (!cancelled) {
          setGlobalSettings(data);
          setAutoPlayNext(data.autoPlayNextEnabled !== false);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [fileId]);

  useEffect(() => {
    function handleSettingsUpdated(event) {
      if (event.detail) {
        setGlobalSettings((current) => ({ ...current, ...event.detail }));
      }
    }

    window.addEventListener("nicflix:settings-updated", handleSettingsUpdated);
    return () => window.removeEventListener("nicflix:settings-updated", handleSettingsUpdated);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer;

    function loadTimelineThumbnails() {
      apiFetch(`/files/${fileId}/thumbnails`)
        .then((data) => {
          if (cancelled) return;
          setTimelineThumbnails(data || { status: "unavailable", thumbnails: [] });
          if (data?.status === "generating") {
            timer = window.setTimeout(loadTimelineThumbnails, 3000);
          }
        })
        .catch(() => {
          if (!cancelled) setTimelineThumbnails({ status: "unavailable", thumbnails: [] });
        });
    }

    loadTimelineThumbnails();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [fileId]);

  useEffect(() => {
    if (!timelineThumbnails?.thumbnails?.length) return undefined;
    const urls = [...new Set((timelineThumbnails.thumbnails || []).map((item) => item.src).filter(Boolean))];
    const images = urls.map((src) => {
      const image = new Image();
      image.src = src;
      return image;
    });
    return () => {
      images.forEach((image) => {
        image.src = "";
      });
    };
  }, [timelineThumbnails]);

  useEffect(() => {
    if (!playbackContext || playbackContext.type !== "tv" || !playbackContext.mediaItemId) {
      setShowData({ seasons: [], episodes: [] });
      return undefined;
    }

    let cancelled = false;
    apiFetch(`/shows/${playbackContext.mediaItemId}`).then((data) => {
      if (!cancelled) {
        setShowData(data);
        if (playbackContext.seasonNumber !== undefined) {
          setOpenSeasons((prev) => ({ ...prev, [playbackContext.seasonNumber]: true }));
        }
      }
    }).catch(() => {
      if (!cancelled) setShowData({ seasons: [], episodes: [] });
    });

    return () => {
      cancelled = true;
    };
  }, [playbackContext]);

  useEffect(() => {
    if (!playbackContext) return undefined;
    let cancelled = false;
    const video = videoRef.current;
    if (fileDuration) setDuration(fileDuration);
    apiFetch(`/progress/${fileId}`).then(({ progress }) => {
      if (cancelled) return;
      const restoredPosition = Number(progress?.position || 0);
      const restoredDuration = Number(progress?.duration || fileDuration || 0);
      const isWatched = progress?.watched === 1 || progress?.watched === true;
      if (isWatched || (restoredDuration > 0 && restoredPosition >= restoredDuration - 1)) return;
      if (video && restoredPosition > 0) {
        if (isTranscodedPlayback) {
          resumeAfterSourceChangeRef.current = { time: 0, wasPlaying: true };
          setStreamOffset(restoredPosition);
          setCurrentTime(restoredPosition);
          return;
        }
        video.currentTime = restoredPosition;
      }
    }).catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [fileDuration, fileId, isTranscodedPlayback, playbackContext]);

  useEffect(() => {
    applyPlayerVolume(videoRef.current, volume, muted);
  }, [hasPlaybackMetadata, muted, volume]);

  useEffect(() => {
    let timer;
    const video = videoRef.current;

    function save() {
      saveProgress(false, { video });
    }

    function saveForUnload() {
      saveProgress(false, { keepalive: true, video });
    }

    function syncPlaybackState() {
      if (!video) return;
      const mediaDuration = isTranscodedPlayback
        ? fileDuration
        : (fileDuration || (Number.isFinite(video.duration) ? video.duration : 0));
      const rawPosition = isTranscodedPlayback ? streamOffset + (video.currentTime || 0) : (video.currentTime || 0);
      setCurrentTime(mediaDuration ? Math.min(rawPosition, mediaDuration) : rawPosition);
      if (mediaDuration) setDuration(mediaDuration);
      setIsPlaying(!video.paused);
    }

    function syncVolumeState() {
      if (!video) return;
      const nextVolume = clampVolume(video.volume);
      const nextMuted = video.muted;
      setVolume(nextVolume);
      setMuted(nextMuted);
      saveStoredPlayerVolume(nextVolume, nextMuted);
    }

    function handleEnded() {
      saveProgress(true, { video });
      if (!episodeNav.next) return;
      setNextUpTriggerKey(null);
      setNextUp(episodeNav.next);
      setCountdown(autoPlayNext ? NEXT_UP_COUNTDOWN_SECONDS : null);
    }

    timer = window.setInterval(save, 10000);
    video?.addEventListener("loadedmetadata", syncPlaybackState);
    video?.addEventListener("timeupdate", syncPlaybackState);
    video?.addEventListener("play", syncPlaybackState);
    video?.addEventListener("pause", syncPlaybackState);
    video?.addEventListener("volumechange", syncVolumeState);
    video?.addEventListener("pause", save);
    video?.addEventListener("ended", handleEnded);
    window.addEventListener("pagehide", saveForUnload);
    window.addEventListener("beforeunload", saveForUnload);

    return () => {
      save();
      window.clearInterval(timer);
      video?.removeEventListener("loadedmetadata", syncPlaybackState);
      video?.removeEventListener("timeupdate", syncPlaybackState);
      video?.removeEventListener("play", syncPlaybackState);
      video?.removeEventListener("pause", syncPlaybackState);
      video?.removeEventListener("volumechange", syncVolumeState);
      video?.removeEventListener("pause", save);
      video?.removeEventListener("ended", handleEnded);
      window.removeEventListener("pagehide", saveForUnload);
      window.removeEventListener("beforeunload", saveForUnload);
    };
  }, [autoPlayNext, episodeNav.next, fileDuration, fileId, isTranscodedPlayback, saveProgress, streamOffset]);

  useEffect(() => {
    if (!segments.length) {
      setActiveSegment(null);
      return;
    }
    // Find the currently active segment with a small buffer for precision
    const segment = segments.find((s) => {
      const isOutro = isOutroSegment(s);
      if (isOutro) {
        // Outros should appear as soon as the segment starts and stay until the end of the file
        return currentTime >= s.start - (s.source === "manual" ? 0 : 1);
      }
      return currentTime >= s.start - 0.5 && currentTime < s.end - 0.2;
    });
    setActiveSegment(segment || null);
  }, [currentTime, segments]);

  const activeOutroSkipKey = isOutroSegment(activeSegment)
    ? `${fileId}:${activeSegment.type}:${Number(activeSegment.start) || 0}`
    : null;
  const canShowMarkerCorrection = Boolean(
    globalSettings?.markerCorrectionEnabled
    && globalSettings?.autoSkipEnabled
    && playbackContext?.type === "tv"
    && episodeNav.next
    && (isOutroSegment(activeSegment) || (duration > 0 && currentTime >= duration * 0.75))
  );
  const showSegmentSkipButton = activeSegment && !(isOutroSegment(activeSegment) && episodeNav.next);
  const nextUpProgressing = countdown !== null;
  const markerSaving = markerSaveStatus?.state === "saving";

  useEffect(() => {
    if (!nextUpTriggerKey) return;
    if (activeOutroSkipKey === nextUpTriggerKey) return;

    setNextUp(null);
    setCountdown(null);
    setNextUpTriggerKey(null);
  }, [activeOutroSkipKey, nextUpTriggerKey]);

  useEffect(() => {
    if (!activeOutroSkipKey || !episodeNav.next || dismissedNextUpKey === activeOutroSkipKey) return;

    setNextUp((current) => (
      Number(current?.file_id) === Number(episodeNav.next.file_id) ? current : episodeNav.next
    ));
    setNextUpTriggerKey(activeOutroSkipKey);
    setCountdown((value) => (autoPlayNext && value === null ? NEXT_UP_COUNTDOWN_SECONDS : value));
  }, [activeOutroSkipKey, autoPlayNext, dismissedNextUpKey, episodeNav.next]);

  function skipSegment() {
    if (activeSegment && videoRef.current) {
      if (isOutroSegment(activeSegment) && episodeNav.next) {
        playNext(episodeNav.next);
      } else {
        const isOutro = isOutroSegment(activeSegment);
        seekTo(isOutro ? duration : activeSegment.end);
        setActiveSegment(null);
      }
    }
  }

  function dismissNextUp() {
    if (activeOutroSkipKey) setDismissedNextUpKey(activeOutroSkipKey);
    setNextUp(null);
    setCountdown(null);
    setNextUpTriggerKey(null);
  }

  async function saveCreditsMarker() {
    if (markerSaving) return;

    const start = Math.max(0, currentTime || 0);
    try {
      setMarkerSaveStatus({ state: "saving", message: "Saving credits marker" });
      const data = await apiFetch(`/files/${fileId}/segments/credits`, {
        method: "PUT",
        body: JSON.stringify({ start })
      });
      const marker = data.marker;
      if (marker) {
        setSegments((current) => [
          ...current.filter((segment) => segment.type !== marker.type),
          marker
        ].sort((a, b) => a.start - b.start));
        setActiveSegment(marker);
        setDismissedNextUpKey(null);
      }
      setMarkerSaveStatus({ state: "saved", message: `Credits saved at ${formatTime(start)}` });
      window.setTimeout(() => {
        setMarkerSaveStatus((status) => (status?.state === "saved" ? null : status));
      }, 3000);
    } catch (error) {
      setMarkerSaveStatus({ state: "error", message: error.message });
      window.setTimeout(() => {
        setMarkerSaveStatus((status) => (status?.state === "error" ? null : status));
      }, 5000);
    }
  }

  function toggleSeason(seasonNumber) {
    setOpenSeasons((prev) => ({
      ...prev,
      [seasonNumber]: !prev[seasonNumber]
    }));
  }

  useEffect(() => {
    if (!nextUp || countdown === null) return undefined;
    if (countdown <= 0) {
      saveProgress(true).finally(() => navigate(`/watch/${nextUp.file_id}`, { replace: true }));
      return undefined;
    }

    const timer = window.setTimeout(() => setCountdown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [countdown, navigate, nextUp, saveProgress]);

  const selectedAudioTrack = selectedAudio !== "" ? tracks.audioTracks[Number(selectedAudio)] : null;
  const streamParams = new URLSearchParams();
  if (selectedAudioTrack?.index !== undefined) {
    streamParams.set("audio", selectedAudioTrack.index);
  }
  if (isTranscodedPlayback && streamOffset > 0.25) {
    streamParams.set("start", streamOffset.toFixed(2));
  }
  const streamQuery = streamParams.toString();
  const streamSrc = `/api/stream/${fileId}${streamQuery ? `?${streamQuery}` : ""}`;
  const subtitleOffset = isTranscodedPlayback ? streamOffset : 0;

  useEffect(() => {
    const resume = resumeAfterSourceChangeRef.current;
    const video = videoRef.current;
    if (!resume || !video) return undefined;

    function restorePlaybackPosition() {
      if (Number.isFinite(resume.time) && resume.time > 0) {
        video.currentTime = resume.time;
      }
      if (resume.wasPlaying) {
        video.play().catch(() => {});
      }
      resumeAfterSourceChangeRef.current = null;
    }

    video.addEventListener("loadedmetadata", restorePlaybackPosition, { once: true });
    return () => video.removeEventListener("loadedmetadata", restorePlaybackPosition);
  }, [streamSrc]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;

    let selectedTrack = null;

    function syncActiveSubtitles() {
      if (!selectedTrack) {
        setActiveSubtitles([]);
        return;
      }

      const cues = Array.from(selectedTrack.activeCues || []);
      setActiveSubtitles(cues.map((cue, index) => ({
        key: cue.id || `${cue.startTime}-${cue.endTime}-${index}`,
        lines: cueTextLines(cue)
      })));
    }

    function applyTrackMode() {
      selectedTrack = null;
      Array.from(video.textTracks || []).forEach((track, index) => {
        const isSelected = selectedSubtitle !== "off" && String(index) === selectedSubtitle;
        track.mode = isSelected ? "hidden" : "disabled";
        if (isSelected) selectedTrack = track;
      });
      syncActiveSubtitles();
      selectedTrack?.addEventListener?.("cuechange", syncActiveSubtitles);
    }

    const timer = window.setTimeout(applyTrackMode, 250);
    video.addEventListener("timeupdate", syncActiveSubtitles);

    return () => {
      window.clearTimeout(timer);
      video.removeEventListener("timeupdate", syncActiveSubtitles);
      selectedTrack?.removeEventListener?.("cuechange", syncActiveSubtitles);
    };
  }, [selectedSubtitle, tracks.subtitleTracks]);

  useEffect(() => {
    function closeMenus(event) {
      if (!event.target.closest(".watch-track-menu")) {
        setOpenTrackMenu(null);
      }
    }

    document.addEventListener("pointerdown", closeMenus);
    return () => document.removeEventListener("pointerdown", closeMenus);
  }, []);

  useEffect(() => {
    function handleKeyDown(event) {
      if (["input", "textarea"].includes(event.target.tagName.toLowerCase())) return;

      const video = videoRef.current;
      if (!video) return;

      switch (event.code) {
        case "Space":
        case "KeyK":
          event.preventDefault();
          togglePlayback();
          break;
        case "ArrowLeft":
          seekTo(currentTime - 10);
          showControls();
          break;
        case "ArrowRight":
          seekTo(currentTime + 10);
          showControls();
          break;
        case "KeyF":
          toggleFullscreen();
          break;
        case "KeyM":
          toggleMute();
          break;
        default:
          break;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentTime, duration, playbackContext]);

  function changeAudioTrack(value) {
    const video = videoRef.current;
    const audioTracks = video?.audioTracks;
    setSelectedAudio(value);
    setOpenTrackMenu(null);
    if (!audioTracks?.length) {
      if (video && isTranscodedPlayback) {
        const targetTime = Math.min(duration || Infinity, Math.max(0, currentTime || streamOffset + (video.currentTime || 0)));
        resumeAfterSourceChangeRef.current = { time: 0, wasPlaying: !video.paused };
        setStreamOffset(targetTime);
      } else {
        resumeAfterSourceChangeRef.current = video
          ? { time: video.currentTime || 0, wasPlaying: !video.paused }
          : null;
      }
      return;
    }

    Array.from(audioTracks).forEach((track, index) => {
      track.enabled = value === "" ? index === 0 : String(index) === value;
    });
  }

  function changeSubtitleTrack(value) {
    setSelectedSubtitle(value);
    setOpenTrackMenu(null);
    if (value === "off") setActiveSubtitles([]);
    const video = videoRef.current;
    Array.from(video?.textTracks || []).forEach((track, index) => {
      track.mode = String(index) === value ? "hidden" : "disabled";
    });
  }

  function toggleTrackMenu(menu) {
    setOpenTrackMenu((current) => (current === menu ? null : menu));
  }

  function playNext(file = nextUp || episodeNav.next) {
    if (!file?.file_id) return;
    saveProgress(true).finally(() => navigate(`/watch/${file.file_id}`, { replace: true }));
  }

  function playEpisode(file) {
    if (!file?.file_id) return;
    saveProgress().finally(() => navigate(`/watch/${file.file_id}`, { replace: true }));
  }

  function togglePlayback() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }

  function seekTo(value) {
    const video = videoRef.current;
    if (!video) return;
    const maxDuration = duration || fileDuration || value;
    const nextTime = Math.min(maxDuration, Math.max(0, Number(value) || 0));
    setCurrentTime(nextTime);

    if (isTranscodedPlayback) {
      resumeAfterSourceChangeRef.current = { time: 0, wasPlaying: !video.paused };
      setStreamOffset(nextTime);
      return;
    }

    video.currentTime = nextTime;
  }

  function seek(event) {
    seekTo(Number(event.target.value));
  }

  function updateSeekPreview(event) {
    const mediaDuration = duration || fileDuration;
    if (!mediaDuration || !timelineThumbnails?.thumbnails?.length) {
      setSeekPreview(null);
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width) return;
    const x = Math.min(rect.width, Math.max(0, event.clientX - rect.left));
    const time = (x / rect.width) * mediaDuration;
    const thumbnail = nearestTimelineThumbnail(timelineThumbnails, time);
    if (!thumbnail) {
      setSeekPreview(null);
      return;
    }

    setSeekPreview({ x, time, thumbnail });
    showControls();
  }

  function hideSeekPreview() {
    setSeekPreview(null);
  }

  function toggleMute() {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
  }

  function changeVolume(event) {
    const video = videoRef.current;
    if (!video) return;
    const nextVolume = Number(event.target.value);
    video.volume = nextVolume;
    video.muted = nextVolume === 0;
  }

  async function togglePip() {
    const video = videoRef.current;
    if (!video) return;
    try {
      if (video !== document.pictureInPictureElement) {
        await video.requestPictureInPicture();
      } else {
        await document.exitPictureInPicture();
      }
    } catch (error) {
      console.warn("PiP failed:", error);
    }
  }

  async function toggleFullscreen() {
    const container = playerRef.current;
    if (!container) return;
    if (getFullscreenElement()) {
      try {
        await (document.exitFullscreen?.() || document.webkitExitFullscreen?.());
      } finally {
        refreshPlayerLayout();
      }
    } else {
      syncPlayerViewport();
      await (container.requestFullscreen?.() || container.webkitRequestFullscreen?.());
      lockLandscape();
      syncPlayerViewport();
    }
  }

  function showControls() {
    setControlsVisible(true);
  }

  function handleTouchStart() {
    showControls();
    lockLandscape();
  }

  return (
    <section
      ref={playerRef}
      className={`watch-page ${controlsVisible || !isPlaying ? "controls-visible" : "controls-hidden"}`}
      onMouseMove={showControls}
      onTouchStart={handleTouchStart}
      onFocus={showControls}
    >
      <button className="watch-back-button" type="button" onClick={() => navigate(-1)} aria-label="Go back">
        <ArrowLeft size={19} /> Back
      </button>
      {playbackContext ? (
        <div className={`watch-pause-overlay ${!isPlaying ? "visible" : ""}`}>
          <div className="watch-pause-content">
            <span className="eyebrow">{playbackContext.type === "tv" ? "TV Show" : "Movie"}</span>
            <h1>{playbackContext.title}</h1>
            {playbackContext.subtitle ? <h2>{playbackContext.subtitle}</h2> : null}
          </div>
        </div>
      ) : null}

      {hasPlaybackMetadata ? (
        <video
          key={fileId}
          ref={bindVideoRef}
          data-file-id={fileId}
          src={streamSrc}
          autoPlay
          playsInline
          onClick={showControls}
          onDoubleClick={togglePlayback}
        >
          {tracks.subtitleTracks.map((track, index) => (
            <track
              key={`${track.src}-${subtitleOffset.toFixed(2)}-${index}`}
              kind={track.kind || "subtitles"}
              src={subtitleSrc(track, subtitleOffset)}
              srcLang={track.language || "en"}
              label={track.label || `Subtitles ${index + 1}`}
            />
          ))}
        </video>
      ) : null}

      {activeSubtitles.length ? (
        <div className="watch-subtitle-overlay" aria-hidden="true">
          {activeSubtitles.map((cue) => (
            <div className="watch-subtitle-cue" key={cue.key}>
              {cue.lines.map((line, lineIndex) => (
                line
                  ? <span className="watch-subtitle-line" key={`${cue.key}-${lineIndex}`}>{line}</span>
                  : <br key={`${cue.key}-${lineIndex}`} />
              ))}
            </div>
          ))}
        </div>
      ) : null}

      {showSegmentSkipButton ? (
        <button
          className={`watch-skip-button ${!controlsVisible && isPlaying ? "controls-hidden" : ""}`}
          type="button"
          onClick={skipSegment}
        >
          {activeSegment.type === "intro"
            ? "Skip Intro"
            : activeSegment.type === "recap"
              ? "Skip Recap"
              : (activeSegment.type === "outro" || activeSegment.type === "credits") && episodeNav.next
                ? "Next Episode"
                : "Skip Outro"}
          <SkipForward size={20} fill="currentColor" />
        </button>
      ) : null}

      {nextUp ? (
        <div className={`watch-next-up ${!controlsVisible && isPlaying ? "controls-hidden" : ""}`}>
          <button
            className={`watch-next-button ${nextUpProgressing ? "progressing" : ""}`}
            type="button"
            onClick={() => playNext()}
            style={{ "--next-up-duration": `${NEXT_UP_COUNTDOWN_SECONDS}s` }}
            aria-label="Play next episode"
          >
            <span>
              <Play size={18} fill="currentColor" />
              Next Episode
            </span>
          </button>
          <button className="watch-next-cancel" type="button" onClick={dismissNextUp}>
            Cancel
          </button>
        </div>
      ) : null}

      <div className="watch-controls">
        <div
          className="watch-seek-shell"
          onPointerDown={updateSeekPreview}
          onPointerMove={updateSeekPreview}
          onPointerLeave={hideSeekPreview}
        >
          {seekPreview?.thumbnail ? (
            <div
              className="watch-seek-preview"
              style={{
                "--preview-left": `${seekPreview.x}px`,
                width: `${seekPreview.thumbnail.width}px`,
                height: `${seekPreview.thumbnail.height}px`,
                backgroundImage: `url(${seekPreview.thumbnail.src})`,
                backgroundPosition: `-${seekPreview.thumbnail.x}px -${seekPreview.thumbnail.y}px`,
                backgroundSize: `${seekPreview.thumbnail.sheetWidth}px ${seekPreview.thumbnail.sheetHeight}px`
              }}
              aria-hidden="true"
            >
              <span>{formatTime(seekPreview.time)}</span>
            </div>
          ) : null}
          <input
            className="watch-seek"
            type="range"
            min="0"
            max={duration || 0}
            step="0.1"
            value={Math.min(currentTime, duration || currentTime)}
            onChange={seek}
            aria-label="Playback position"
            style={{ "--progress": `${duration ? (currentTime / duration) * 100 : 0}%` }}
          />
        </div>
        <div className="watch-control-row">
          <button className="watch-control-button" type="button" onClick={togglePlayback} aria-label={isPlaying ? "Pause" : "Play"}>
            {isPlaying ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}
          </button>
          <button
            className="watch-control-button"
            type="button"
            onClick={() => playEpisode(episodeNav.previous)}
            disabled={!episodeNav.previous}
            aria-label="Previous episode"
            title="Previous episode"
          >
            <SkipBack size={23} fill="currentColor" />
          </button>
          <button
            className="watch-control-button"
            type="button"
            onClick={() => playEpisode(episodeNav.next)}
            disabled={!episodeNav.next}
            aria-label="Next episode"
            title="Next episode"
          >
            <SkipForward size={23} fill="currentColor" />
          </button>
          {canShowMarkerCorrection ? (
            <button
              className="watch-control-button"
              type="button"
              onClick={saveCreditsMarker}
              disabled={markerSaving}
              aria-label="Set credits start to current time"
              title="Set credits start to current time"
            >
              <Clock3 size={22} />
            </button>
          ) : null}
          <span className="watch-time">{formatTime(currentTime)} / {formatTime(duration)}</span>
          {markerSaveStatus ? <span className={`watch-marker-status ${markerSaveStatus.state}`}>{markerSaveStatus.message}</span> : null}
          <div className="watch-control-spacer" />
          <button className="watch-control-button" type="button" onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"}>
            {muted || volume === 0 ? <VolumeX size={24} /> : <Volume2 size={24} />}
          </button>
          <input
            className="watch-volume"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={muted ? 0 : volume}
            onChange={changeVolume}
            aria-label="Volume"
          />
          <div className="watch-track-menu">
            <button
              className="watch-control-button"
              type="button"
              onClick={() => toggleTrackMenu("subtitles")}
              aria-label="Subtitles"
              aria-haspopup="menu"
              aria-expanded={openTrackMenu === "subtitles"}
              disabled={!tracks.subtitleTracks.length}
              title="Subtitles"
            >
              <Captions size={23} />
            </button>
            {openTrackMenu === "subtitles" ? (
              <div className="watch-track-popover" role="menu" aria-label="Subtitles">
                <button
                  className={selectedSubtitle === "off" ? "active" : ""}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selectedSubtitle === "off"}
                  onClick={() => changeSubtitleTrack("off")}
                >
                  Off
                </button>
                {tracks.subtitleTracks.map((track, index) => (
                  <button
                    className={selectedSubtitle === String(index) ? "active" : ""}
                    key={`${track.src}-${index}`}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selectedSubtitle === String(index)}
                    onClick={() => changeSubtitleTrack(String(index))}
                  >
                    {track.label || track.language || `Subtitles ${index + 1}`}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="watch-track-menu">
            <button
              className="watch-control-button"
              type="button"
              onClick={() => toggleTrackMenu("audio")}
              aria-label="Audio"
              aria-haspopup="menu"
              aria-expanded={openTrackMenu === "audio"}
              disabled={!tracks.audioTracks.length}
              title="Audio"
            >
              <AudioLines size={23} />
            </button>
            {openTrackMenu === "audio" ? (
              <div className="watch-track-popover" role="menu" aria-label="Audio">
                <button
                  className={selectedAudio === "" ? "active" : ""}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selectedAudio === ""}
                  onClick={() => changeAudioTrack("")}
                >
                  Default
                </button>
                {tracks.audioTracks.map((track, index) => (
                  <button
                    className={selectedAudio === String(index) ? "active" : ""}
                    key={`${track.index}-${index}`}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selectedAudio === String(index)}
                    onClick={() => changeAudioTrack(String(index))}
                  >
                    {track.label || track.language || `Audio ${index + 1}`}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="watch-track-menu">
            <button
              className="watch-control-button"
              type="button"
              onClick={() => toggleTrackMenu("playlist")}
              aria-label="Playlist"
              aria-haspopup="menu"
              aria-expanded={openTrackMenu === "playlist"}
              disabled={playbackContext?.type !== "tv" || !showData.episodes.length}
              title="Episodes"
            >
              <List size={23} />
            </button>
            {openTrackMenu === "playlist" ? (
              <div className="watch-track-popover watch-playlist-popover" role="menu" aria-label="Episodes">
                {showData.seasons.map((season) => (
                  <div key={season.season_number} className="watch-playlist-season">
                    <button
                      className={`watch-playlist-season-header ${playbackContext?.seasonNumber === season.season_number ? "watching" : ""}`}
                      type="button"
                      onClick={() => toggleSeason(season.season_number)}
                      aria-expanded={openSeasons[season.season_number]}
                    >
                      <span className="season-title">{season.title || `Season ${season.season_number}`}</span>
                    </button>
                    {openSeasons[season.season_number] ? (
                      <div className="watch-playlist-episodes">
                        {showData.episodes
                          .filter((ep) => ep.season_number === season.season_number)
                          .map((ep) => (
                            <button
                              key={ep.id}
                              className={`watch-playlist-episode ${Number(ep.file_id) === Number(fileId) ? "active" : ""}`}
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                playEpisode(ep);
                                setOpenTrackMenu(null);
                              }}
                            >
                              <span className="ep-num">E{ep.episode_number}</span>
                              <span className="ep-title">{ep.title || `Episode ${ep.episode_number}`}</span>
                              {ep.watched ? <div className="ep-watched-dot" title="Watched" /> : null}
                            </button>
                          ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          <button className="watch-control-button" type="button" onClick={togglePip} aria-label="Picture in Picture" title="Mini player">
            <PictureInPicture2 size={23} />
          </button>
          <button className="watch-control-button" type="button" onClick={toggleFullscreen} aria-label="Fullscreen">
            <Maximize size={23} />
          </button>
        </div>
      </div>
    </section>
  );
}
