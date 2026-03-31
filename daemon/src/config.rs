use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub signaling_url: String,
    pub machine_id: String,
    /// Stored session tokens from paired apps (for reconnection auth)
    #[serde(default)]
    pub session_tokens: Vec<String>,
    #[serde(skip)]
    pub data_dir: PathBuf,
}

impl Config {
    pub fn load_or_create() -> anyhow::Result<Self> {
        let data_dir = Self::data_dir();
        let config_path = data_dir.join("config.json");

        if config_path.exists() {
            let contents = std::fs::read_to_string(&config_path)?;
            let mut config: Config = serde_json::from_str(&contents)?;
            config.data_dir = data_dir;
            if let Ok(url) = std::env::var("OpenNodeRelay_SIGNALING_URL") {
                config.signaling_url = url;
            }
            Ok(config)
        } else {
            let signaling_url = std::env::var("OpenNodeRelay_SIGNALING_URL")
                .unwrap_or_else(|_| "https://opennoderelay-signal.opennoderelay.workers.dev".to_string());

            let config = Config {
                signaling_url,
                machine_id: Uuid::new_v4().to_string(),
                session_tokens: Vec::new(),
                data_dir: data_dir.clone(),
            };

            std::fs::create_dir_all(&data_dir)?;
            let contents = serde_json::to_string_pretty(&config)?;
            std::fs::write(&config_path, contents)?;

            Ok(config)
        }
    }

    pub fn save(&self) -> anyhow::Result<()> {
        let config_path = self.data_dir.join("config.json");
        std::fs::create_dir_all(&self.data_dir)?;
        let contents = serde_json::to_string_pretty(self)?;
        std::fs::write(config_path, contents)?;
        Ok(())
    }

    fn data_dir() -> PathBuf {
        dirs::home_dir()
            .expect("could not determine home directory")
            .join(".opennoderelay")
    }
}
