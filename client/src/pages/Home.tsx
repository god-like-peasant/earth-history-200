import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Video = {
  sequence: number;
  era: string;
  age: string;
  title: string;
  creator: string;
  youtube_id: string;
  direct_url: string;
  duration: string;
  duration_seconds_source_listed: number;
  role: string;
};
type Manifest = { audit?: { direct_link_entries?: number }; videos: Video[] };
type SavedProgress = { sequence: number; completed: number[]; started: boolean };
type PlayerEvent = { data: number; target: YouTubePlayer };
type PlayerConfig = {
  videoId: string;
  playerVars?: Record<string, string | number>;
  events?: {
    onReady?: (event: PlayerEvent) => void;
    onStateChange?: (event: PlayerEvent) => void;
    onError?: (event: PlayerEvent) => void;
  };
};
type YouTubePlayer = {
  loadVideoById: (videoId: string) => void;
  playVideo: () => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  destroy: () => void;
};
declare global {
  interface Window {
    YT?: {
      Player: new (element: HTMLElement, config: PlayerConfig) => YouTubePlayer;
      PlayerState: { ENDED: number; PLAYING: number; PAUSED: number; CUED: number };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

const STORAGE_KEY = "earth-history-200-progress-v1";
const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const value = Math.floor(seconds);
  const h = Math.floor(value / 3600);
  const m = Math.floor((value % 3600) / 60);
  const s = value % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
};
const readSaved = (): SavedProgress | null => {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value) as SavedProgress;
    if (!Number.isInteger(parsed.sequence) || !Array.isArray(parsed.completed)) return null;
    return parsed;
  } catch {
    return null;
  }
};
const ensureYouTubeApi = () => new Promise<void>((resolve) => {
  if (window.YT?.Player) return resolve();
  const previous = window.onYouTubeIframeAPIReady;
  window.onYouTubeIframeAPIReady = () => {
    previous?.();
    resolve();
  };
  if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    document.head.appendChild(script);
  }
});

function BrandMark() {
  return <svg className="brand-mark" viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="19.5" fill="none" stroke="currentColor" strokeWidth="1.2"/><path d="M4 22h36M22 2.5c5.8 5.3 8.7 11.8 8.7 19.5S27.8 36.2 22 41.5M22 2.5C16.2 7.8 13.3 14.3 13.3 22S16.2 36.2 22 41.5" fill="none" stroke="currentColor" strokeWidth=".9" opacity=".65"/><path d="M8 11.5c4.2 2.5 8.8 3.8 14 3.8 5.3 0 9.9-1.3 14-3.8M8 32.5c4.2-2.5 8.8-3.8 14-3.8 5.3 0 9.9 1.3 14 3.8" fill="none" stroke="currentColor" strokeWidth=".8" opacity=".45"/></svg>;
}

export default function Home() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [loadError, setLoadError] = useState("");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [completed, setCompleted] = useState<number[]>([]);
  const [started, setStarted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [playerInitialized, setPlayerInitialized] = useState(false);
  const [playerError, setPlayerError] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [actualDuration, setActualDuration] = useState(0);
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YouTubePlayer | null>(null);
  const advanceRef = useRef<(completeCurrent: boolean) => void>(() => undefined);
  const latestIndex = useRef(0);
  const latestVideos = useRef<Video[]>([]);

  useEffect(() => {
    let alive = true;
    fetch(`${import.meta.env.BASE_URL}data/videos.json`, { cache: "no-cache" })
      .then((response) => {
        if (!response.ok) throw new Error(`Manifest returned ${response.status}`);
        return response.json() as Promise<Manifest>;
      })
      .then((data) => {
        if (!Array.isArray(data.videos)) throw new Error("The manifest must contain a videos array.");
        if (!alive) return;
        const sorted = [...data.videos].sort((a, b) => a.sequence - b.sequence);
        setManifest({ ...data, videos: sorted });
        const saved = readSaved();
        setCurrentIndex(Math.max(0, Math.min(sorted.length - 1, (saved?.sequence ?? 1) - 1)));
        setCompleted(saved?.completed ?? []);
        setStarted(Boolean(saved?.started && sorted.length));
      })
      .catch((error: Error) => alive && setLoadError(error.message));
    return () => { alive = false; };
  }, []);

  const videos = manifest?.videos ?? [];
  const current = videos[currentIndex];
  const next = videos[currentIndex + 1];
  latestIndex.current = currentIndex;
  latestVideos.current = videos;
  const totalSeconds = useMemo(() => videos.reduce((sum, video) => sum + (Number(video.duration_seconds_source_listed) || 0), 0), [videos]);
  const journeyProgress = videos.length ? Math.round((completed.length / videos.length) * 100) : 0;
  const currentProgress = current ? Math.min(100, Math.round((seconds / (actualDuration || current.duration_seconds_source_listed || 1)) * 100)) : 0;

  const saveProgress = useCallback((sequence: number, done: number[], isStarted: boolean) => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ sequence, completed: done, started: isStarted } satisfies SavedProgress)); } catch { /* Storage can be disabled; playback remains available. */ }
  }, []);

  const loadVideo = useCallback((index: number) => {
    const target = videos[index];
    if (!target) return;
    setCurrentIndex(index);
    setSeconds(0);
    setActualDuration(0);
    setPlayerError("");
    saveProgress(target.sequence, completed, true);
    if (playerRef.current) {
      playerRef.current.loadVideoById(target.youtube_id);
      playerRef.current.playVideo();
    }
  }, [videos, completed, saveProgress]);

  const advance = useCallback((completeCurrent: boolean) => {
    const activeVideos = latestVideos.current;
    const activeIndex = latestIndex.current;
    const done = completeCurrent && activeVideos[activeIndex]
      ? Array.from(new Set([...completed, activeVideos[activeIndex].sequence]))
      : completed;
    if (completeCurrent) setCompleted(done);
    const nextIndex = activeIndex + 1;
    setPlaying(false);
    setPlayerError("");
    if (nextIndex >= activeVideos.length) {
      saveProgress(activeVideos[activeIndex]?.sequence ?? 1, done, false);
      return;
    }
    setCurrentIndex(nextIndex);
    setSeconds(0);
    setActualDuration(0);
    saveProgress(activeVideos[nextIndex].sequence, done, true);
    if (playerRef.current) {
      try {
        playerRef.current.loadVideoById(activeVideos[nextIndex].youtube_id);
        playerRef.current.playVideo();
      } catch {
        setPlayerError("The next video could not start automatically. Use the player controls or continue manually.");
      }
    }
  }, [completed, saveProgress]);
  advanceRef.current = advance;

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      try {
        const player = playerRef.current;
        if (!player) return;
        setSeconds(player.getCurrentTime() || 0);
        setActualDuration(player.getDuration() || 0);
      } catch { /* Player may still be initializing. */ }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [playing]);

  const startAt = async (index: number, reset = false) => {
    const startIndex = reset ? 0 : index;
    const done = reset ? [] : completed;
    if (reset) setCompleted([]);
    setCurrentIndex(startIndex);
    setStarted(true);
    setPlayerError("");
    setPlaying(false);
    saveProgress(videos[startIndex]?.sequence ?? 1, done, true);
    await ensureYouTubeApi();
    const target = videos[startIndex];
    if (!target || !hostRef.current || !window.YT) return;
    if (playerRef.current) {
      playerRef.current.loadVideoById(target.youtube_id);
      playerRef.current.playVideo();
      setPlayerInitialized(true);
      return;
    }
    playerRef.current = new window.YT.Player(hostRef.current, {
      videoId: target.youtube_id,
      playerVars: { autoplay: 1, playsinline: 1, rel: 0, modestbranding: 1, enablejsapi: 1 },
      events: {
        onReady: (event) => { event.target.playVideo(); setPlayerInitialized(true); },
        onStateChange: (event) => {
          if (event.data === window.YT?.PlayerState.PLAYING) { setPlaying(true); setPlayerError(""); }
          if (event.data === window.YT?.PlayerState.PAUSED || event.data === window.YT?.PlayerState.CUED) setPlaying(false);
          if (event.data === window.YT?.PlayerState.ENDED) advanceRef.current(true);
        },
        onError: (event) => {
          setPlaying(false);
          setPlayerInitialized(true);
          const reasons: Record<number, string> = { 2: "This video's ID could not be recognized.", 5: "The video could not be played in the embedded player.", 100: "This video is unavailable or has been removed.", 101: "The creator does not allow this video to be embedded.", 150: "The creator does not allow this video to be embedded." };
          setPlayerError(reasons[event.data] ?? "This video could not be loaded.");
        },
      },
    });
  };

  const resetJourney = () => {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* No-op */ }
    setCurrentIndex(0); setCompleted([]); setStarted(false); setPlaying(false); setPlayerInitialized(false); setPlayerError(""); setSeconds(0);
    if (playerRef.current) { playerRef.current.destroy(); playerRef.current = null; }
  };
  useEffect(() => () => { playerRef.current?.destroy(); }, []);

  const periodLabels = ["HADEAN", "ARCHEAN", "PROTEROZOIC", "EDIACARAN", "CAMBRIAN", "ORDOVICIAN", "SILURIAN", "DEVONIAN", "CARBONIFEROUS", "PERMIAN", "TRIASSIC", "JURASSIC", "CRETACEOUS", "PALEOGENE", "NEOGENE", "QUATERNARY", "PLEISTOCENE", "HOLOCENE", "PRESENT"];
  const displayRole = (role: string) => role === "chronological core" ? "CORE" : role === "deep dive" ? "DEEP DIVE" : role.toUpperCase();

  return (
    <div className="site-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Earth History home"><BrandMark /><span>EARTH HISTORY <b>200</b></span></a>
        <div className="header-note"><span className="live-dot" /> A FREE JOURNEY THROUGH DEEP TIME</div>
        <a className="text-link" href="#about">ABOUT THE PROJECT <span aria-hidden="true">↗</span></a>
      </header>

      <main id="top">
        <section className="hero container">
          <div className="hero-copy">
            <p className="eyebrow"><span className="eyebrow-line" /> A PLANET-SCALE WATCHLIST</p>
            <h1>4.5 billion years.<br /><em>One unfolding story.</em></h1>
            <p className="hero-description">Travel forward through Earth’s deep past, one verified film at a time. Pick up where you left off whenever you’re ready.</p>
            <div className="hero-actions">
              {!started && videos.length > 0 && <button className="button button-primary" onClick={() => void startAt(currentIndex)}>{readSaved()?.started || completed.length ? "RESUME JOURNEY" : "START JOURNEY"}<span aria-hidden="true">→</span></button>}
              {started && current && <button className="button button-primary" onClick={() => { if (playerRef.current) playerRef.current.playVideo(); else void startAt(currentIndex); }}>RESUME WATCHING <span aria-hidden="true">→</span></button>}
              {videos.length > 0 && <button className="button button-quiet" onClick={() => { resetJourney(); void startAt(0, true); }}>START OVER</button>}
            </div>
            <div className="hero-footnote"><span className="footnote-star">✳</span><span>Every video stays on YouTube.<br />Your place is saved only on this device.</span></div>
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="orbit orbit-three" />
            <div className="earth-core"><span className="earth-line line-a" /><span className="earth-line line-b" /><span className="earth-line line-c" /><span className="earth-center" /></div>
            <span className="orbital-label label-left">4.56 GA</span><span className="orbital-label label-right">NOW</span>
            <span className="art-caption">A RECORD IN MOTION <span>·</span> 01—∞</span>
          </div>
        </section>

        <section className="journey-strip" aria-label="Journey progress">
          <div className="container strip-inner">
            <div className="strip-label"><span className="strip-mark">01</span><span>YOUR JOURNEY</span></div>
            <div className="strip-metrics"><div><strong>{videos.length}</strong><span>VERIFIED VIDEOS</span></div><div className="metric-divider"/><div><strong>{totalSeconds ? <>{Math.floor(totalSeconds / 3600)}<small>h</small> {Math.floor((totalSeconds % 3600) / 60)}<small>m</small></> : "—"}</strong><span>LISTED RUNTIME</span></div><div className="metric-divider"/><div><strong>{journeyProgress}<small>%</small></strong><span>COMPLETED</span></div></div>
            <div className="strip-progress"><div className="progress-track"><span style={{ width: `${journeyProgress}%` }} /></div><small>{completed.length} / {videos.length} films</small></div>
          </div>
        </section>

        <section className="watch-section container" id="watch">
          <div className="section-heading"><div><p className="eyebrow"><span className="eyebrow-line" /> THE SEQUENCE</p><h2>{videos.length ? "Keep moving forward." : "The next chapter is being verified."}</h2></div><div className="sequence-note"><span className="sequence-dot" /> MANIFEST ORDER <span className="note-arrow">→</span> PRESENT</div></div>
          {loadError ? <div className="notice notice-error"><strong>Couldn’t load the video manifest.</strong><span>{loadError}</span></div> : videos.length === 0 ? <div className="notice"><strong>No verified films are available yet.</strong><span>Add individual, verified direct YouTube records to <code>client/public/data/videos.json</code>. Nothing has been fabricated to fill the curriculum.</span></div> : <>
            <div className="watch-layout">
              <article className="player-column">
                <div className="player-frame">
                  <div className={`player-surface ${playerInitialized ? "is-active" : ""}`}>
                    <div className="player-host" ref={hostRef} aria-label="YouTube video player" />
                    {!started && <div className="player-placeholder"><div className="placeholder-rings"><span /><span /><span /><i>EH</i></div><span className="placeholder-overline">A CHRONICLE OF OUR PLANET</span><span className="placeholder-title">From molten beginnings<br />to the world we know.</span><button className="play-button" aria-label="Start the journey" onClick={() => void startAt(currentIndex)}><span>▶</span></button><span className="placeholder-caption">PRESS PLAY TO BEGIN</span></div>}
                  </div>
                  <div className="player-status"><span className={playing ? "status-pulse active" : "status-pulse"} />{playerError ? "PLAYBACK INTERRUPTED" : playing ? "NOW PLAYING" : started ? "READY WHEN YOU ARE" : "SEQUENCE PLAYER"}<span className="status-right">YOUTUBE EMBED <span>↗</span></span></div>
                </div>
                {playerError && <div className="error-banner" role="alert"><span className="error-icon">!</span><div><strong>Video unavailable</strong><p>{playerError} The sequence is safe; you can move on to the next verified film.</p></div><button className="button button-small" disabled={!next} onClick={() => advanceRef.current(false)}>SKIP TO NEXT <span>→</span></button></div>}
                <div className="current-card">
                  <div className="current-top"><div className="current-label">NOW AT <span>{current ? String(current.sequence).padStart(2, "0") : "—"} / {String(videos.length).padStart(2, "0")}</span></div><span className="role-tag">{current ? displayRole(current.role) : "VERIFIED"}</span></div>
                  <div className="period-title"><span className="period-icon">◉</span><div><h3>{current?.era ?? "Waiting at the beginning"}</h3><p>{current?.age ?? "The journey begins with the first verified record."}</p></div></div>
                  <h4 className="video-title">{current?.title ?? "Your chronological playlist"}</h4>
                  <div className="byline">FILM BY <a href={current?.direct_url ?? "#"} target="_blank" rel="noreferrer">{current?.creator ?? "Verified creators"}<span> ↗</span></a><span className="byline-separator">·</span><span>{current?.duration ?? "—"}</span></div>
                  <div className="video-progress"><div className="video-time-row"><span>THIS FILM</span><span>{formatTime(seconds)} <i>/</i> {formatTime(actualDuration || current?.duration_seconds_source_listed || 0)}</span></div><div className="progress-track"><span style={{ width: `${currentProgress}%` }} /></div></div>
                  <div className="player-actions"><button className="button button-next" disabled={!next} onClick={() => advanceRef.current(false)}>{playerError ? "CONTINUE TO NEXT" : "NEXT VIDEO"}<span>→</span></button><p>{next ? `Up next: ${next.title}` : "You’ve reached the end of the verified sequence."}</p></div>
                </div>
              </article>

              <aside className="next-column">
                <div className="next-card"><div className="next-card-head"><span>UP NEXT</span><span className="next-number">{next ? String(next.sequence).padStart(2, "0") : "END"}</span></div>
                  {next ? <><p className="next-era">{next.era}<span> / {next.age}</span></p><h3>{next.title}</h3><p className="next-creator">{next.creator} <span>·</span> {next.duration}</p><div className="next-divider" /><div className="auto-note"><span className="auto-icon">↗</span><span>Auto-advance is on.<br /><b>Tap NEXT VIDEO if playback stalls.</b></span></div></> : <div className="end-card"><span>✳</span><h3>Journey complete.</h3><p>You’ve reached the end of the verified starting dataset.</p></div>}
                </div>
                <div className="timeline-card"><div className="timeline-head"><span>DEEP TIME</span><span>← EARLIER <i>·</i> LATER →</span></div><div className="timeline-rail"><div className="timeline-line"/><div className="timeline-ticks">{videos.map((video, index) => <span key={video.sequence} className={`${index === currentIndex ? "current" : ""} ${completed.includes(video.sequence) ? "done" : ""}`} style={{ left: `${videos.length > 1 ? (index / (videos.length - 1)) * 100 : 0}%` }} title={`${video.sequence}. ${video.era}: ${video.title}`} />)}</div></div><div className="timeline-labels"><span>4.56 Ga</span><span>{current?.era ?? "Timeline"}</span><span>PRESENT</span></div><div className="timeline-current"><span className="timeline-current-dot"/><span>YOU ARE HERE</span><strong>{current ? String(current.sequence).padStart(2, "0") : "—"}</strong><span className="timeline-dash"/> <span>{current?.era ?? "—"}</span></div></div>
                <div className="queue-note"><span className="queue-index">{String(currentIndex + 1).padStart(2, "0")}</span><span>Current position in the supplied manifest. Added films will follow their verified sequence numbers.</span></div>
              </aside>
            </div>

            <div className="long-timeline" aria-label="Geological timeline context"><div className="long-timeline-head"><span>THE SCALE OF DEEP TIME</span><span>REFERENCE · NOT A VIDEO LIST</span></div><div className="period-track"><div className="period-gradient"/>{periodLabels.map((label, index) => <div className="period-stop" key={label} style={{ left: `${(index / (periodLabels.length - 1)) * 100}%` }}><span className="period-tick"/><span className="period-name">{label}</span></div>)}</div><p className="track-caption">Period labels provide orientation only. Playback follows the verified manifest sequence above, including its broad and supplementary records.</p></div>
          </>}
        </section>

        <section className="about-section" id="about"><div className="container about-inner"><div><p className="eyebrow"><span className="eyebrow-line"/> BUILT TO GROW, GROUNDED IN SOURCES</p><h2>One planet.<br /><em>Many chapters still to verify.</em></h2></div><div className="about-copy"><p>Earth History 200 is an evolving educational watchlist—not yet a 200-hour curriculum. The starting dataset contains <b>{videos.length} verified individual videos</b>, with {Math.floor(totalSeconds / 3600)} hours {Math.floor((totalSeconds % 3600) / 60)} minutes of listed runtime.</p><p>Records are kept in one transparent JSON manifest. Progress lives in this browser only. Videos stream directly from YouTube; they are never downloaded or re-hosted here.</p><a href={`${import.meta.env.BASE_URL}data/videos.json`} target="_blank" rel="noreferrer">VIEW THE SOURCE MANIFEST <span>↗</span></a></div></div></section>
      </main>
      <footer className="footer"><div className="container footer-inner"><a className="brand footer-brand" href="#top"><BrandMark/><span>EARTH HISTORY <b>200</b></span></a><span>A FREE, OPEN-ENDED JOURNEY THROUGH DEEP TIME.</span><a href="#top">BACK TO THE BEGINNING ↑</a></div></footer>
    </div>
  );
}
