import Database from "@tauri-apps/plugin-sql";
import type {
  Categoria,
  Conta,
  Evento,
  Lembrete,
  NovaConta,
  SmtpConfig,
} from "./types";
import { somarMeses } from "./format";

// Avança uma data ISO conforme a recorrência (para lembretes recorrentes).
function proximaData(iso: string, recorrencia: string): string {
  if (recorrencia === "mensal") return somarMeses(iso, 1);
  const dias = recorrencia === "semanal" ? 7 : 1;
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + dias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Promise única e compartilhada: garante UMA só conexão mesmo com várias
// chamadas concorrentes no startup (senão criaríamos pools duplicados, e a
// escrita em segundo plano poderia não ser vista pela leitura da tela).
let dbPromise: Promise<Database> | null = null;

export function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = Database.load("sqlite:organiza.db").catch((e) => {
      dbPromise = null; // permite nova tentativa se a 1ª falhar
      throw e;
    });
  }
  return dbPromise;
}

// ---------- Categorias ----------

export async function listarCategorias(): Promise<Categoria[]> {
  const d = await getDb();
  return d.select<Categoria[]>("SELECT * FROM categorias ORDER BY tipo, nome");
}

export async function criarCategoria(
  nome: string,
  cor: string,
  icone: string,
  tipo: string,
) {
  const d = await getDb();
  await d.execute(
    "INSERT INTO categorias (nome, cor, icone, tipo) VALUES ($1, $2, $3, $4)",
    [nome, cor, icone, tipo],
  );
}

export async function excluirCategoria(id: number) {
  const d = await getDb();
  await d.execute("DELETE FROM categorias WHERE id = $1", [id]);
}

export async function definirOrcamento(id: number, centavos: number) {
  const d = await getDb();
  await d.execute("UPDATE categorias SET orcamento_centavos = $1 WHERE id = $2", [
    centavos,
    id,
  ]);
}

// ---------- Contas ----------

export async function listarContas(filtro?: {
  anoMes?: string; // "YYYY-MM" — filtra por mês de vencimento
  status?: string;
  categoriaId?: number;
  tipo?: string;
}): Promise<Conta[]> {
  const d = await getDb();
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filtro?.anoMes) {
    params.push(`${filtro.anoMes}%`);
    clauses.push(`vencimento LIKE $${params.length}`);
  }
  if (filtro?.status) {
    params.push(filtro.status);
    clauses.push(`status = $${params.length}`);
  }
  if (filtro?.categoriaId) {
    params.push(filtro.categoriaId);
    clauses.push(`categoria_id = $${params.length}`);
  }
  if (filtro?.tipo) {
    params.push(filtro.tipo);
    clauses.push(`tipo = $${params.length}`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return d.select<Conta[]>(
    `SELECT * FROM contas ${where} ORDER BY vencimento`,
    params,
  );
}

export async function contasEntre(inicio: string, fim: string): Promise<Conta[]> {
  const d = await getDb();
  return d.select<Conta[]>(
    "SELECT * FROM contas WHERE vencimento >= $1 AND vencimento <= $2 ORDER BY vencimento",
    [inicio, fim],
  );
}

/** Despesas pendentes até a data limite — base dos lembretes e alertas. */
export async function contasPendentesAte(dataLimite: string): Promise<Conta[]> {
  const d = await getDb();
  return d.select<Conta[]>(
    "SELECT * FROM contas WHERE status = 'pendente' AND tipo = 'despesa' AND vencimento <= $1 ORDER BY vencimento",
    [dataLimite],
  );
}

/** Despesas que vencem exatamente nesta data (qualquer status). */
export async function contasDoDia(data: string): Promise<Conta[]> {
  const d = await getDb();
  return d.select<Conta[]>(
    "SELECT * FROM contas WHERE vencimento = $1 AND tipo = 'despesa' ORDER BY valor_centavos DESC",
    [data],
  );
}

/**
 * Cria uma conta. Recorrentes geram uma ocorrência por mês; parceladas geram
 * uma conta por parcela. Ambas compartilham um serie_id.
 */
export async function criarConta(nova: NovaConta) {
  const d = await getDb();
  const base =
    "INSERT INTO contas (descricao, categoria_id, valor_centavos, vencimento, observacoes, tipo, serie_id, parcela_num, parcela_total, recorrente) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)";

  if (nova.parcelado && nova.parcela_total > 1) {
    const serie = crypto.randomUUID();
    for (let i = 0; i < nova.parcela_total; i++) {
      await d.execute(base, [
        `${nova.descricao} (${i + 1}/${nova.parcela_total})`,
        nova.categoria_id,
        nova.valor_centavos,
        somarMeses(nova.vencimento, i),
        nova.observacoes,
        nova.tipo,
        serie,
        i + 1,
        nova.parcela_total,
        0,
      ]);
    }
  } else if (nova.recorrente) {
    const serie = crypto.randomUUID();
    for (let i = 0; i < nova.meses_recorrencia; i++) {
      await d.execute(base, [
        nova.descricao,
        nova.categoria_id,
        nova.valor_centavos,
        somarMeses(nova.vencimento, i),
        nova.observacoes,
        nova.tipo,
        serie,
        null,
        null,
        1,
      ]);
    }
  } else {
    await d.execute(base, [
      nova.descricao,
      nova.categoria_id,
      nova.valor_centavos,
      nova.vencimento,
      nova.observacoes,
      nova.tipo,
      null,
      null,
      null,
      0,
    ]);
  }
}

export async function atualizarConta(
  id: number,
  campos: {
    descricao: string;
    categoria_id: number | null;
    valor_centavos: number;
    vencimento: string;
    observacoes: string | null;
    tipo: string;
  },
) {
  const d = await getDb();
  await d.execute(
    "UPDATE contas SET descricao = $1, categoria_id = $2, valor_centavos = $3, vencimento = $4, observacoes = $5, tipo = $6, notificada = 0, email_enviado = 0 WHERE id = $7",
    [
      campos.descricao,
      campos.categoria_id,
      campos.valor_centavos,
      campos.vencimento,
      campos.observacoes,
      campos.tipo,
      id,
    ],
  );
}

export async function obterConta(id: number): Promise<Conta | null> {
  const d = await getDb();
  const rows = await d.select<Conta[]>("SELECT * FROM contas WHERE id = $1", [id]);
  return rows.length ? rows[0] : null;
}

export async function atualizarCategoriaConta(
  id: number,
  categoriaId: number | null,
) {
  const d = await getDb();
  await d.execute("UPDATE contas SET categoria_id = $1 WHERE id = $2", [
    categoriaId,
    id,
  ]);
}

export async function obterUltimaConta(): Promise<Conta | null> {
  const d = await getDb();
  const rows = await d.select<Conta[]>(
    "SELECT * FROM contas ORDER BY id DESC LIMIT 1",
  );
  return rows.length ? rows[0] : null;
}

export async function atualizarVencimento(id: number, vencimento: string) {
  const d = await getDb();
  await d.execute(
    "UPDATE contas SET vencimento = $1, notificada = 0, email_enviado = 0 WHERE id = $2",
    [vencimento, id],
  );
}

export async function marcarPaga(id: number, dataPagamento: string) {
  const d = await getDb();
  await d.execute(
    "UPDATE contas SET status = 'paga', data_pagamento = $1 WHERE id = $2",
    [dataPagamento, id],
  );
}

export async function marcarPendente(id: number) {
  const d = await getDb();
  await d.execute(
    "UPDATE contas SET status = 'pendente', data_pagamento = NULL WHERE id = $1",
    [id],
  );
}

export async function excluirConta(id: number) {
  const d = await getDb();
  await d.execute("DELETE FROM contas WHERE id = $1", [id]);
}

/** Exclui esta e todas as ocorrências futuras da mesma série. */
export async function excluirSerieAPartirDe(serieId: string, vencimento: string) {
  const d = await getDb();
  await d.execute(
    "DELETE FROM contas WHERE serie_id = $1 AND vencimento >= $2 AND status = 'pendente'",
    [serieId, vencimento],
  );
}

export async function definirComprovante(id: number, caminho: string | null) {
  const d = await getDb();
  await d.execute("UPDATE contas SET comprovante = $1 WHERE id = $2", [
    caminho,
    id,
  ]);
}

export async function marcarNotificadas(ids: number[]) {
  if (!ids.length) return;
  const d = await getDb();
  await d.execute(
    `UPDATE contas SET notificada = 1 WHERE id IN (${ids.join(",")})`,
  );
}

export async function marcarEmailEnviado(ids: number[]) {
  if (!ids.length) return;
  const d = await getDb();
  await d.execute(
    `UPDATE contas SET email_enviado = 1 WHERE id IN (${ids.join(",")})`,
  );
}

// ---------- Eventos ----------

export async function eventosEntre(inicio: string, fim: string): Promise<Evento[]> {
  const d = await getDb();
  return d.select<Evento[]>(
    "SELECT * FROM eventos WHERE data >= $1 AND data <= $2 ORDER BY data, hora",
    [inicio, fim],
  );
}

export async function criarEvento(e: Omit<Evento, "id">) {
  const d = await getDb();
  await d.execute(
    "INSERT INTO eventos (titulo, data, hora, descricao, cor) VALUES ($1, $2, $3, $4, $5)",
    [e.titulo, e.data, e.hora, e.descricao, e.cor],
  );
}

export async function atualizarEvento(e: Evento) {
  const d = await getDb();
  await d.execute(
    "UPDATE eventos SET titulo = $1, data = $2, hora = $3, descricao = $4, cor = $5 WHERE id = $6",
    [e.titulo, e.data, e.hora, e.descricao, e.cor, e.id],
  );
}

export async function excluirEvento(id: number) {
  const d = await getDb();
  await d.execute("DELETE FROM eventos WHERE id = $1", [id]);
}

// ---------- Configurações ----------

export async function obterConfig(chave: string): Promise<string | null> {
  const d = await getDb();
  const rows = await d.select<{ valor: string }[]>(
    "SELECT valor FROM configuracoes WHERE chave = $1",
    [chave],
  );
  return rows.length ? rows[0].valor : null;
}

export async function salvarConfig(chave: string, valor: string) {
  const d = await getDb();
  await d.execute(
    "INSERT INTO configuracoes (chave, valor) VALUES ($1, $2) ON CONFLICT(chave) DO UPDATE SET valor = $2",
    [chave, valor],
  );
}

export async function obterSmtp(): Promise<SmtpConfig | null> {
  const json = await obterConfig("smtp");
  if (!json) return null;
  try {
    const cfg = JSON.parse(json) as SmtpConfig;
    return cfg.host && cfg.to ? cfg : null;
  } catch {
    return null;
  }
}

// ---------- Lembretes ----------

export interface NovoLembrete {
  titulo: string;
  data: string | null;
  hora: string | null;
  recorrencia: string;
  observacoes: string | null;
}

export async function listarLembretes(): Promise<Lembrete[]> {
  const d = await getDb();
  // Pendentes primeiro (por data, sem data ao fim), concluídos depois
  return d.select<Lembrete[]>(
    `SELECT * FROM lembretes
     ORDER BY concluido,
       CASE WHEN data IS NULL THEN 1 ELSE 0 END,
       data, hora, id`,
  );
}

export async function lembretesPendentesAte(data: string): Promise<Lembrete[]> {
  const d = await getDb();
  return d.select<Lembrete[]>(
    "SELECT * FROM lembretes WHERE concluido = 0 AND data IS NOT NULL AND data <= $1 ORDER BY data, hora",
    [data],
  );
}

export async function lembretesEntre(
  inicio: string,
  fim: string,
): Promise<Lembrete[]> {
  const d = await getDb();
  return d.select<Lembrete[]>(
    "SELECT * FROM lembretes WHERE data >= $1 AND data <= $2 ORDER BY data, hora",
    [inicio, fim],
  );
}

export async function criarLembrete(l: NovoLembrete) {
  const d = await getDb();
  await d.execute(
    "INSERT INTO lembretes (titulo, data, hora, recorrencia, observacoes) VALUES ($1, $2, $3, $4, $5)",
    [l.titulo, l.data, l.hora, l.recorrencia, l.observacoes],
  );
}

export async function obterLembrete(id: number): Promise<Lembrete | null> {
  const d = await getDb();
  const rows = await d.select<Lembrete[]>(
    "SELECT * FROM lembretes WHERE id = $1",
    [id],
  );
  return rows.length ? rows[0] : null;
}

export async function obterUltimoLembrete(): Promise<Lembrete | null> {
  const d = await getDb();
  const rows = await d.select<Lembrete[]>(
    "SELECT * FROM lembretes ORDER BY id DESC LIMIT 1",
  );
  return rows.length ? rows[0] : null;
}

export async function atualizarLembrete(id: number, l: NovoLembrete) {
  const d = await getDb();
  await d.execute(
    "UPDATE lembretes SET titulo = $1, data = $2, hora = $3, recorrencia = $4, observacoes = $5, notificado = 0 WHERE id = $6",
    [l.titulo, l.data, l.hora, l.recorrencia, l.observacoes, id],
  );
}

/**
 * Conclui um lembrete. Se for recorrente e tiver data, avança para a próxima
 * ocorrência e o mantém pendente (assim ele "se repete"); senão marca concluído.
 */
export async function concluirLembrete(id: number, hoje: string) {
  const d = await getDb();
  const rows = await d.select<Lembrete[]>(
    "SELECT * FROM lembretes WHERE id = $1",
    [id],
  );
  if (!rows.length) return;
  const l = rows[0];
  if (l.recorrencia !== "nenhuma" && l.data) {
    await d.execute(
      "UPDATE lembretes SET data = $1, notificado = 0 WHERE id = $2",
      [proximaData(l.data, l.recorrencia), id],
    );
  } else {
    await d.execute(
      "UPDATE lembretes SET concluido = 1, data_conclusao = $1 WHERE id = $2",
      [hoje, id],
    );
  }
}

export async function reabrirLembrete(id: number) {
  const d = await getDb();
  await d.execute(
    "UPDATE lembretes SET concluido = 0, data_conclusao = NULL WHERE id = $1",
    [id],
  );
}

export async function excluirLembrete(id: number) {
  const d = await getDb();
  await d.execute("DELETE FROM lembretes WHERE id = $1", [id]);
}

export async function marcarLembretesNotificados(ids: number[]) {
  if (!ids.length) return;
  const d = await getDb();
  await d.execute(
    `UPDATE lembretes SET notificado = 1 WHERE id IN (${ids.join(",")})`,
  );
}
