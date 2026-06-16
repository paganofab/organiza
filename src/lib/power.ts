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
  const aplicado = await invoke<boolean>("set_keep_awake", { enabled: ativo });
  await salvarConfig(CONFIG_MANTER_ACORDADO, ativo ? "1" : "0");
  return aplicado;
}
