use lettre::message::header::ContentType;
use lettre::transport::smtp::authentication::Credentials;
use lettre::{Message, SmtpTransport, Transport};
use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

/// Copia um comprovante para a pasta de dados do app e retorna o caminho salvo.
#[tauri::command]
fn save_attachment(app: tauri::AppHandle, src: String) -> Result<String, String> {
    let src_path = std::path::PathBuf::from(&src);
    if !src_path.is_file() {
        return Err(format!("Arquivo não encontrado: {}", src));
    }
    let file_name = src_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("comprovante");
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("comprovantes");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dest = dir.join(format!("{}_{}", uuid::Uuid::new_v4(), file_name));
    std::fs::copy(&src_path, &dest).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().to_string())
}

/// Abre um comprovante no aplicativo padrão do sistema.
#[tauri::command]
fn open_attachment(app: tauri::AppHandle, path: String) -> Result<(), String> {
    tauri_plugin_opener::OpenerExt::opener(&app)
        .open_path(path, None::<String>)
        .map_err(|e| e.to_string())
}

/// Remove um comprovante salvo na pasta de dados do app.
#[tauri::command]
fn delete_attachment(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("comprovantes");
    let target = std::path::PathBuf::from(&path);
    if !target.starts_with(&dir) {
        return Err("Caminho fora da pasta de comprovantes".into());
    }
    std::fs::remove_file(&target).map_err(|e| e.to_string())
}

/// Salva conteúdo de texto (ex: CSV exportado) no caminho escolhido pelo usuário.
#[tauri::command]
fn save_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| e.to_string())
}

fn caminho_banco(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .or_else(|_| app.path().app_data_dir())
        .map_err(|e| e.to_string())?
        .join("organiza.db"))
}

/// Copia o banco para `destino` (usado tanto no backup automático quanto no manual).
#[tauri::command]
fn backup_db(app: tauri::AppHandle, destino: String) -> Result<(), String> {
    let origem = caminho_banco(&app)?;
    if !origem.exists() {
        return Err("Banco de dados não encontrado.".into());
    }
    if let Some(pai) = std::path::Path::new(&destino).parent() {
        std::fs::create_dir_all(pai).map_err(|e| e.to_string())?;
    }
    std::fs::copy(&origem, &destino).map_err(|e| e.to_string())?;
    Ok(())
}

/// Cria um backup automático com data/hora na pasta de backups e remove os
/// mais antigos, mantendo no máximo `manter`. Retorna o caminho criado.
#[tauri::command]
fn backup_automatico(app: tauri::AppHandle, manter: usize) -> Result<String, String> {
    let origem = caminho_banco(&app)?;
    if !origem.exists() {
        return Ok(String::new());
    }
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("backups");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let agora = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();
    let destino = dir.join(format!("organiza-{}.db", agora));
    std::fs::copy(&origem, &destino).map_err(|e| e.to_string())?;

    // Remove backups excedentes (mantém os `manter` mais recentes)
    let mut arquivos: Vec<_> = std::fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.extension().and_then(|s| s.to_str()) == Some("db")
                && p.file_name()
                    .and_then(|s| s.to_str())
                    .map(|s| s.starts_with("organiza-"))
                    .unwrap_or(false)
        })
        .collect();
    arquivos.sort();
    if arquivos.len() > manter {
        for antigo in &arquivos[..arquivos.len() - manter] {
            let _ = std::fs::remove_file(antigo);
        }
    }
    Ok(destino.to_string_lossy().to_string())
}

/// Restaura o banco a partir de `origem`, fazendo antes um backup de segurança.
/// O app deve ser reiniciado em seguida para recarregar os dados.
#[tauri::command]
fn restaurar_db(app: tauri::AppHandle, origem: String) -> Result<(), String> {
    let destino = caminho_banco(&app)?;
    let origem_path = std::path::PathBuf::from(&origem);
    if !origem_path.is_file() {
        return Err("Arquivo de backup não encontrado.".into());
    }
    // Segurança: guarda o banco atual antes de sobrescrever
    if destino.exists() {
        let _ = std::fs::copy(&destino, destino.with_extension("db.pre-restore"));
    }
    // Remove arquivos auxiliares do WAL para evitar inconsistência
    let _ = std::fs::remove_file(destino.with_extension("db-wal"));
    let _ = std::fs::remove_file(destino.with_extension("db-shm"));
    std::fs::copy(&origem_path, &destino).map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(serde::Deserialize)]
pub struct SmtpConfig {
    host: String,
    port: u16,
    user: String,
    password: String,
    from: String,
    to: String,
}

/// Envia um email de lembrete usando o SMTP configurado pelo usuário.
/// `async` + spawn_blocking: o envio SMTP bloqueia, então roda fora da thread
/// principal para não congelar a interface.
#[tauri::command]
async fn send_email(
    config: SmtpConfig,
    subject: String,
    body: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let email = Message::builder()
            .from(config.from.parse().map_err(|_| "Email remetente inválido".to_string())?)
            .to(config.to.parse().map_err(|_| "Email destinatário inválido".to_string())?)
            .subject(subject)
            .header(ContentType::TEXT_HTML)
            .body(body)
            .map_err(|e| e.to_string())?;

        let creds = Credentials::new(config.user, config.password);
        let mailer = SmtpTransport::starttls_relay(&config.host)
            .map_err(|e| e.to_string())?
            .port(config.port)
            .credentials(creds)
            .build();

        mailer.send(&email).map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Chama um método da API de bots do Telegram (getUpdates, sendMessage, etc).
/// O frontend monta o payload; aqui só fazemos o HTTP (evita CORS no webview).
/// `async` + spawn_blocking: o long polling do getUpdates pode segurar a conexão
/// por ~25s, então o HTTP roda fora da thread principal para não travar a UI.
#[tauri::command]
async fn telegram_api(
    token: String,
    method: String,
    payload: serde_json::Value,
) -> Result<serde_json::Value, String> {
    if token.is_empty() || !method.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("Token ou método inválido".into());
    }
    tauri::async_runtime::spawn_blocking(move || -> Result<serde_json::Value, String> {
        let url = format!("https://api.telegram.org/bot{}/{}", token, method);
        // Timeout alto para acomodar o long polling do getUpdates (até ~25s aguardando).
        let cliente = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .map_err(|e| e.to_string())?;
        let resposta = cliente
            .post(&url)
            .json(&payload)
            .send()
            .map_err(|e| e.to_string())?;
        let corpo: serde_json::Value = resposta.json().map_err(|e| e.to_string())?;
        if corpo.get("ok").and_then(|v| v.as_bool()) != Some(true) {
            return Err(
                corpo
                    .get("description")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Erro na API do Telegram")
                    .to_string(),
            );
        }
        Ok(corpo)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn migrations() -> Vec<Migration> {
    vec![Migration {
        version: 1,
        description: "schema_inicial",
        kind: MigrationKind::Up,
        sql: r#"
            CREATE TABLE IF NOT EXISTS categorias (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nome TEXT NOT NULL UNIQUE,
                cor TEXT NOT NULL DEFAULT '#6366f1',
                icone TEXT NOT NULL DEFAULT '📌'
            );

            CREATE TABLE IF NOT EXISTS contas (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                descricao TEXT NOT NULL,
                categoria_id INTEGER REFERENCES categorias(id) ON DELETE SET NULL,
                valor_centavos INTEGER NOT NULL,
                vencimento TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pendente',
                data_pagamento TEXT,
                serie_id TEXT,
                parcela_num INTEGER,
                parcela_total INTEGER,
                recorrente INTEGER NOT NULL DEFAULT 0,
                comprovante TEXT,
                observacoes TEXT,
                notificada INTEGER NOT NULL DEFAULT 0,
                email_enviado INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS eventos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                titulo TEXT NOT NULL,
                data TEXT NOT NULL,
                hora TEXT,
                descricao TEXT,
                cor TEXT NOT NULL DEFAULT '#0ea5e9'
            );

            CREATE TABLE IF NOT EXISTS configuracoes (
                chave TEXT PRIMARY KEY,
                valor TEXT NOT NULL
            );

            INSERT OR IGNORE INTO categorias (nome, cor, icone) VALUES
                ('Moradia', '#f59e0b', '🏠'),
                ('Energia', '#eab308', '💡'),
                ('Água', '#0ea5e9', '💧'),
                ('Internet/Telefone', '#6366f1', '📶'),
                ('Cartão de Crédito', '#ef4444', '💳'),
                ('Transporte', '#10b981', '🚗'),
                ('Saúde', '#ec4899', '🏥'),
                ('Educação', '#8b5cf6', '📚'),
                ('Lazer', '#f97316', '🎉'),
                ('Assinaturas', '#14b8a6', '📺'),
                ('Impostos', '#64748b', '🧾'),
                ('Outros', '#a3a3a3', '📌');

            CREATE INDEX IF NOT EXISTS idx_contas_vencimento ON contas (vencimento);
            CREATE INDEX IF NOT EXISTS idx_contas_status ON contas (status);
            CREATE INDEX IF NOT EXISTS idx_eventos_data ON eventos (data);
        "#,
    },
    Migration {
        version: 2,
        description: "icones_lucide",
        kind: MigrationKind::Up,
        // Troca os emojis das categorias por slugs de ícones Lucide
        sql: r#"
            UPDATE categorias SET icone = 'home' WHERE icone = '🏠';
            UPDATE categorias SET icone = 'zap' WHERE icone = '💡';
            UPDATE categorias SET icone = 'droplets' WHERE icone = '💧';
            UPDATE categorias SET icone = 'wifi' WHERE icone = '📶';
            UPDATE categorias SET icone = 'credit-card' WHERE icone = '💳';
            UPDATE categorias SET icone = 'car' WHERE icone = '🚗';
            UPDATE categorias SET icone = 'heart-pulse' WHERE icone = '🏥';
            UPDATE categorias SET icone = 'graduation-cap' WHERE icone = '📚';
            UPDATE categorias SET icone = 'party-popper' WHERE icone = '🎉';
            UPDATE categorias SET icone = 'tv' WHERE icone = '📺';
            UPDATE categorias SET icone = 'receipt' WHERE icone = '🧾';
            UPDATE categorias SET icone = 'tag' WHERE icone = '📌';
        "#,
    },
    Migration {
        version: 3,
        description: "orcamento_e_receitas",
        kind: MigrationKind::Up,
        sql: r#"
            ALTER TABLE categorias ADD COLUMN orcamento_centavos INTEGER NOT NULL DEFAULT 0;
            ALTER TABLE contas ADD COLUMN tipo TEXT NOT NULL DEFAULT 'despesa';
        "#,
    },
    Migration {
        version: 4,
        description: "categorias_de_receita",
        kind: MigrationKind::Up,
        sql: r#"
            ALTER TABLE categorias ADD COLUMN tipo TEXT NOT NULL DEFAULT 'despesa';
            INSERT OR IGNORE INTO categorias (nome, cor, icone, tipo) VALUES
                ('Salário', '#16a34a', 'banknote', 'receita'),
                ('Freelance/Extras', '#0d9488', 'briefcase', 'receita'),
                ('Investimentos', '#8b5cf6', 'piggy-bank', 'receita'),
                ('Reembolsos', '#0ea5e9', 'receipt', 'receita'),
                ('Outras receitas', '#a3a3a3', 'tag', 'receita');
        "#,
    },
    Migration {
        version: 5,
        description: "lembretes",
        kind: MigrationKind::Up,
        sql: r#"
            CREATE TABLE IF NOT EXISTS lembretes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                titulo TEXT NOT NULL,
                data TEXT,
                hora TEXT,
                recorrencia TEXT NOT NULL DEFAULT 'nenhuma',
                concluido INTEGER NOT NULL DEFAULT 0,
                data_conclusao TEXT,
                notificado INTEGER NOT NULL DEFAULT 0,
                observacoes TEXT,
                criado_em TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_lembretes_data ON lembretes (data);
            CREATE INDEX IF NOT EXISTS idx_lembretes_concluido ON lembretes (concluido);
        "#,
    }]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:organiza.db", migrations())
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            save_attachment,
            open_attachment,
            delete_attachment,
            save_text_file,
            send_email,
            telegram_api,
            backup_db,
            backup_automatico,
            restaurar_db
        ])
        .setup(|app| {
            // Iniciado pelo autostart: roda oculto, só com os lembretes ativos
            if std::env::args().any(|a| a == "--hidden") {
                if let Some(janela) = app.get_webview_window("main") {
                    let _ = janela.hide();
                }
            }
            Ok(())
        })
        .on_window_event(|janela, evento| {
            // Fechar a janela esconde o app em vez de encerrar,
            // mantendo os lembretes funcionando (Cmd+Q encerra de verdade)
            if let tauri::WindowEvent::CloseRequested { api, .. } = evento {
                api.prevent_close();
                let _ = janela.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application");

    app.run(|app_handle, evento| {
        // Clique no ícone do Dock reabre a janela escondida (macOS)
        if let tauri::RunEvent::Reopen { .. } = evento {
            if let Some(janela) = app_handle.get_webview_window("main") {
                let _ = janela.show();
                let _ = janela.set_focus();
            }
        }
    });
}
