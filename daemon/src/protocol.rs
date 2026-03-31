use serde::Deserialize;
use serde_json::json;

/// Parse an incoming message and return what action to take
pub enum Action {
    /// Send input text to the persistent shell
    Input { text: String },
    /// Resize the PTY
    Resize { rows: u16, cols: u16 },
    /// Ping / keepalive
    Ping,
    /// Unknown message
    Unknown,
}

#[derive(Debug, Deserialize)]
struct RawMessage {
    #[serde(rename = "type")]
    msg_type: String,
    text: Option<String>,
    rows: Option<u16>,
    cols: Option<u16>,
}

pub fn parse_message(text: &str) -> Action {
    let msg: Result<RawMessage, _> = serde_json::from_str(text);
    match msg {
        Ok(m) => match m.msg_type.as_str() {
            "input" => Action::Input {
                text: m.text.unwrap_or_default(),
            },
            "resize" => Action::Resize {
                rows: m.rows.unwrap_or(24),
                cols: m.cols.unwrap_or(80),
            },
            "ping" => Action::Ping,
            _ => Action::Unknown,
        },
        Err(_) => Action::Unknown,
    }
}

pub fn output_msg(stream: &str, line: &str) -> String {
    json!({
        "type": "output",
        "stream": stream,
        "line": line,
    })
    .to_string()
}

pub fn pong_msg() -> String {
    json!({"type": "pong"}).to_string()
}
