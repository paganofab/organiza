import { invoke } from "@tauri-apps/api/core";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import {
  contasPendentesAte,
  lembretesPendentesAte,
  marcarEmailEnviado,
  marcarLembretesNotificados,
  marcarNotificadas,
  obterConfig,
  obterSmtp,
} from "./db";
import { formatarData, formatarMoeda, hojeISO } from "./format";
import type { Conta, Lembrete } from "./types";

export const DIAS_AVISO_PADRAO = 3;

async function diasAviso(): Promise<number> {
  const v = await obterConfig("dias_aviso");
  const n = v ? parseInt(v, 10) : DIAS_AVISO_PADRAO;
  return isNaN(n) ? DIAS_AVISO_PADRAO : n;
}

function dataLimite(dias: number): string {
  const d = new Date(`${hojeISO()}T00:00:00`);
  d.setDate(d.getDate() + dias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function linhaConta(c: Conta, hoje: string): string {
  const situacao = c.vencimento < hoje ? "VENCIDA" : `vence ${formatarData(c.vencimento)}`;
  return `${c.descricao} — ${formatarMoeda(c.valor_centavos)} (${situacao})`;
}

async function notificarSistema(contas: Conta[], hoje: string) {
  const pendentes = contas.filter((c) => !c.notificada);
  if (!pendentes.length) return;

  let permitido = await isPermissionGranted();
  if (!permitido) {
    permitido = (await requestPermission()) === "granted";
  }
  if (!permitido) return;

  const titulo =
    pendentes.length === 1
      ? "Conta próxima do vencimento"
      : `${pendentes.length} contas próximas do vencimento`;
  sendNotification({
    title: titulo,
    body: pendentes
      .slice(0, 4)
      .map((c) => linhaConta(c, hoje))
      .join("\n"),
  });
  await marcarNotificadas(pendentes.map((c) => c.id));
}

async function enviarEmail(contas: Conta[], hoje: string) {
  const smtp = await obterSmtp();
  if (!smtp) return;
  const pendentes = contas.filter((c) => !c.email_enviado);
  if (!pendentes.length) return;

  const itens = pendentes
    .map((c) => `<li>${linhaConta(c, hoje)}</li>`)
    .join("");
  const body = `
    <h2>Organiza — Lembrete de contas</h2>
    <p>Você tem ${pendentes.length} conta(s) vencida(s) ou próxima(s) do vencimento:</p>
    <ul>${itens}</ul>
  `;
  await invoke("send_email", {
    config: smtp,
    subject: `Organiza: ${pendentes.length} conta(s) a pagar`,
    body,
  });
  await marcarEmailEnviado(pendentes.map((c) => c.id));
}

/** Notifica lembretes (tarefas) com data que chegaram ao dia, uma vez cada. */
async function notificarLembretes(hoje: string) {
  const lembretes = (await lembretesPendentesAte(hoje)).filter(
    (l) => !l.notificado,
  );
  if (!lembretes.length) return;

  let permitido = await isPermissionGranted();
  if (!permitido) {
    permitido = (await requestPermission()) === "granted";
  }
  if (!permitido) return;

  const linha = (l: Lembrete) =>
    `${l.titulo}${l.hora ? ` (${l.hora})` : ""}${l.data! < hoje ? " — atrasado" : ""}`;
  sendNotification({
    title:
      lembretes.length === 1
        ? "Lembrete"
        : `${lembretes.length} lembretes pendentes`,
    body: lembretes.slice(0, 4).map(linha).join("\n"),
  });
  await marcarLembretesNotificados(lembretes.map((l) => l.id));
}

/**
 * Verifica vencimentos e lembretes, disparando notificação do sistema e email
 * (se configurado). Cada item é notificado/emailado uma única vez (flags no banco).
 */
export async function verificarLembretes() {
  const hoje = hojeISO();
  const limite = dataLimite(await diasAviso());
  const contas = await contasPendentesAte(limite);

  if (contas.length) {
    await notificarSistema(contas, hoje);
    try {
      await enviarEmail(contas, hoje);
    } catch (e) {
      console.error("Falha ao enviar email de lembrete:", e);
    }
  }

  try {
    await notificarLembretes(hoje);
  } catch (e) {
    console.error("Falha ao notificar lembretes:", e);
  }
}

let intervalo: number | undefined;

/** Inicia verificação ao abrir o app e a cada 30 minutos. */
export function iniciarLembretes() {
  verificarLembretes().catch(console.error);
  if (intervalo === undefined) {
    intervalo = window.setInterval(
      () => verificarLembretes().catch(console.error),
      30 * 60 * 1000,
    );
  }
}
