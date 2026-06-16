import { invoke } from "@tauri-apps/api/core";
import {
  atualizarCategoriaConta,
  atualizarVencimento,
  concluirLembrete,
  criarConta,
  criarLembrete,
  excluirConta,
  excluirLembrete,
  listarCategorias,
  listarLembretes,
  marcarPaga,
  obterConfig,
  obterConta,
  obterLembrete,
  obterUltimaConta,
  obterUltimoLembrete,
  salvarConfig,
} from "./db";
import { resumoDiario, tentarConsulta } from "./consultas";
import { emitirAtualizacao } from "./eventos";
import { diffDias, formatarData, formatarMoeda, hojeISO } from "./format";
import {
  interpretarCorrecao,
  interpretarLembrete,
  interpretarMensagem,
  normalizar,
} from "./parser";
import type { Categoria, Conta, Lembrete } from "./types";

// Pergunta que lista os lembretes pendentes (com botões para concluir)
const LISTA_LEMBRETES = /\b(lembretes|tarefas|a fazer|pendencias|to-?do)\b/;

// Long polling: o getUpdates segura a conexão por até LONG_POLL_S e retorna
// no instante em que uma mensagem chega — resposta quase imediata.
const LONG_POLL_S = 25;
const ERRO_BACKOFF_MS = 5000;
const SEM_TOKEN_MS = 5000;

const AJUDA = [
  "Me mande uma conta, por exemplo:",
  "• conta de agua 12 dezembro 250 reais",
  "• luz dia 20 R$ 189,90",
  "• receita freela site 30/06 2000",
  "",
  "Ou me faça uma pergunta:",
  "• saldo  → saldo do mês",
  "• quanto gastei  → despesas do mês",
  "• proximos vencimentos  → o que vai vencer",
  "• atrasadas  → contas vencidas",
  "",
  "Sem data, lanço para hoje. Para ajustar a última conta: \"muda para 2027\".",
  "",
  "Para anexar uma observação, use // ou obs: no fim. Ex:",
  "• luz 189,90 dia 20 // medidor trocado",
  "",
  "Lembretes (tarefas):",
  "• lembrar de levar o lixo amanhã",
  "• lembrete: pagar academia toda terça",
  "• lembretes  → lista os pendentes",
].join("\n");

// Última conta adicionada/ajustada via Telegram nesta sessão do app
let ultimaConta: Conta | null = null;

interface UpdateTelegram {
  update_id: number;
  message?: {
    text?: string;
    chat: { id: number; first_name?: string };
  };
  callback_query?: {
    id: string;
    data?: string;
    from: { id: number };
    message?: { message_id: number; chat: { id: number } };
  };
}

interface BotaoInline {
  text: string;
  callback_data: string;
}

async function api(
  token: string,
  method: string,
  payload: Record<string, unknown>,
): Promise<unknown> {
  return invoke("telegram_api", { token, method, payload });
}

/** Mostra "Organiza está digitando…" no chat enquanto processamos. */
async function mostrarDigitando(token: string, chatId: number) {
  try {
    await api(token, "sendChatAction", { chat_id: chatId, action: "typing" });
  } catch {
    // indicador é cosmético; ignorar falhas
  }
}

async function responder(
  token: string,
  chatId: number,
  texto: string,
  teclado?: BotaoInline[][],
) {
  await api(token, "sendMessage", {
    chat_id: chatId,
    text: texto,
    ...(teclado ? { reply_markup: { inline_keyboard: teclado } } : {}),
  });
}

function textoConfirmacao(conta: Conta, categoriaNome: string | null): string {
  const linhas = [
    `✅ ${conta.tipo === "receita" ? "Receita" : "Conta"} adicionada!`,
    `${conta.descricao} — ${formatarMoeda(conta.valor_centavos)}`,
    `${conta.tipo === "receita" ? "recebimento" : "vencimento"}: ${formatarData(conta.vencimento)}`,
    `categoria: ${categoriaNome ?? "sem categoria"}`,
  ];
  // Mostra a observação só quando é uma nota personalizada (não o marcador padrão)
  if (conta.observacoes && conta.observacoes !== "Adicionada via Telegram") {
    linhas.push(`obs: ${conta.observacoes}`);
  }
  return linhas.join("\n");
}

function botoesAcao(conta: Conta): BotaoInline[] {
  return [
    {
      text: conta.tipo === "receita" ? "✅ Marcar recebida" : "✅ Marcar paga",
      callback_data: `paga:${conta.id}`,
    },
    { text: "🗑 Excluir", callback_data: `del:${conta.id}` },
  ];
}

const ROTULO_REC: Record<string, string> = {
  diario: "todo dia",
  semanal: "toda semana",
  mensal: "todo mês",
};

function quandoLembrete(l: Lembrete, hoje: string): string {
  if (!l.data) return "sem prazo";
  const dias = diffDias(hoje, l.data);
  const base =
    dias < 0
      ? `atrasado ${-dias}d`
      : dias === 0
        ? "hoje"
        : `${formatarData(l.data)} (em ${dias}d)`;
  return `${base}${l.hora ? ` ${l.hora}` : ""}`;
}

function textoLembrete(l: Lembrete, hoje: string): string {
  const linhas = [
    "📝 Lembrete criado!",
    l.titulo,
    quandoLembrete(l, hoje),
  ];
  if (l.recorrencia !== "nenhuma") linhas.push(`repete ${ROTULO_REC[l.recorrencia]}`);
  return linhas.join("\n");
}

function botoesLembrete(l: Lembrete): BotaoInline[] {
  return [
    { text: "✅ Concluir", callback_data: `lembok:${l.id}` },
    { text: "🗑 Excluir", callback_data: `lembdel:${l.id}` },
  ];
}

/** Lista lembretes pendentes com um botão de concluir para cada. */
async function responderLembretes(token: string, chatId: number, hoje: string) {
  const pend = (await listarLembretes()).filter((l) => !l.concluido);
  if (!pend.length) {
    await responder(token, chatId, "✅ Nenhum lembrete pendente. 🎉");
    return;
  }
  const linhas = pend
    .slice(0, 10)
    .map((l) => `• ${l.titulo} — ${quandoLembrete(l, hoje)}`);
  const teclado = pend
    .slice(0, 10)
    .map((l) => [
      { text: `✓ ${l.titulo.slice(0, 40)}`, callback_data: `lembok:${l.id}` },
    ]);
  await responder(
    token,
    chatId,
    [`📝 Lembretes pendentes (${pend.length}):`, ...linhas, "", "Toque para concluir:"].join("\n"),
    teclado,
  );
}

/** Teclado da confirmação: categorias (se faltou) + ações rápidas. */
function montarTeclado(
  conta: Conta,
  temCategoria: boolean,
  categorias: Categoria[],
): BotaoInline[][] {
  const linhas: BotaoInline[][] = [];
  if (!temCategoria) {
    const doTipo = categorias.filter((c) => c.tipo === conta.tipo);
    for (let i = 0; i < doTipo.length; i += 3) {
      linhas.push(
        doTipo.slice(i, i + 3).map((c) => ({
          text: c.nome,
          callback_data: `cat:${conta.id}:${c.id}`,
        })),
      );
    }
  }
  linhas.push(botoesAcao(conta));
  return linhas;
}

/** Processa uma mensagem de texto. Retorna um resumo do que mudou (ou null). */
async function processarMensagem(
  token: string,
  chatId: number,
  texto: string,
): Promise<string | null> {
  await mostrarDigitando(token, chatId);
  const hoje = hojeISO();

  // Listar lembretes pendentes (com botões para concluir)
  if (LISTA_LEMBRETES.test(normalizar(texto))) {
    await responderLembretes(token, chatId, hoje);
    return null;
  }

  // Perguntas (saldo, gastos, vencimentos, atrasadas) têm prioridade
  const consulta = await tentarConsulta(texto);
  if (consulta) {
    await responder(token, chatId, consulta);
    return null;
  }

  // Lembrete: "lembrar de X", "lembrete: Y toda terça"
  const lemb = interpretarLembrete(texto, hoje);
  if (lemb) {
    await criarLembrete({
      titulo: lemb.titulo,
      data: lemb.data,
      hora: lemb.hora,
      recorrencia: lemb.recorrencia,
      observacoes: "Adicionado via Telegram",
    });
    const novo = await obterUltimoLembrete();
    if (novo) {
      await responder(token, chatId, textoLembrete(novo, hoje), [
        botoesLembrete(novo),
      ]);
      return `Lembrete: ${novo.titulo}`;
    }
    return null;
  }

  const categorias = await listarCategorias();
  const resultado = interpretarMensagem(texto, hoje, categorias);

  if (!resultado.ok) {
    // Sem valor: pode ser uma correção de data da última conta
    if (ultimaConta) {
      const novoVencimento = interpretarCorrecao(
        texto,
        hoje,
        ultimaConta.vencimento,
      );
      if (novoVencimento) {
        await atualizarVencimento(ultimaConta.id, novoVencimento);
        ultimaConta.vencimento = novoVencimento;
        await responder(
          token,
          chatId,
          `📅 Vencimento de "${ultimaConta.descricao}" alterado para ${formatarData(novoVencimento)}.`,
        );
        return `Data alterada: ${ultimaConta.descricao} → ${formatarData(novoVencimento)}`;
      }
    }
    await responder(token, chatId, AJUDA);
    return null;
  }

  const c = resultado.conta;
  const categoria = c.categoriaNome
    ? categorias.find((cat) => cat.nome === c.categoriaNome)
    : undefined;

  await criarConta({
    descricao: c.descricao,
    categoria_id: categoria?.id ?? null,
    valor_centavos: c.valor_centavos,
    vencimento: c.vencimento,
    observacoes: c.observacao ?? "Adicionada via Telegram",
    tipo: c.tipo,
    recorrente: false,
    meses_recorrencia: 1,
    parcelado: false,
    parcela_total: 1,
  });
  const conta = await obterUltimaConta();
  ultimaConta = conta;
  if (!conta) return null;

  await responder(
    token,
    chatId,
    textoConfirmacao(conta, categoria?.nome ?? null) +
      (!categoria ? "\n\n👇 Toque para definir a categoria:" : ""),
    montarTeclado(conta, !!categoria, categorias),
  );
  return `${conta.descricao} — ${formatarMoeda(conta.valor_centavos)} (${formatarData(conta.vencimento)})`;
}

/** Trata o toque em um botão (callback_query). Retorna resumo do que mudou. */
async function processarCallback(
  token: string,
  cb: NonNullable<UpdateTelegram["callback_query"]>,
  chatPareado: string | null,
): Promise<string | null> {
  const finalizar = (texto?: string) =>
    api(token, "answerCallbackQuery", {
      callback_query_id: cb.id,
      ...(texto ? { text: texto } : {}),
    });

  if (!chatPareado || String(cb.from.id) !== chatPareado || !cb.data) {
    await finalizar("Não autorizado.");
    return null;
  }

  const editar = async (texto: string, teclado?: BotaoInline[][]) => {
    if (!cb.message) return;
    await api(token, "editMessageText", {
      chat_id: cb.message.chat.id,
      message_id: cb.message.message_id,
      text: texto,
      ...(teclado ? { reply_markup: { inline_keyboard: teclado } } : {}),
    });
  };

  const [acao, idTexto, extra] = cb.data.split(":");
  const id = Number(idTexto);

  // Ações de lembrete
  if (acao === "lembok" || acao === "lembdel") {
    const lemb = await obterLembrete(id);
    if (!lemb) {
      await finalizar("Lembrete não existe mais.");
      await editar("Lembrete removido.");
      return null;
    }
    if (acao === "lembok") {
      await concluirLembrete(id, hojeISO());
      await finalizar("Concluído!");
      const repetiu = lemb.recorrencia !== "nenhuma" && lemb.data;
      await editar(
        repetiu
          ? `🔁 "${lemb.titulo}" concluído — reagendado (${ROTULO_REC[lemb.recorrencia]}).`
          : `✅ Concluído: ${lemb.titulo}`,
      );
      return `Lembrete concluído: ${lemb.titulo}`;
    } else {
      await excluirLembrete(id);
      await finalizar("Excluído.");
      await editar(`🗑 Lembrete excluído: ${lemb.titulo}`);
      return `Lembrete excluído: ${lemb.titulo}`;
    }
  }

  const conta = await obterConta(id);
  if (!conta) {
    await finalizar("Essa conta não existe mais.");
    await editar("🗑 Conta removida.");
    return null;
  }

  if (acao === "cat") {
    const categorias = await listarCategorias();
    const categoria = categorias.find((c) => c.id === Number(extra));
    await atualizarCategoriaConta(conta.id, categoria?.id ?? null);
    await finalizar(`Categoria: ${categoria?.nome ?? "?"}`);
    await editar(textoConfirmacao(conta, categoria?.nome ?? null), [
      botoesAcao(conta),
    ]);
    return `${conta.descricao}: categoria ${categoria?.nome ?? "removida"}`;
  } else if (acao === "paga") {
    await marcarPaga(conta.id, hojeISO());
    await finalizar(conta.tipo === "receita" ? "Recebida!" : "Paga!");
    await editar(
      `✅ ${conta.tipo === "receita" ? "Recebida" : "Paga"}: ${conta.descricao} — ${formatarMoeda(conta.valor_centavos)} (em ${formatarData(hojeISO())})`,
    );
    return `${conta.tipo === "receita" ? "Recebida" : "Paga"}: ${conta.descricao}`;
  } else if (acao === "del") {
    await excluirConta(conta.id);
    if (ultimaConta?.id === conta.id) ultimaConta = null;
    await finalizar("Excluída.");
    await editar(
      `🗑 Excluída: ${conta.descricao} — ${formatarMoeda(conta.valor_centavos)}`,
    );
    return `Excluída: ${conta.descricao}`;
  }
  await finalizar();
  return null;
}

/**
 * Faz um ciclo de getUpdates (long polling) e processa o que chegou.
 * Retorna os resumos das mudanças (vazio se nada relevante).
 */
export async function verificarTelegram(longPollS = 0): Promise<string[]> {
  const token = await obterConfig("telegram_token");
  if (!token) return [];

  const offset = Number((await obterConfig("telegram_offset")) ?? "0");
  const chatPareado = await obterConfig("telegram_chat_id");

  const resposta = (await api(token, "getUpdates", {
    offset: offset || undefined,
    timeout: longPollS,
    allowed_updates: ["message", "callback_query"],
  })) as { result?: UpdateTelegram[] };

  const updates = resposta.result ?? [];
  const resumos: string[] = [];

  for (const u of updates) {
    const msg = u.message;
    if (msg?.text) {
      const chatId = msg.chat.id;
      if (!chatPareado) {
        // Primeira mensagem ao bot define o chat autorizado
        await salvarConfig("telegram_chat_id", String(chatId));
        await responder(
          token,
          chatId,
          `🤝 Organiza conectado, ${msg.chat.first_name ?? "olá"}! Este chat agora pode adicionar contas.\n\nExemplo: conta de agua 12 dezembro 250 reais`,
        );
        resumos.push("Telegram conectado");
      } else if (String(chatId) === chatPareado) {
        try {
          if (/^\/(start|ajuda|menu|help)/.test(msg.text)) {
            await responder(token, chatId, AJUDA);
          } else if (!msg.text.startsWith("/")) {
            const r = await processarMensagem(token, chatId, msg.text);
            if (r) resumos.push(r);
          }
        } catch (e) {
          console.error("Erro ao processar mensagem do Telegram:", e);
        }
      }
      // Mensagens de outros chats são ignoradas em silêncio
    } else if (u.callback_query) {
      try {
        const r = await processarCallback(token, u.callback_query, chatPareado);
        if (r) resumos.push(r);
      } catch (e) {
        console.error("Erro ao processar botão do Telegram:", e);
      }
    }
    // Avança o offset mesmo em updates ignorados, para não reprocessar
    await salvarConfig("telegram_offset", String(u.update_id + 1));
  }
  return resumos;
}

// ---------- Loop de long polling + status ----------

let loopAtivo = false;
let ultimaSync = 0;
let ultimoErro: string | null = null;

export interface StatusTelegram {
  configurado: boolean;
  ativo: boolean;
  ultimaSync: number; // epoch ms, 0 = nunca
  ultimoErro: string | null;
}

let temToken = false;
export function statusTelegram(): StatusTelegram {
  return { configurado: temToken, ativo: loopAtivo, ultimaSync, ultimoErro };
}

function dormir(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Inicia o loop de long polling. Cada getUpdates aguarda no servidor do
 * Telegram até uma mensagem chegar (ou ~25s), então repetimos imediatamente —
 * a entrega fica praticamente instantânea, sem o atraso do antigo timer de 30s.
 */
export function iniciarTelegram() {
  if (loopAtivo) return;
  loopAtivo = true;

  (async () => {
    while (loopAtivo) {
      const token = await obterConfig("telegram_token");
      temToken = !!token;
      if (!token) {
        await dormir(SEM_TOKEN_MS);
        continue;
      }
      try {
        const chatPareado = await obterConfig("telegram_chat_id");
        if (chatPareado) {
          await verificarResumoDiario(token, chatPareado).catch((e) =>
            console.error("Resumo diário:", e),
          );
        }
        const resumos = await verificarTelegram(LONG_POLL_S);
        ultimaSync = Date.now();
        ultimoErro = null;
        if (resumos.length) emitirAtualizacao(resumos.join(" · "));
      } catch (e) {
        ultimoErro = String(e);
        await dormir(ERRO_BACKOFF_MS);
      }
    }
  })().catch((e) => console.error("Loop Telegram:", e));
}

/**
 * Envia o resumo diário se já passou do horário configurado e ainda não foi
 * enviado hoje. Horário em "telegram_resumo_hora" (HH:MM); vazio = desativado.
 */
async function verificarResumoDiario(token: string, chatPareado: string) {
  const hora = await obterConfig("telegram_resumo_hora");
  if (!hora) return;

  const hoje = hojeISO();
  if ((await obterConfig("telegram_resumo_ultimo")) === hoje) return;

  const agora = new Date();
  const [h, m] = hora.split(":").map(Number);
  const minutosAgora = agora.getHours() * 60 + agora.getMinutes();
  if (minutosAgora < h * 60 + m) return; // ainda não chegou o horário

  // Marca como enviado antes de gerar, para não duplicar em caso de erro/retentativa
  await salvarConfig("telegram_resumo_ultimo", hoje);
  const texto = await resumoDiario();
  if (texto) {
    await responder(token, Number(chatPareado), texto);
  }
}

/** Testa o token chamando getMe; retorna o nome de usuário do bot. */
export async function testarToken(token: string): Promise<string> {
  const resposta = (await invoke("telegram_api", {
    token,
    method: "getMe",
    payload: {},
  })) as { result?: { username?: string } };
  return resposta.result?.username ?? "bot";
}
