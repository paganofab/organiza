import { invoke } from "@tauri-apps/api/core";
import { obterConfig, salvarConfig } from "./db";

export const CONFIG_MANTER_ACORDADO = "manter_acordado";

export async function manterAcordadoAtivo(): Promise<boolean> {
  return invoke<boolean>("keep_awake_status");
}

export async function aplicarManterAcordadoSalvo(): Promise<boolean> {
  const ativo = (await obterConfig(CONFIG_MANTER_ACORDADO)) === "1";
  return invoke<boolean>("set_keep_awake", { enabled: ativo });
}

export async function definirManterAcordado(ativo: boolean): Promise<boolean> {
  if (!ativo) {
    // Persistir primeiro evita que uma falha nativa reative o modo no próximo startup.
    await salvarConfig(CONFIG_MANTER_ACORDADO, "0");
    return invoke<boolean>("set_keep_awake", { enabled: false });
  }

  const aplicado = await invoke<boolean>("set_keep_awake", { enabled: ativo });
  await salvarConfig(CONFIG_MANTER_ACORDADO, "1");
  return aplicado;
}
