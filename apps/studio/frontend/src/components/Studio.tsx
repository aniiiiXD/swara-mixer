"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StudioEngine } from "@/lib/engine";
import {
  at,
  comparison,
  hz,
  LiveFilter,
  name,
  singerContour,
  smooth,
} from "@/lib/pitch";
import {
  api,
  audioUrl,
  defaults,
  patch,
  type Point,
  type Project,
  type Settings,
  type Track,
} from "@/lib/types";
import PitchCanvas from "./PitchCanvas";
import Waveform from "./Waveform";

const time = (n: number) =>
  `${Math.floor(n / 60)
    .toString()
    .padStart(2, "0")}:${(n % 60).toFixed(2).padStart(5, "0")}`;
type LibrarySong = { jobId: string; title: string };
function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  unit = "",
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (n: number) => void;
}) {
  return (
    <label className="parameter">
      <span>
        {label}
        <output>
          {Number(value.toFixed(2))}
          {unit}
        </output>
      </span>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
export default function Studio() {
  const engine = useRef<StudioEngine | null>(null),
    projectRef = useRef<Project | null>(null),
    settingsRef = useRef<Settings>(defaults);
  const [project, setProject] = useState<Project | null>(null),
    [projects, setProjects] = useState<Project[]>([]),
    [library, setLibrary] = useState<LibrarySong[]>([]);
  const [settings, setSettings] = useState<Settings>(defaults),
    [curves, setCurves] = useState<Record<string, Point[]>>({}),
    [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [playing, setPlaying] = useState(false),
    [position, setPosition] = useState(0),
    [volume, setVolume] = useState(0.7);
  const [micOn, setMicOn] = useState(false),
    [micBusy, setMicBusy] = useState(false),
    [device, setDevice] = useState(""),
    [devices, setDevices] = useState<MediaDeviceInfo[]>([]),
    [meter, setMeter] = useState<Point | null>(null);
  const [recording, setRecording] = useState(false),
    [draft, setDraft] = useState(""),
    [saved, setSaved] = useState("Saved on this Mac"),
    [inspector, setInspector] = useState<"reference" | "microphone" | "take">(
      "reference",
    );
  const [showLibrary, setShowLibrary] = useState(false);
  const live = useRef<Point[]>([]),
    latest = useRef<Point | null>(null),
    filter = useRef(new LiveFilter()),
    record = useRef<{
      start: number;
      epoch: number;
      raw: Point[];
      name: string;
    } | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    loadVersion = useRef(0),
    onEnd = useRef<() => void>(() => {}),
    fileInput = useRef<HTMLInputElement>(null);
  const rawPending = useRef<{
    blob: Blob;
    info: { start: number; epoch: number; raw: Point[]; name: string };
  } | null>(null);
  const getTime = useCallback(() => engine.current?.time() ?? 0, []);
  useEffect(() => {
    projectRef.current = project;
  }, [project]);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  const refreshList = useCallback(async () => {
    const [ps, ls] = await Promise.all([
      api<Project[]>("/projects"),
      api<LibrarySong[]>("/library"),
    ]);
    setProjects(ps);
    setLibrary(ls);
    return ps;
  }, []);
  const selectProject = useCallback((p: Project) => {
    loadVersion.current++;
    engine.current?.pause();
    setPlaying(false);
    setPosition(0);
    if (engine.current) engine.current.position = 0;
    setProject(p);
    projectRef.current = p;
    setCurves({});
    setSelected("");
    setDraft("");
    setSettings({ ...defaults, ...p.settings });
    live.current = [];
    latest.current = null;
    setError("");
    setShowLibrary(false);
    history.replaceState(null, "", `/?project=${p.id}`);
  }, []);
  useEffect(() => {
    const e = new StudioEngine();
    engine.current = e;
    let lastMeter = 0;
    e.onPitch = (p) => {
      const s = settingsRef.current;
      const processed = filter.current.process(p, s);
      latest.current = processed;
      const r = record.current;
      if (r && p.t >= r.epoch) {
        const t = p.t - r.epoch;
        r.raw.push({ ...p, t });
        live.current.push({ ...processed, t: r.start + t - s.latency / 1000 });
      }
      if (performance.now() - lastMeter > 90) {
        lastMeter = performance.now();
        setMeter({ ...processed, rms: (p.rms ?? 0) * s.gain });
      }
    };
    e.onEnded = () => onEnd.current();
    e.onMicEnded = () => {
      setMicOn(false);
      setMeter(null);
      latest.current = null;
      setError("Microphone disconnected. Your captured audio is being saved.");
      onEnd.current();
    };
    const timer = setInterval(() => {
      setPosition(e.time());
      setPlaying(e.playing);
    }, 70);
    let disposed = false;
    // Initial data arrives asynchronously from the local server.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshList()
      .then((ps) => {
        if (disposed) return;
        const id = new URLSearchParams(location.search).get("project");
        const p = ps.find((p) => p.id === id);
        if (p) selectProject(p);
      })
      .catch((e) => setError(`Studio server: ${e.message}`));
    const discover = () =>
      navigator.mediaDevices
        ?.enumerateDevices()
        .then((ds) => {
          if (!disposed) setDevices(ds.filter((d) => d.kind === "audioinput"));
        })
        .catch(() => {});
    void discover();
    navigator.mediaDevices?.addEventListener("devicechange", discover);
    return () => {
      disposed = true;
      clearInterval(timer);
      navigator.mediaDevices?.removeEventListener("devicechange", discover);
      void e.close();
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [refreshList, selectProject]);
  const pid = project?.id,
    trackKey = project?.tracks.map((t) => t.id).join(","),
    analysisKey = project?.tracks.map((t) => `${t.id}:${t.analysis}`).join(",");
  useEffect(() => {
    if (!pid) return;
    let cancelled = false;
    const timer = setInterval(() => {
      void api<Project>(`/projects/${pid}`)
        .then((p) => {
          if (!cancelled)
            setProject((old) =>
              JSON.stringify(old) === JSON.stringify(p) ? old : p,
            );
        })
        .catch((e) => {
          if (!cancelled) setError(e.message);
        });
    }, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pid]);
  useEffect(() => {
    const p = projectRef.current,
      e = engine.current;
    if (!p || !e || p.id !== pid) return;
    let cancelled = false;
    setLoading(true);
    const version = loadVersion.current;
    void e
      .load(p.id, p.tracks)
      .then(() => {
        if (cancelled || version !== loadVersion.current) return;
        setLoading(false);
        if (e.playing) void e.seek(e.time());
      })
      .catch((error) => {
        if (!cancelled) {
          setLoading(false);
          setError(error.message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [pid, trackKey]);
  useEffect(() => {
    if (project) engine.current?.mix(project.tracks);
  }, [project]);
  useEffect(() => {
    if (!pid) return;
    let cancelled = false;
    const p = projectRef.current;
    if (!p) return;
    for (const t of p.tracks.filter(
      (t) => t.kind === "vocals" || t.kind === "take",
    ))
      void api<{ contour: Point[] }>(`/projects/${pid}/tracks/${t.id}/pitch`)
        .then((r) => {
          if (!cancelled) setCurves((old) => ({ ...old, [t.id]: r.contour }));
        })
        .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [pid, analysisKey]);
  const updateSetting = <K extends keyof Settings>(
    key: K,
    value: Settings[K],
  ) => {
    const next = { ...settingsRef.current, [key]: value };
    settingsRef.current = next;
    setSettings(next);
    const p = projectRef.current;
    if (!p) return;
    setSaved("Saving…");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void patch(`/projects/${p.id}/settings`, next)
        .then(() => setSaved("Saved on this Mac"))
        .catch((e) => {
          setSaved("Save failed");
          setError(e.message);
        });
    }, 250);
  };
  const changeTrack = (t: Track, change: Partial<Track>) => {
    if (!project) return;
    const next = {
      ...project,
      tracks: project.tracks.map((x) =>
        x.id === t.id ? { ...x, ...change } : x,
      ),
    };
    setProject(next);
    projectRef.current = next;
    engine.current?.mix(next.tracks);
    setSaved("Saving…");
    void patch(`/projects/${project.id}/tracks/${t.id}`, change)
      .then(() => setSaved("Saved on this Mac"))
      .catch((e) => {
        setSaved("Save failed");
        setError(e.message);
      });
  };
  const openProject = async (id: string) => {
    if (recording || busy) return;
    if (rawPending.current) {
      setError("Save the pending recording before opening another session.");
      return;
    }
    try {
      selectProject(await api<Project>(`/projects/${id}`));
    } catch (e) {
      setError(String(e));
    }
  };
  const importSong = async (jobId: string) => {
    if (rawPending.current) {
      setError("Save the pending recording first.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const p = await api<Project>("/projects/library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      selectProject(p);
      await refreshList();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const upload = async (file: File) => {
    if (recording || busy) return;
    if (rawPending.current) {
      setError("Save the pending recording before uploading another song.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      selectProject(
        await api<Project>("/projects/upload", { method: "POST", body }),
      );
      await refreshList();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const enableMic = async () => {
    const e = engine.current;
    if (!e) return;
    setMicBusy(true);
    setError("");
    try {
      await e.enableMic(device);
      setMicOn(true);
      filter.current = new LiveFilter();
      setDevices(
        (await navigator.mediaDevices.enumerateDevices()).filter(
          (d) => d.kind === "audioinput",
        ),
      );
    } catch (error) {
      setError(
        `Microphone: ${String(error)}. Check browser permission and your input device.`,
      );
      setMicOn(false);
    } finally {
      setMicBusy(false);
    }
  };
  const toggleMic = async () => {
    if (recording) return;
    if (micOn) {
      await engine.current?.disableMic();
      setMicOn(false);
      setMeter(null);
      latest.current = null;
    } else await enableMic();
  };
  const seek = useCallback((t: number) => {
    if (record.current) return;
    void engine.current?.seek(t).catch((e) => setError(e.message));
    setPosition(t);
    live.current = [];
  }, []);
  const saveRecording = async () => {
    const pending = rawPending.current,
      p = projectRef.current;
    if (!pending || !p) return;
    setBusy(true);
    setSaved("Saving recording…");
    try {
      const body = new FormData();
      body.append("file", pending.blob, "take.wav");
      body.append("start", String(pending.info.start));
      body.append("name", pending.info.name);
      body.append("raw", JSON.stringify(pending.info.raw));
      const next = await api<Project>(`/projects/${p.id}/takes`, {
        method: "POST",
        body,
      });
      const t = next.tracks.at(-1)!;
      setProject(next);
      projectRef.current = next;
      setCurves((old) => ({ ...old, [t.id]: pending.info.raw }));
      setSelected(t.id);
      setDraft("");
      setInspector("take");
      rawPending.current = null;
      setSaved("Saved on this Mac");
      await refreshList();
    } catch (error) {
      setError(
        `Recording is still held here. Retry saving before leaving this page. ${String(error)}`,
      );
      setSaved("Recording needs saving");
    } finally {
      setBusy(false);
    }
  };
  const stopRecording = async () => {
    const e = engine.current,
      info = record.current;
    if (!e || !info) return;
    record.current = null;
    setRecording(false);
    e.pause();
    setPlaying(false);
    setBusy(true);
    try {
      const blob = await e.stopRecording();
      rawPending.current = { blob, info };
      await saveRecording();
    } catch (error) {
      setError(`Could not finish recording: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  };
  const startRecording = async () => {
    const e = engine.current,
      p = projectRef.current;
    if (!e || !p || loading || busy || p.status !== "ready") return;
    setError("");
    setMicBusy(true);
    try {
      if (!micOn) {
        await e.enableMic(device);
        setMicOn(true);
        setDevices(
          (await navigator.mediaDevices.enumerateDevices()).filter(
            (d) => d.kind === "audioinput",
          ),
        );
      }
      const start = e.time() >= p.duration - 0.05 ? 0 : e.time();
      const takeName =
        draft ||
        `My vocals ${p.tracks.filter((t) => t.kind === "take").length + 1}`;
      live.current = [];
      filter.current = new LiveFilter();
      const epoch = await e.record(start);
      record.current = { start, epoch, raw: [], name: takeName };
      setDraft(takeName);
      setRecording(true);
      setPlaying(true);
      setInspector("microphone");
    } catch (error) {
      setError(`Recording: ${String(error)}`);
    } finally {
      setMicBusy(false);
    }
  };
  const playPause = useCallback(async () => {
    const e = engine.current;
    if (!e || loading || !projectRef.current) return;
    if (record.current) {
      onEnd.current();
      return;
    }
    try {
      if (e.playing) e.pause();
      else await e.play(e.position >= e.duration - 0.03 ? 0 : e.position);
      setPlaying(e.playing);
    } catch (error) {
      setError(String(error));
    }
  }, [loading]);
  useEffect(() => {
    onEnd.current = () => {
      if (record.current) void stopRecording();
      else setPlaying(false);
    };
  });
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLElement &&
        e.target.closest("input,select,textarea,button,a")
      )
        return;
      if (e.code === "Space") {
        e.preventDefault();
        void playPause();
      }
      if (e.code === "ArrowLeft") {
        e.preventDefault();
        seek(getTime() - 5);
      }
      if (e.code === "ArrowRight") {
        e.preventDefault();
        seek(getTime() + 5);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [playPause, seek, getTime]);
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (record.current || rawPending.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, []);
  const vocal = project?.tracks.find((t) => t.kind === "vocals");
  const selectedTrack =
    project?.tracks.find((t) => t.id === selected && t.kind === "take") ??
    project?.tracks.filter((t) => t.kind === "take").at(-1);
  const rawReference = useMemo(
    () => (vocal ? (curves[vocal.id] ?? []) : []),
    [vocal, curves],
  );
  const rawTake = useMemo(
    () => (selectedTrack ? (curves[selectedTrack.id] ?? []) : []),
    [selectedTrack, curves],
  );
  const reference = useMemo(
    () => singerContour(rawReference, settings),
    [rawReference, settings],
  );
  const take = useMemo(
    () => smooth(rawTake, settings.takeSmooth, 0.15),
    [rawTake, settings.takeSmooth],
  );
  const offset = (selectedTrack?.start ?? 0) - settings.latency / 1000;
  const stats = useMemo(
    () => comparison(reference, take, offset),
    [reference, take, offset],
  );
  const current = at(reference, position);
  const cents =
    current?.midi != null && meter?.midi != null
      ? Math.round((meter.midi - current.midi) * 100)
      : null;
  const db = 20 * Math.log10(Math.max(0.000001, meter?.rms ?? 0));
  const status = !micOn
    ? "Mic is off"
    : meter?.midi != null
      ? "Tracking your voice"
      : db < settings.gate
        ? "Below noise gate"
        : "Sound detected · no stable pitch";
  const progress =
    project?.status === "uploaded"
      ? "Preparing tracks"
      : project?.status === "separating"
        ? `Separating tracks ${project.progress}%`
        : vocal?.analysis === "pending"
          ? "Analyzing singer’s pitch"
          : null;
  return (
    <main
      className="studio"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file) void upload(file);
      }}
    >
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">◒</span>
          <strong>
            Tonic<span>studio</span>
          </strong>
        </div>
        <div className="session-title">
          <strong>{project?.title ?? "Your singing studio"}</strong>
          <span>{busy ? "Working…" : (progress ?? saved)}</span>
        </div>
        <button
          onClick={() => setShowLibrary(!showLibrary)}
          disabled={recording || busy}
          aria-expanded={showLibrary}
        >
          Sessions
        </button>
        <button
          className="upload-button"
          onClick={() => fileInput.current?.click()}
          disabled={recording || busy}
        >
          ↑ Upload song
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="audio/*,.mp3,.wav,.flac,.m4a,.ogg,.aac"
          aria-label="Upload audio song"
          className="file-input"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
            e.target.value = "";
          }}
        />
      </header>
      <section className="transport" aria-label="Global transport">
        <div className="transport-actions">
          <button
            aria-label="Back 5 seconds"
            disabled={!project || recording || loading}
            onClick={() => seek(getTime() - 5)}
          >
            −5
          </button>
          <button
            className="play"
            aria-label={
              recording
                ? "Stop recording"
                : playing
                  ? "Pause playback"
                  : "Play playback"
            }
            disabled={!project || loading || busy}
            onClick={() => void playPause()}
          >
            {recording ? "■" : playing ? "Ⅱ" : "▶"}
          </button>
          <button
            aria-label="Forward 5 seconds"
            disabled={!project || recording || loading}
            onClick={() => seek(getTime() + 5)}
          >
            +5
          </button>
          <button
            className={recording ? "record is-recording" : "record"}
            disabled={
              !project ||
              loading ||
              busy ||
              micBusy ||
              project.status !== "ready"
            }
            onClick={() =>
              void (recording ? stopRecording() : startRecording())
            }
          >
            <i />
            {recording ? "Stop & save" : "Record"}
          </button>
        </div>
        <output className="clock">
          {time(position)}
          <small>/ {time(project?.duration ?? 0)}</small>
        </output>
        <label className="master">
          Master
          <input
            type="range"
            aria-label="Master volume"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => {
              const n = Number(e.target.value);
              setVolume(n);
              engine.current?.volume(n);
            }}
          />
        </label>
        <span className="transport-hint">Space to play · ← → to seek</span>
      </section>
      {error && (
        <div className="error" role="alert">
          <span>{error}</span>
          {saved === "Recording needs saving" && (
            <button onClick={() => void saveRecording()}>
              Retry saving take
            </button>
          )}
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            ×
          </button>
        </div>
      )}
      {showLibrary && (
        <section className="session-drawer" aria-label="Sessions">
          <div>
            <h2>Saved sessions</h2>
            {projects.length ? (
              projects.map((p) => (
                <button key={p.id} onClick={() => void openProject(p.id)}>
                  {p.title}
                  <small>
                    {p.tracks.filter((t) => t.kind === "take").length} takes
                  </small>
                </button>
              ))
            ) : (
              <p>Your uploads and recordings will appear here.</p>
            )}
          </div>
          <div>
            <h2>Existing song library</h2>
            {library.map((s) => (
              <button
                key={s.jobId}
                disabled={busy}
                onClick={() => void importSong(s.jobId)}
              >
                {s.title}
                <small>Open in studio</small>
              </button>
            ))}
          </div>
          <button
            className="drawer-close"
            onClick={() => setShowLibrary(false)}
            aria-label="Close sessions"
          >
            ×
          </button>
        </section>
      )}
      {!project ? (
        <section className="empty-studio">
          <div className="empty-symbol">≋</div>
          <h1>A place to hear yourself.</h1>
          <p>
            Bring a song. Record alongside the singer.
            <br />
            See where your voices meet.
          </p>
          <button
            className="upload-button"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >
            {busy ? "Opening audio…" : "Upload a song"}
          </button>
          <span>Drop an audio file anywhere · WAV, MP3, M4A, FLAC</span>
          {library.length > 0 && (
            <button
              className="text-button"
              disabled={busy}
              onClick={() => setShowLibrary(true)}
            >
              Open a song from your library
            </button>
          )}
        </section>
      ) : (
        <>
          <section className="arrangement" aria-label="Song tracks">
            <div className="section-heading">
              <h2>
                Tracks <span>{project.tracks.length + (draft ? 1 : 0)}</span>
              </h2>
              <span>
                {recording ? (
                  <b className="recording-label">
                    Recording original microphone audio
                  </b>
                ) : loading ? (
                  "Loading audio…"
                ) : (
                  (progress ?? "All tracks share one timeline")
                )}
              </span>
              <button
                onClick={() => {
                  setDraft(
                    `My vocals ${project.tracks.filter((t) => t.kind === "take").length + 1}`,
                  );
                  setInspector("microphone");
                }}
                disabled={recording || busy}
              >
                + Vocal track
              </button>
            </div>
            <div className="track-ruler">
              <span>Source / level</span>
              <div>
                <input
                  type="range"
                  aria-label="Song position"
                  min={0}
                  max={project.duration}
                  step={0.01}
                  value={position}
                  disabled={recording}
                  onChange={(e) => seek(Number(e.target.value))}
                />
                <div className="ruler-labels">
                  {Array.from({ length: 7 }, (_, i) => (
                    <span key={i}>
                      {time((project.duration * i) / 6).split(".")[0]}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <div className="track-list">
              {project.tracks.map((t) => (
                <div
                  key={t.id}
                  className={`track-row ${selectedTrack?.id === t.id ? "selected" : ""} ${t.muted ? "muted" : ""}`}
                  style={{ "--track": t.color } as React.CSSProperties}
                >
                  <div className="track-control">
                    <div className="track-title">
                      <i />
                      <button
                        className="track-name"
                        title="Select track"
                        onClick={() => {
                          setSelected(t.id);
                          if (t.kind === "take") setInspector("take");
                        }}
                      >
                        {t.name}
                      </button>
                      <small>
                        {t.kind === "take"
                          ? "take"
                          : t.kind === "vocals"
                            ? "reference"
                            : t.kind === "original"
                              ? "source"
                              : "stem"}
                      </small>
                    </div>
                    <div className="track-mix">
                      <button
                        aria-label={`Mute ${t.name}`}
                        aria-pressed={t.muted}
                        onClick={() => changeTrack(t, { muted: !t.muted })}
                      >
                        M
                      </button>
                      <button
                        aria-label={`Solo ${t.name}`}
                        aria-pressed={t.solo}
                        onClick={() => changeTrack(t, { solo: !t.solo })}
                      >
                        S
                      </button>
                      <input
                        aria-label={`${t.name} volume`}
                        type="range"
                        min={0}
                        max={1.5}
                        step={0.01}
                        value={t.volume}
                        onChange={(e) =>
                          changeTrack(t, { volume: Number(e.target.value) })
                        }
                      />
                      <output>{Math.round(t.volume * 100)}%</output>
                    </div>
                  </div>
                  <Waveform
                    track={t}
                    duration={project.duration}
                    getTime={getTime}
                    onSeek={seek}
                    selected={selectedTrack?.id === t.id}
                  />
                </div>
              ))}
              {draft && (
                <div className="track-row draft">
                  <div className="track-control">
                    <div className="track-title">
                      <i />
                      <input
                        aria-label="New vocal track name"
                        value={draft}
                        disabled={recording}
                        onChange={(e) => setDraft(e.target.value)}
                      />
                    </div>
                    <div className="track-mix">
                      <span className="armed-dot" />
                      {recording ? "Recording…" : "Ready to record"}
                      {!recording && (
                        <button
                          aria-label="Remove empty vocal track"
                          onClick={() => setDraft("")}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="record-lane">
                    <span
                      style={{
                        left: `${(position / project.duration) * 100}%`,
                      }}
                    />
                    {recording
                      ? "Listening. Your take is being captured."
                      : "Press Record to begin at the playhead."}
                  </div>
                </div>
              )}
            </div>
          </section>
          <section className="pitch-workspace" aria-label="Pitch analysis">
            <div className="pitch-main">
              <div className="section-heading">
                <h2>Pitch</h2>
                <div className="legend">
                  <span className="singer-key">Singer</span>
                  <span className="take-key">Your voice</span>
                </div>
                <label className="compact">
                  View
                  <select
                    aria-label="Pitch time window"
                    value={settings.zoom}
                    onChange={(e) =>
                      updateSetting("zoom", Number(e.target.value))
                    }
                  >
                    <option value={6}>6 s</option>
                    <option value={12}>12 s</option>
                    <option value={24}>24 s</option>
                  </select>
                </label>
                <label className="raw-toggle">
                  <input
                    type="checkbox"
                    checked={settings.showRaw}
                    onChange={(e) => updateSetting("showRaw", e.target.checked)}
                  />
                  Raw overlay
                </label>
              </div>
              <div className="pitch-canvas">
                <PitchCanvas
                  reference={reference}
                  rawReference={rawReference}
                  take={take}
                  rawTake={rawTake}
                  offset={offset}
                  live={live}
                  latest={latest}
                  getTime={getTime}
                  settings={settings}
                  onSeek={seek}
                  recording={recording}
                />
                {!reference.length && (
                  <div className="pitch-empty">
                    {progress ??
                      (project.status === "error"
                        ? "Separation needs another try"
                        : "Singer’s pitch will appear here")}
                    <small>
                      Play the song while tracks are prepared. Recording opens
                      when the tracks are ready.
                    </small>
                  </div>
                )}
              </div>
              <div className="mic-strip">
                <div className="live-note">
                  <strong>
                    {meter?.midi != null ? name(meter.midi) : "—"}
                  </strong>
                  <small>
                    {meter?.midi != null
                      ? `${Math.round(hz(meter.midi))} Hz`
                      : "Live pitch"}
                  </small>
                </div>
                <div className="input-status">
                  <div
                    className="meter"
                    role="meter"
                    aria-label="Microphone input level"
                    aria-valuemin={-70}
                    aria-valuemax={0}
                    aria-valuenow={Math.max(-70, Math.min(0, Math.round(db)))}
                  >
                    <i
                      style={{
                        width: `${Math.max(0, Math.min(100, ((db + 70) / 70) * 100))}%`,
                      }}
                    />
                    <em
                      style={{ left: `${((settings.gate + 70) / 70) * 100}%` }}
                    />
                  </div>
                  <span>{status}</span>
                </div>
                <div className="cents">
                  <strong>
                    {cents === null ? "—" : `${cents > 0 ? "+" : ""}${cents}¢`}
                  </strong>
                  <small>from singer now</small>
                </div>
                <button
                  onClick={() => void toggleMic()}
                  disabled={micBusy || recording}
                  aria-pressed={micOn}
                >
                  {micBusy ? "Connecting…" : micOn ? "Mic on" : "Enable mic"}
                </button>
              </div>
            </div>
            <aside className="inspector" aria-label="Pitch controls">
              <nav aria-label="Pitch control tabs">
                {(["reference", "microphone", "take"] as const).map((tab) => (
                  <button
                    key={tab}
                    aria-pressed={inspector === tab}
                    onClick={() => setInspector(tab)}
                  >
                    {tab === "reference"
                      ? "Singer"
                      : tab === "microphone"
                        ? "Live mic"
                        : "Take"}
                  </button>
                ))}
              </nav>
              <div className="inspector-content">
                {inspector === "reference" && (
                  <>
                    <h3>Follow the singer</h3>
                    <p>
                      Light smoothing keeps slides and vibrato. The original
                      estimates are always retained.
                    </p>
                    <Slider
                      label="Singer smoothing"
                      value={settings.referenceSmooth}
                      min={0}
                      max={150}
                      step={10}
                      unit=" ms"
                      onChange={(v) => updateSetting("referenceSmooth", v)}
                    />
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={settings.referenceCleanup}
                        onChange={(e) =>
                          updateSetting("referenceCleanup", e.target.checked)
                        }
                      />
                      Suppress quiet bleed
                    </label>
                    <p>
                      Hide faint stem leakage relative to the singer’s level.
                      Turn off to inspect quiet details; raw overlay always
                      retains every estimate.
                    </p>
                    <Slider
                      label="Singer confidence floor"
                      value={settings.referenceGate}
                      min={0}
                      max={0.5}
                      step={0.01}
                      onChange={(v) => updateSetting("referenceGate", v)}
                    />
                    <Slider
                      label="Singer silence floor"
                      value={settings.referenceSilence}
                      min={-90}
                      max={-35}
                      unit=" dB"
                      onChange={(v) => updateSetting("referenceSilence", v)}
                    />
                    <label className="parameter">
                      <span>Pitch range</span>
                      <select
                        aria-label="Pitch range"
                        value={settings.focusPitch ? "focused" : "wide"}
                        onChange={(e) =>
                          updateSetting(
                            "focusPitch",
                            e.target.value === "focused",
                          )
                        }
                      >
                        <option value="focused">Around the singer</option>
                        <option value="wide">Full vocal range</option>
                      </select>
                    </label>
                    <label className="parameter">
                      <span>Piano labels</span>
                      <select
                        aria-label="Piano labels"
                        value={settings.notation}
                        onChange={(e) =>
                          updateSetting(
                            "notation",
                            e.target.value as Settings["notation"],
                          )
                        }
                      >
                        <option value="notes">Notes</option>
                        <option value="swaras">Swaras</option>
                      </select>
                    </label>
                    {settings.notation === "swaras" && (
                      <label className="parameter">
                        <span>Sa / tonic</span>
                        <select
                          aria-label="Tonic"
                          value={settings.tonic}
                          onChange={(e) =>
                            updateSetting("tonic", Number(e.target.value))
                          }
                        >
                          {Array.from({ length: 12 }, (_, i) => (
                            <option key={i} value={i}>
                              {name(60 + i).replace("4", "")}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <small className="note">
                      Tonic changes labels, never the audio or measured pitch.
                    </small>
                    {vocal?.analysis === "error" && (
                      <p className="inline-error">{vocal.analysisError}</p>
                    )}
                  </>
                )}
                {inspector === "microphone" && (
                  <>
                    <h3>Find a steady signal</h3>
                    <p>
                      Live controls clean up the guide. Your recording keeps the
                      original microphone audio.
                    </p>
                    <label className="parameter">
                      <span>Input device</span>
                      <select
                        aria-label="Microphone device"
                        disabled={recording || micBusy}
                        value={device}
                        onChange={async (e) => {
                          const id = e.target.value;
                          setDevice(id);
                          if (micOn) {
                            setMicBusy(true);
                            try {
                              await engine.current?.enableMic(id);
                            } catch (error) {
                              setMicOn(false);
                              setError(String(error));
                            } finally {
                              setMicBusy(false);
                            }
                          }
                        }}
                      >
                        <option value="">System default</option>
                        {devices
                          .filter((d) => d.deviceId && d.deviceId !== "default")
                          .map((d, i) => (
                            <option value={d.deviceId} key={d.deviceId}>
                              {d.label || `Microphone ${i + 1}`}
                            </option>
                          ))}
                      </select>
                    </label>
                    <Slider
                      label="Detection gain"
                      value={settings.gain}
                      min={0.5}
                      max={6}
                      step={0.1}
                      unit="×"
                      onChange={(v) => updateSetting("gain", v)}
                    />
                    <Slider
                      label="Noise gate"
                      value={settings.gate}
                      min={-70}
                      max={-25}
                      unit=" dB"
                      onChange={(v) => updateSetting("gate", v)}
                    />
                    <Slider
                      label="Live confidence"
                      value={settings.confidence}
                      min={0.4}
                      max={0.95}
                      step={0.01}
                      onChange={(v) => updateSetting("confidence", v)}
                    />
                    <Slider
                      label="Live smoothing"
                      value={settings.liveSmooth}
                      min={0}
                      max={180}
                      step={10}
                      unit=" ms"
                      onChange={(v) => updateSetting("liveSmooth", v)}
                    />
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={settings.stability}
                        onChange={(e) =>
                          updateSetting("stability", e.target.checked)
                        }
                      />
                      Confirm sudden octave jumps
                    </label>
                    <small className="note">
                      Use headphones to keep the song out of your microphone.
                    </small>
                  </>
                )}
                {inspector === "take" && (
                  <>
                    <h3>Listen back. Look closer.</h3>
                    {selectedTrack ? (
                      <>
                        <label className="parameter">
                          <span>Compare recording</span>
                          <select
                            aria-label="Recording to compare"
                            value={selectedTrack.id}
                            onChange={(e) => setSelected(e.target.value)}
                          >
                            {project.tracks
                              .filter((t) => t.kind === "take")
                              .map((t) => (
                                <option key={t.id} value={t.id}>
                                  {t.name}
                                </option>
                              ))}
                          </select>
                        </label>
                        <div className="take-stats">
                          <div>
                            <strong>
                              {stats
                                ? `${stats.cents > 0 ? "+" : ""}${stats.cents}¢`
                                : "—"}
                            </strong>
                            <span>Median difference</span>
                          </div>
                          <div>
                            <strong>{stats ? `${stats.within}%` : "—"}</strong>
                            <span>Within 50 cents</span>
                          </div>
                        </div>
                        <p>
                          {selectedTrack.analysis === "pending"
                            ? "Detailed analysis is running. Live estimates are available now."
                            : stats
                              ? "Compared where both voices have a detectable pitch."
                              : "No overlapping voiced section to compare yet."}
                        </p>
                        <Slider
                          label="Take smoothing"
                          value={settings.takeSmooth}
                          min={0}
                          max={180}
                          step={10}
                          unit=" ms"
                          onChange={(v) => updateSetting("takeSmooth", v)}
                        />
                        <Slider
                          label="Timing correction"
                          value={settings.latency}
                          min={-300}
                          max={300}
                          step={10}
                          unit=" ms"
                          onChange={(v) => updateSetting("latency", v)}
                        />
                        <label className="check">
                          <input
                            type="checkbox"
                            checked={settings.showRaw}
                            onChange={(e) =>
                              updateSetting("showRaw", e.target.checked)
                            }
                          />
                          Show raw estimates alongside
                        </label>
                        <a
                          className="download"
                          href={audioUrl(project.id, selectedTrack.id)}
                          download
                        >
                          ↓ Download original take
                        </a>
                        {selectedTrack.analysis === "error" && (
                          <p className="inline-error">
                            {selectedTrack.analysisError}
                          </p>
                        )}
                      </>
                    ) : (
                      <p>
                        Add a vocal track and record. Select a take to compare
                        it with the singer, adjust its display, or download the
                        original audio.
                      </p>
                    )}
                  </>
                )}
                {(project.status === "error" ||
                  project.tracks.some((t) => t.analysis === "error")) && (
                  <button
                    onClick={() =>
                      void api(`/projects/${project.id}/retry`, {
                        method: "POST",
                      }).catch((e) => setError(e.message))
                    }
                  >
                    Retry analysis
                  </button>
                )}
              </div>
            </aside>
          </section>
        </>
      )}
    </main>
  );
}
