import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";

function escapar(campo: string): string {
  if (/[";\n]/.test(campo)) {
    return `"${campo.replace(/"/g, '""')}"`;
  }
  return campo;
}

/**
 * Gera um CSV (separador ";", padrão Excel pt-BR) e abre o diálogo
 * de salvar. Retorna true se o usuário salvou.
 */
export async function exportarCsv(
  nomeArquivo: string,
  cabecalho: string[],
  linhas: string[][],
): Promise<boolean> {
  const caminho = await save({
    defaultPath: nomeArquivo,
    filters: [{ name: "CSV", extensions: ["csv"] }],
  });
  if (!caminho) return false;

  const conteudo =
    "﻿" + // BOM para o Excel reconhecer UTF-8
    [cabecalho, ...linhas]
      .map((linha) => linha.map(escapar).join(";"))
      .join("\r\n");

  await invoke("save_text_file", { path: caminho, contents: conteudo });
  return true;
}
