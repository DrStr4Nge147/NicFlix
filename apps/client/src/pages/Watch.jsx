import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, AudioLines, Captions, List, Maximize, Pause, PictureInPicture2, Play, SkipBack, SkipForward, Volume2, VolumeX, X } from "lucide-react";
import { apiFetch } from "../lib/api.js";

function formatTime(seconds = 0) {
  if (!Number.isFinite(seconds)) return "0:00";
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${secs}` : `${minutes}:${secs}`;
}

export default function Watch() {
  const { fileId } = useParams();
  const navigate = useNavigate();
  const videoRef = useRef(null);
  const [tracks, setTracks] = useState({ audioTracks: [], subtitleTracks: [] });
  const [selectedAudio, setSelectedAudio] = useState("");
  const [selectedSubtitle, setSelectedSubtitle] = useState("off");
  const [openTrackMenu, setOpenTrackMenu] = useState(null);
  const [playbackContext, setPlaybackContext] = useState(null);
  const [openSeasons, setOpenSeasons] = useState({});
  const [showData, setShowData] = useState({ seasons: [], episodes: [] });
  const [episodeNav, setEpisodeNav] = useState({ previous: null, next: null });
  const [nextUp, setNextUp] = useState(null);
  const [countdown, setCountdown] = useState(null);
  const [autoPlayNext, setAutoPlayNext] = useState(() => localStorage.getItem("nicflix.autoplayNext") !== "false");
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [segments, setSegments] = useState([]);
  const [activeSegment, setActiveSegment] = useState(null);
  const [globalSettings, setGlobalSettings] = useState(null);

  const saveProgress = useCallback((watched = false) => {
    const video = videoRef.current;
    if (!video || Number.isNaN(video.duration)) return Promise.resolve();

    return apiFetch(`/progress/${fileId}`, {
      method: "POST",
      body: JSON.stringify({
        position: watched ? video.duration : video.currentTime,
        duration: video.duration,
        watched
      })
    }).catch(() => {});
  }, [fileId]);

  useEffect(() => {
    if (!isPlaying) {
      setControlsVisible(true);
      return undefined;
    }

    const timer = window.setTimeout(() => setControlsVisible(false), 3000);
    return () => window.clearTimeout(timer);
  }, [controlsVisible, isPlaying]);

  useEffect(() => {
    setNextUp(null);
    setCountdown(null);
    setPlaybackContext(null);
    setEpisodeNav({ previous: null, next: null });
    setSelectedAudio("");
    setSelectedSubtitle("off");
    setOpenTrackMenu(null);
    let cancelled = false;
    apiFetch(`/files/${fileId}/tracks`)
      .then((data) => {
        if (!cancelled) {
          setTracks(data);
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
        if (!cancelled) setTracks({ audioTracks: [], subtitleTracks: [] });
      });
    apiFetch(`/files/${fileId}/context`)
      .then(({ context }) => {
        if (!cancelled) setPlaybackContext(context);
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
          if (data.autoPlayNextEnabled === false) {
            setAutoPlayNext(false);
          }
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [fileId]);

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
    let timer;
    let restored = false;
    const video = videoRef.current;

    apiFetch(`/progress/${fileId}`).then(({ progress }) => {
      if (video && progress?.position > 0 && !restored) {
        video.currentTime = progress.position;
        restored = true;
      }
    });

    function save() {
      saveProgress();
    }

    function syncPlaybackState() {
      if (!video) return;
      setCurrentTime(video.currentTime || 0);
      setDuration(Number.isFinite(video.duration) ? video.duration : 0);
      setIsPlaying(!video.paused);
    }

    function syncVolumeState() {
      if (!video) return;
      setVolume(video.volume);
      setMuted(video.muted);
    }

    function handleEnded() {
      saveProgress(true);
      if (!episodeNav.next) return;
      setNextUp(episodeNav.next);
      setCountdown(autoPlayNext ? 8 : null);
    }

    timer = window.setInterval(save, 10000);
    video?.addEventListener("loadedmetadata", syncPlaybackState);
    video?.addEventListener("timeupdate", syncPlaybackState);
    video?.addEventListener("play", syncPlaybackState);
    video?.addEventListener("pause", syncPlaybackState);
    video?.addEventListener("volumechange", syncVolumeState);
    video?.addEventListener("pause", save);
    video?.addEventListener("ended", handleEnded);
    window.addEventListener("beforeunload", save);

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
      window.removeEventListener("beforeunload", save);
    };
  }, [autoPlayNext, episodeNav.next, fileId, saveProgress]);

  useEffect(() => {
    if (!segments.length) {
      setActiveSegment(null);
      return;
    }
    // Find the currently active segment with a small buffer for precision
    const segment = segments.find((s) => {
      const isOutro = ["outro", "credits"].includes(s.type);
      if (isOutro) {
        // Outros should appear as soon as the segment starts and stay until the end of the file
        return currentTime >= s.start - 1;
      }
      return currentTime >= s.start - 0.5 && currentTime < s.end - 0.2;
    });
    setActiveSegment(segment || null);
  }, [currentTime, segments]);

  function skipSegment() {
    if (activeSegment && videoRef.current) {
      if (["outro", "credits"].includes(activeSegment.type) && episodeNav.next) {
        playNext();
      } else {
        // Seek to the end of segment, or end of video if it's an outro
        const isOutro = ["outro", "credits"].includes(activeSegment.type);
        videoRef.current.currentTime = isOutro ? videoRef.current.duration : activeSegment.end;
        setActiveSegment(null);
      }
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
      navigate(`/watch/${nextUp.file_id}`, { replace: true });
      return undefined;
    }

    const timer = window.setTimeout(() => setCountdown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [countdown, navigate, nextUp]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;

    const timer = window.setTimeout(() => {
      Array.from(video.textTracks || []).forEach((track, index) => {
        track.mode = String(index) === selectedSubtitle ? "showing" : "disabled";
      });
    }, 250);

    return () => window.clearTimeout(timer);
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
          video.currentTime = Math.max(0, video.currentTime - 10);
          showControls();
          break;
        case "ArrowRight":
          video.currentTime = Math.min(video.duration, video.currentTime + 10);
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
  }, [playbackContext]);

  function changeAudioTrack(value) {
    setSelectedAudio(value);
    setOpenTrackMenu(null);
    const video = videoRef.current;
    const audioTracks = video?.audioTracks;
    if (!audioTracks?.length) return;

    Array.from(audioTracks).forEach((track, index) => {
      track.enabled = value === "" ? index === 0 : String(index) === value;
    });
  }

  function changeSubtitleTrack(value) {
    setSelectedSubtitle(value);
    setOpenTrackMenu(null);
    const video = videoRef.current;
    Array.from(video?.textTracks || []).forEach((track, index) => {
      track.mode = String(index) === value ? "showing" : "disabled";
    });
  }

  function toggleTrackMenu(menu) {
    setOpenTrackMenu((current) => (current === menu ? null : menu));
  }

  function toggleAutoPlayNext(event) {
    const enabled = event.target.checked;
    setAutoPlayNext(enabled);
    localStorage.setItem("nicflix.autoplayNext", String(enabled));
    if (nextUp) setCountdown(enabled ? 8 : null);
  }

  function playNext() {
    if (nextUp) navigate(`/watch/${nextUp.file_id}`, { replace: true });
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

  function seek(event) {
    const video = videoRef.current;
    if (!video) return;
    const nextTime = Number(event.target.value);
    video.currentTime = nextTime;
    setCurrentTime(nextTime);
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

  function toggleFullscreen() {
    const container = videoRef.current?.closest(".watch-page");
    if (!container) return;
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
    } else {
      container.requestFullscreen?.();
    }
  }

  function showControls() {
    setControlsVisible(true);
  }

  return (
    <section
      className={`watch-page ${controlsVisible || !isPlaying ? "controls-visible" : "controls-hidden"}`}
      onMouseMove={showControls}
      onTouchStart={showControls}
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

      <video ref={videoRef} src={`/api/stream/${fileId}`} autoPlay playsInline onClick={togglePlayback}>
        {tracks.subtitleTracks.map((track, index) => (
          <track
            key={`${track.src}-${index}`}
            kind={track.kind || "subtitles"}
            src={track.src}
            srcLang={track.language || "en"}
            label={track.label || `Subtitles ${index + 1}`}
          />
        ))}
      </video>

      {activeSegment ? (
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

      <div className="watch-controls">
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
          <span className="watch-time">{formatTime(currentTime)} / {formatTime(duration)}</span>
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
                      {season.title || `Season ${season.season_number}`}
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
      {nextUp ? (
        <div className="next-up-panel">
          <button className="next-up-close" type="button" onClick={() => { setNextUp(null); setCountdown(null); }} aria-label="Dismiss next episode">
            <X size={17} />
          </button>
          <span className="eyebrow">Next Episode</span>
          <h2>{nextUp.episode_title || `Episode ${nextUp.episode_number}`}</h2>
          <p>Season {nextUp.season_number}, Episode {nextUp.episode_number}</p>
          <label className="next-up-autoplay">
            <input type="checkbox" checked={autoPlayNext} onChange={toggleAutoPlayNext} />
            Auto-play next episode
          </label>
          <div className="next-up-actions">
            <button className="primary-button" type="button" onClick={playNext}>
              <Play size={17} fill="currentColor" />
              Play now
            </button>
            {countdown !== null ? <span>Auto-playing in {countdown}s</span> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
