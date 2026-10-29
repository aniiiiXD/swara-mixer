//! Tonic desktop shell.
//!
//! The window is just a webview over the statically exported Next app. The real
//! work of this crate is supervising the Python backend that the UI talks to:
//!
//!   1. Pick a free loopback port (8008 is often taken by `make dev`).
//!   2. Extract the bundled Python runtime on first run (see `ensure_runtime`).
//!   3. Spawn the API and the separation worker, pointed at per-user data dirs.
//!   4. Wait for /health, then swap the splash window for the app window.
//!
//! The port is handed to the frontend through an initialization script rather
//! than a build-time env var, because a static export has no server to template.

use std::fs;
use std::io::{Read, Write};
use std::net::{Shutdown, SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// Path of the runtime tarball inside the app bundle's Resources directory.
const RUNTIME_ARCHIVE: &str = "runtime/tonic-runtime.tar.gz";

/// How long to wait for the API to answer /health. Importing torch + librosa is
/// genuinely slow (tens of seconds on a cold page cache), so this is generous.
const HEALTH_TIMEOUT: Duration = Duration::from_secs(180);

/// Spawned Python processes, killed when the app exits.
#[derive(Default)]
struct Backend(Mutex<Vec<Child>>);

/// Where the Python interpreter and backend source live, once resolved.
struct Runtime {
    python: PathBuf,
    backend_dir: PathBuf,
    /// Directory holding the bundled `ffmpeg`/`ffprobe`/`yt-dlp`. Prepended to
    /// PATH so the backend's `shutil.which` calls find them instead of falling
    /// back to a Homebrew path that will not exist on a user's machine.
    bin_dir: Option<PathBuf>,
    /// Extra import root. Only used in development: the repo's venv does not
    /// install `stemcore`, it is supplied on PYTHONPATH (as `make dev` does).
    /// The packaged runtime pip-installs it properly and leaves this None.
    pythonpath: Option<PathBuf>,
    /// TORCH_HOME. For the packaged runtime this points inside the extracted
    /// tree, where the build has already placed the Demucs weights — so the
    /// first separation works offline instead of downloading 80MB mid-job.
    torch_home: PathBuf,
}

// ── startup steps ───────────────────────────────────────────────────────────

/// Ask the OS for an unused loopback port by binding to :0 and releasing it.
///
/// There is a small race between releasing and uvicorn binding, but the
/// alternative (letting Python choose) means the port is not known until the
/// child has started, and the frontend needs it before the page loads.
fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        .unwrap_or(8008)
}

/// Extract the bundled runtime into Application Support if it is missing or
/// stale, and return the resolved interpreter paths.
///
/// The runtime ships as a tarball rather than loose files for three reasons: a
/// single opaque resource keeps the code signature simple, tar preserves the
/// executable bits that the bundler does not promise to, and the extracted copy
/// is writable — which Python needs for `__pycache__` and torch needs for its
/// model cache.
fn ensure_runtime(app: &AppHandle, status: &dyn Fn(&str)) -> Result<Runtime, String> {
    // A debug build always uses the repo's venv, so the shell can be iterated on
    // without waiting on a 20-minute runtime build. Set TONIC_USE_BUNDLED_RUNTIME
    // to exercise the packaged path from a dev build.
    if cfg!(debug_assertions) && std::env::var_os("TONIC_USE_BUNDLED_RUNTIME").is_none() {
        return dev_runtime();
    }

    let archive = match app.path().resolve(RUNTIME_ARCHIVE, BaseDirectory::Resource) {
        Ok(p) if p.exists() => p,
        _ => return dev_runtime(),
    };

    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data dir: {e}"))?;
    let runtime_dir = data_dir.join("runtime");
    let stamp = runtime_dir.join(".version");

    // Fingerprint the archive, not just the app version: the runtime is rebuilt
    // far more often than the version is bumped (any backend edit repacks it),
    // and keying on the version alone would leave an existing install running
    // stale Python forever. Size is a metadata read, so this stays instant on
    // every launch where a real hash of ~370MB would not.
    let archive_size = fs::metadata(&archive).map(|m| m.len()).unwrap_or(0);
    let want = format!("{} {}", app.package_info().version, archive_size);

    let current = fs::read_to_string(&stamp).unwrap_or_default();
    if current.trim() != want {
        status("Preparing Tonic for first run — about a minute, only happens once.");
        if runtime_dir.exists() {
            fs::remove_dir_all(&runtime_dir).map_err(|e| format!("clearing runtime: {e}"))?;
        }
        fs::create_dir_all(&runtime_dir).map_err(|e| format!("creating runtime dir: {e}"))?;

        // bsdtar ships with macOS; shelling out avoids pulling a tar+flate
        // dependency into the shell and handles the exec bits correctly.
        let out = Command::new("/usr/bin/tar")
            .arg("-xzf")
            .arg(&archive)
            .arg("-C")
            .arg(&runtime_dir)
            .output()
            .map_err(|e| format!("running tar: {e}"))?;
        if !out.status.success() {
            return Err(format!(
                "unpacking the audio engine failed: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            ));
        }
        // A downloaded .app is quarantined, and files extracted out of it inherit
        // the flag — which makes macOS refuse to execute the interpreter. We
        // unpacked this ourselves from our own signed bundle, so clear it.
        let _ = Command::new("/usr/bin/xattr")
            .args(["-dr", "com.apple.quarantine"])
            .arg(&runtime_dir)
            .status();

        fs::write(&stamp, &want).map_err(|e| format!("writing version stamp: {e}"))?;
    }

    let python = runtime_dir.join("python/bin/python3.11");
    if !python.exists() {
        return Err(format!("bundled interpreter missing at {}", python.display()));
    }
    Ok(Runtime {
        python,
        backend_dir: runtime_dir.join("backend"),
        bin_dir: Some(runtime_dir.join("bin")),
        pythonpath: None,
        torch_home: runtime_dir.join("models"),
    })
}

/// torch's default cache location, so a dev run reuses already-downloaded weights.
fn dirs_cache_torch() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_default()
        .join(".cache/torch")
}

/// Development fallback: use the checked-out backend and its `.venv`.
fn dev_runtime() -> Result<Runtime, String> {
    // src-tauri -> desktop -> coach -> apps -> repo root
    let repo = Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(4)
        .ok_or("cannot locate repo root")?
        .to_path_buf();
    let backend_dir = repo.join("apps/coach/backend");
    let python = backend_dir.join(".venv/bin/python");
    if !python.exists() {
        return Err(format!(
            "no bundled runtime and no dev venv at {}. Run ./scripts/setup.sh, \
             or build the runtime with make desktop-runtime.",
            python.display()
        ));
    }
    Ok(Runtime {
        python,
        backend_dir,
        bin_dir: None,
        pythonpath: Some(repo.join("packages/core")),
        // Development reuses whatever torch has already cached for this machine.
        torch_home: dirs_cache_torch(),
    })
}

/// Launch the API and worker processes.
fn spawn_backend(app: &AppHandle, rt: &Runtime, port: u16) -> Result<Vec<Child>, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data dir: {e}"))?;

    let storage = data_dir.join("storage");
    let cache = data_dir.join("cache/karaoke");
    let models = rt.torch_home.clone();
    for d in [&storage, &cache, &models] {
        fs::create_dir_all(d).map_err(|e| format!("creating {}: {e}", d.display()))?;
    }

    let mut path = String::new();
    if let Some(bin) = &rt.bin_dir {
        path.push_str(&bin.to_string_lossy());
        path.push(':');
    }
    // The interpreter's own bin dir carries pip console scripts (yt-dlp).
    if let Some(py_bin) = rt.python.parent() {
        path.push_str(&py_bin.to_string_lossy());
        path.push(':');
    }
    path.push_str("/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin");

    let launch = |mode: &str, extra: &[&str]| -> Result<Child, String> {
        let mut cmd = Command::new(&rt.python);
        cmd.arg("-m")
            .arg("app.desktop")
            .arg(mode)
            .args(extra)
            .current_dir(&rt.backend_dir)
            .env("PATH", &path)
            .env("STEM_STUDIO_ROOT", &data_dir)
            .env("STORAGE_DIR", &storage)
            .env("KARAOKE_CACHE", &cache)
            .env("TORCH_HOME", &models)
            .env("STEM_API", format!("http://127.0.0.1:{port}"))
            // The webview's origin under the custom asset protocol. Without this
            // every fetch from the UI is blocked by CORS.
            .env("ALLOWED_ORIGINS", "tauri://localhost,http://tauri.localhost")
            .env("PYTORCH_MPS_HIGH_WATERMARK_RATIO", "0.0")
            .env("PYTHONUNBUFFERED", "1")
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit());
        if let Some(extra) = &rt.pythonpath {
            cmd.env("PYTHONPATH", extra);
        }
        cmd.spawn()
            .map_err(|e| format!("could not start the {mode} process: {e}"))
    };

    let port_arg = port.to_string();
    let api = launch("api", &["--port", &port_arg])?;
    let worker = launch("worker", &[])?;
    Ok(vec![api, worker])
}

/// Poll `GET /health` until the API answers or we give up.
fn await_health(port: u16, status: &dyn Fn(&str)) -> Result<(), String> {
    let addr: SocketAddr = ([127, 0, 0, 1], port).into();
    let started = Instant::now();
    let deadline = started + HEALTH_TIMEOUT;

    status("Loading the audio engine…");
    while Instant::now() < deadline {
        if http_ok(&addr) {
            return Ok(());
        }
        // Torch and librosa take a while to import; say so rather than looking hung.
        if started.elapsed() > Duration::from_secs(10) {
            status(&format!(
                "Loading the audio engine… {}s",
                started.elapsed().as_secs()
            ));
        }
        std::thread::sleep(Duration::from_millis(400));
    }
    Err("the audio engine did not start in time".into())
}

/// Minimal HTTP GET /health. Hand-rolled to keep an HTTP client out of the
/// dependency tree for one request against our own child process.
fn http_ok(addr: &SocketAddr) -> bool {
    let Ok(mut stream) = TcpStream::connect_timeout(addr, Duration::from_millis(500)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(1500)));
    let req = format!(
        "GET /health HTTP/1.0\r\nHost: 127.0.0.1:{}\r\nConnection: close\r\n\r\n",
        addr.port()
    );
    if stream.write_all(req.as_bytes()).is_err() {
        return false;
    }
    let mut buf = Vec::new();
    // Borrow rather than consume the stream, so it can still be shut down below.
    // Spelled out because TcpStream implements both Read::by_ref and Write::by_ref.
    let _ = Read::by_ref(&mut stream).take(512).read_to_end(&mut buf);
    let _ = stream.shutdown(Shutdown::Both);
    let head = String::from_utf8_lossy(&buf);
    head.starts_with("HTTP/1.1 200") || head.starts_with("HTTP/1.0 200")
}

// ── windows ─────────────────────────────────────────────────────────────────

fn set_status(splash: &WebviewWindow, message: &str) {
    let encoded = serde_json::to_string(message).unwrap_or_else(|_| "\"\"".into());
    let _ = splash.eval(&format!(
        "window.tonicStatus && window.tonicStatus({encoded})"
    ));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(Backend::default())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let port = free_port();
            let handle = app.handle().clone();

            let splash = WebviewWindowBuilder::new(
                app,
                "splash",
                WebviewUrl::App("splash.html".into()),
            )
            .title("Tonic")
            .inner_size(420.0, 280.0)
            .resizable(false)
            .decorations(false)
            .center()
            .build()?;

            // Built hidden and revealed only once the backend answers, so the
            // user never sees the UI fail its first fetch.
            let main = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("/".into()))
                .title("Tonic")
                .inner_size(1440.0, 900.0)
                .min_inner_size(1024.0, 700.0)
                .visible(false)
                .center()
                .initialization_script(&format!(
                    "window.__TONIC_API__ = \"http://127.0.0.1:{port}\";"
                ))
                .build()?;

            std::thread::spawn(move || {
                let status = |msg: &str| set_status(&splash, msg);

                let result = ensure_runtime(&handle, &status)
                    .and_then(|rt| {
                        status("Starting the audio engine…");
                        spawn_backend(&handle, &rt, port)
                    })
                    .and_then(|children| {
                        handle
                            .state::<Backend>()
                            .0
                            .lock()
                            .map_err(|_| "backend state poisoned".to_string())?
                            .extend(children);
                        await_health(port, &status)
                    });

                match result {
                    Ok(()) => {
                        let _ = main.show();
                        let _ = main.set_focus();
                        let _ = splash.close();
                    }
                    Err(err) => {
                        log::error!("startup failed: {err}");
                        // Leave the splash up: it is the only surface that can
                        // explain why the app is not opening.
                        status(&format!("Could not start Tonic.\n{err}"));
                    }
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Tonic");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            if let Ok(mut children) = handle.state::<Backend>().0.lock() {
                for mut child in children.drain(..) {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        }
    });
}
