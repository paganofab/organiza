import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { getDb, obterConfig, salvarConfig } from "./db";
import { hojeISO } from "./format";

const MANTER_BACKUPS = 10;

/** Garante que o WAL foi gravado no .db antes de copiar o arquivo. */
async function checkpoint() {
  const d = await getDb();
  try {
    await d.execute("PRAGMA wal_checkpoint(TRUNCATE)");
  } catch {
    // se falhar, o backup ainda funciona (só pode faltar a última transação)
  }
}

/** Backup automático diário (uma vez por dia ao abrir o app). */
export async function backupAutomaticoSeNecessario() {
  const hoje = hojeISO();
  if ((await obterConfig("backup_ultimo")) === hoje) return;
  await checkpoint();
  try {
    const caminho = await invoke<string>("backup_automatico", {
      manter: MANTER_BACKUPS,
    });
    if (caminho) await salvarConfig("backup_ultimo", hoje);
  } catch (e) {
    console.error("Backup automático falhou:", e);
  }
}

/** Exporta o banco para um arquivo escolhido pelo usuário. */
export async function exportarBackup(): Promise<boolean> {
  const destino = await save({
    defaultPath: `organiza-backup-${hojeISO()}.db`,
    filters: [{ name: "Banco Organiza", extensions: ["db"] }],
  });
  if (!destino) return false;
  await checkpoint();
  await invoke("backup_db", { destino });
  return true;
}

/** Restaura o banco a partir de um arquivo. Requer reinício do app. */
export async function restaurarBackup(origem: string) {
  await invoke("restaurar_db", { origem });
}
