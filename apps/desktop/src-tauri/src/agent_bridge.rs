//! Private loopback transport. The live webview executes domain commands.
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs::{self, File, OpenOptions},
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tauri::{Emitter, Manager};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    net::{TcpListener, TcpStream},
    sync::oneshot,
    time::{timeout, Duration},
};
use uuid::Uuid;

const MAX_REQUEST_BYTES: usize = 8 * 1024 * 1024;
const RESPONSE_TIMEOUT: u64 = 120;
type Pending = Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>>;
#[derive(Default)]
pub struct AgentBridge(Mutex<Option<Running>>);
struct Running {
    task: tauri::async_runtime::JoinHandle<()>,
    discovery: PathBuf,
    pending: Pending,
    _lock: File,
}
impl Drop for Running {
    fn drop(&mut self) {
        self.task.abort();
        let _ = fs::remove_file(&self.discovery);
        if let Ok(mut pending) = self.pending.lock() {
            pending.clear();
        }
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WireRequest {
    token: String,
    id: String,
    method: String,
    #[serde(default)]
    params: Value,
    if_revision: Option<String>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FrontendRequest {
    channel_id: String,
    id: String,
    method: String,
    params: Value,
    if_revision: Option<String>,
    expires_at: u64,
}
fn failure(code: &str, message: &str) -> Value {
    json!({"ok": false, "error": {"code": code, "message": message}})
}
fn check_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Only the main window can manage the agent bridge".into());
    }
    Ok(())
}
fn private_file(path: &PathBuf) -> Result<File, String> {
    let mut opts = OpenOptions::new();
    opts.create(true).write(true).read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    opts.open(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn agent_start(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, AgentBridge>,
    dev_mode: bool,
) -> Result<(), String> {
    check_window(&window)?;
    // Bind first, then lock synchronously: no mutex guard crosses an await.
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| e.to_string())?;
    let mut current = bridge.0.lock().map_err(|e| e.to_string())?;
    if current.is_some() {
        return Ok(());
    }
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let basename = if dev_mode {
        "agent-bridge-dev"
    } else {
        "agent-bridge"
    };
    let lock = private_file(&dir.join(format!("{basename}.lock")))?;
    lock.try_lock_exclusive()
        .map_err(|_| "Another DayRail instance owns the agent bridge".to_string())?;
    let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    let discovery = dir.join(format!("{basename}.json"));
    let metadata = json!({"protocolVersion": 1, "port": listener.local_addr().map_err(|e| e.to_string())?.port(), "token": token, "pid": std::process::id(), "devMode": dev_mode});
    use std::io::Write;
    let mut file = private_file(&discovery)?;
    file.set_len(0).map_err(|e| e.to_string())?;
    file.write_all(metadata.to_string().as_bytes())
        .map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
    let pending_loop = pending.clone();
    let task = tauri::async_runtime::spawn(async move {
        // Bound connections prevent an unresponsive local client consuming unlimited tasks.
        let permits = Arc::new(tokio::sync::Semaphore::new(32));
        while let Ok((stream, _)) = listener.accept().await {
            let Ok(permit) = permits.clone().try_acquire_owned() else {
                continue;
            };
            let app = app.clone();
            let pending = pending_loop.clone();
            let token = token.clone();
            tauri::async_runtime::spawn(async move {
                let _permit = permit;
                let _ = serve(stream, app, pending, &token).await;
            });
        }
    });
    *current = Some(Running {
        task,
        discovery,
        pending,
        _lock: lock,
    });
    Ok(())
}

#[tauri::command]
pub fn agent_stop(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, AgentBridge>,
) -> Result<(), String> {
    check_window(&window)?;
    bridge.0.lock().map_err(|e| e.to_string())?.take();
    Ok(())
}
#[tauri::command]
pub fn agent_respond(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, AgentBridge>,
    channel_id: String,
    response: Value,
) -> Result<(), String> {
    check_window(&window)?;
    if let Some(running) = bridge.0.lock().map_err(|e| e.to_string())?.as_ref() {
        if let Some(tx) = running
            .pending
            .lock()
            .map_err(|e| e.to_string())?
            .remove(&channel_id)
        {
            let _ = tx.send(response);
        }
    }
    Ok(())
}

async fn read_request(stream: &mut BufReader<TcpStream>) -> Result<Vec<u8>, &'static str> {
    let mut bytes = Vec::new();
    loop {
        let available = stream.fill_buf().await.map_err(|_| "Connection closed")?;
        if available.is_empty() {
            return Err("Request ended before newline");
        }
        let count = available
            .iter()
            .position(|b| *b == b'\n')
            .map(|i| i + 1)
            .unwrap_or(available.len());
        if bytes.len() + count > MAX_REQUEST_BYTES {
            return Err("Request is too large");
        }
        let done = available[count - 1] == b'\n';
        bytes.extend_from_slice(&available[..count]);
        stream.consume(count);
        if done {
            return Ok(bytes);
        }
    }
}
fn authenticate(bytes: &[u8], token: &str) -> Result<WireRequest, Value> {
    let request: WireRequest = serde_json::from_slice(bytes)
        .map_err(|_| failure("INVALID_REQUEST", "Expected one JSON request"))?;
    if request.token != token {
        return Err(failure("UNAUTHORIZED", "Invalid local bridge token"));
    }
    if request.id.is_empty() || request.id.len() > 200 || request.method.len() > 100 {
        return Err(failure("INVALID_REQUEST", "Invalid request ID or method"));
    }
    Ok(request)
}
async fn serve(
    stream: TcpStream,
    app: tauri::AppHandle,
    pending: Pending,
    token: &str,
) -> Result<(), String> {
    let mut stream = BufReader::new(stream);
    let response = match timeout(Duration::from_secs(5), read_request(&mut stream)).await {
        Ok(Ok(bytes)) => match authenticate(&bytes, token) {
            Ok(request) => {
                let channel_id = Uuid::new_v4().to_string();
                let (tx, rx) = oneshot::channel();
                pending
                    .lock()
                    .map_err(|e| e.to_string())?
                    .insert(channel_id.clone(), tx);
                let event = FrontendRequest {
                    channel_id: channel_id.clone(),
                    id: request.id,
                    method: request.method,
                    params: request.params,
                    if_revision: request.if_revision,
                    expires_at: (std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64) + 110_000,
                };
                let result = if app.emit_to("main", "dayrail:agent-request", event).is_err() {
                    failure("NOT_READY", "The main webview is unavailable")
                } else {
                    match timeout(Duration::from_secs(RESPONSE_TIMEOUT), rx).await {
                        Ok(Ok(value)) => value,
                        _ => failure("OUTCOME_UNKNOWN", "No acknowledgement from the app. Inspect state before retrying; keep the same request ID."),
                    }
                };
                pending
                    .lock()
                    .map_err(|e| e.to_string())?
                    .remove(&channel_id);
                result
            }
            Err(error) => error,
        },
        _ => failure(
            "INVALID_REQUEST",
            "Request timed out or exceeded the size limit",
        ),
    };
    let mut bytes = serde_json::to_vec(&response).map_err(|e| e.to_string())?;
    bytes.push(b'\n');
    stream
        .get_mut()
        .write_all(&bytes)
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_missing_auth_and_unknown_fields() {
        assert!(authenticate(
            br#"{"token":"wrong","id":"x","method":"task.list"}"#,
            "secret"
        )
        .is_err());
        assert!(authenticate(
            br#"{"token":"secret","id":"x","method":"task.list","extra":true}"#,
            "secret"
        )
        .is_err());
        assert!(authenticate(
            br#"{"token":"secret","id":"x","method":"task.list","params":{}}"#,
            "secret"
        )
        .is_ok());
    }
    #[tokio::test]
    async fn reads_split_frames_and_rejects_incomplete_frames() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let client = tokio::spawn(async move {
            let mut socket = TcpStream::connect(address).await.unwrap();
            socket.write_all(b"{\"id\":").await.unwrap();
            socket.write_all(b"\"x\"}\n").await.unwrap();
        });
        let (socket, _) = listener.accept().await.unwrap();
        assert_eq!(
            read_request(&mut BufReader::new(socket)).await.unwrap(),
            b"{\"id\":\"x\"}\n"
        );
        client.await.unwrap();
    }
}
