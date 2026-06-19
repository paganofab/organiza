import Database from "@tauri-apps/plugin-sql";
import type {
  CartaoCredito,
  Categoria,
  Conta,
  Evento,
  FaturaCartao,
  LancamentoCartao,
  Lembrete,
  Membro,
  NovoCartaoCredito,
  NovaConta,
  NovoLancamentoCartao,
  PagamentoFaturaCartao,
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

export function somarMesAno(anoMes: string, meses: number): string {
  return somarMeses(`${anoMes}-01`, meses).slice(0, 7);
}

export function dataNoMes(anoMes: string, dia: number): string {
  const [ano, mes] = anoMes.split("-").map(Number);
  const ultimoDia = new Date(ano, mes, 0).getDate();
  const diaSeguro = Math.min(Math.max(dia, 1), ultimoDia);
  return `${anoMes}-${String(diaSeguro).padStart(2, "0")}`;
}

export function mesFaturaCartao(
  dataCompra: string,
  diaFechamento: number,
  diaVencimento: number,
): string {
  const anoMesCompra = dataCompra.slice(0, 7);
  const diaCompra = Number(dataCompra.slice(8, 10));
  const vencimentoNoMesmoMes = diaVencimento > diaFechamento;

  if (vencimentoNoMesmoMes) {
    return diaCompra <= diaFechamento
      ? anoMesCompra
      : somarMesAno(anoMesCompra, 1);
  }

  return diaCompra <= diaFechamento
    ? somarMesAno(anoMesCompra, 1)
    : somarMesAno(anoMesCompra, 2);
}

export function vencimentoFaturaCartao(
  anoMesFatura: string,
  diaVencimento: number,
): string {
  return dataNoMes(anoMesFatura, diaVencimento);
}

export function fechamentoFaturaCartao(
  anoMesFatura: string,
  diaFechamento: number,
  diaVencimento: number,
): string {
  const mesFechamento =
    diaVencimento > diaFechamento
      ? anoMesFatura
      : somarMesAno(anoMesFatura, -1);
  return dataNoMes(mesFechamento, diaFechamento);
}

export function calcularFaturasCartao(
  cartoes: CartaoCredito[],
  lancamentos: LancamentoCartao[],
  pagamentos: PagamentoFaturaCartao[] = [],
): FaturaCartao[] {
  const cartaoPorId = new Map(cartoes.map((c) => [c.id, c]));
  const pagamentoPorChave = new Map(
    pagamentos.map((p) => [`${p.cartao_id}:${p.ano_mes}`, p]),
  );
  const faturas = new Map<string, FaturaCartao>();

  for (const lancamento of lancamentos) {
    const cartao = cartaoPorId.get(lancamento.cartao_id);
    if (!cartao) continue;

    const anoMes = mesFaturaCartao(
      lancamento.data_compra,
      cartao.dia_fechamento,
      cartao.dia_vencimento,
    );
    const chave = `${cartao.id}:${anoMes}`;
    const pagamento = pagamentoPorChave.get(chave);
    const atual =
      faturas.get(chave) ??
      ({
        cartao_id: cartao.id,
        cartao_nome: cartao.nome,
        cartao_cor: cartao.cor,
        cartao_membro_id: cartao.membro_id,
        ano_mes: anoMes,
        fechamento: fechamentoFaturaCartao(
          anoMes,
          cartao.dia_fechamento,
          cartao.dia_vencimento,
        ),
        vencimento: vencimentoFaturaCartao(anoMes, cartao.dia_vencimento),
        status: pagamento?.status ?? "pendente",
        data_pagamento: pagamento?.data_pagamento ?? null,
        valor_bruto_centavos: 0,
        cashback_centavos: 0,
        valor_liquido_centavos: 0,
        qtd_lancamentos: 0,
        cashback_aplica_na_fatura: cartao.cashback_aplica_na_fatura,
      } satisfies FaturaCartao);

    atual.valor_bruto_centavos += lancamento.valor_centavos;
    atual.qtd_lancamentos += 1;
    if (lancamento.cashback_elegivel === 1 && cartao.cashback_percentual_bps > 0) {
      atual.cashback_centavos += Math.round(
        (lancamento.valor_centavos * cartao.cashback_percentual_bps) / 10000,
      );
    }
    atual.valor_liquido_centavos =
      atual.valor_bruto_centavos -
      (cartao.cashback_aplica_na_fatura === 1 ? atual.cashback_centavos : 0);
    faturas.set(chave, atual);
  }

  return [...faturas.values()].sort((a, b) =>
    a.vencimento === b.vencimento
      ? a.cartao_nome.localeCompare(b.cartao_nome)
      : a.vencimento.localeCompare(b.vencimento),
  );
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

export async function atualizarCategoria(
  id: number,
  campos: { nome: string; cor: string; icone: string },
) {
  const d = await getDb();
  await d.execute(
    "UPDATE categorias SET nome = $1, cor = $2, icone = $3 WHERE id = $4",
    [campos.nome, campos.cor, campos.icone, id],
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

// ---------- Membros da família ----------

export async function listarMembros(incluirInativos = false): Promise<Membro[]> {
  const d = await getDb();
  return d.select<Membro[]>(
    `SELECT * FROM membros ${incluirInativos ? "" : "WHERE ativo = 1"} ORDER BY ativo DESC, nome`,
  );
}

export async function criarMembro(nome: string, cor: string) {
  const d = await getDb();
  await d.execute("INSERT INTO membros (nome, cor) VALUES ($1, $2)", [
    nome,
    cor,
  ]);
}

export async function atualizarMembro(
  id: number,
  campos: { nome: string; cor: string; ativo: boolean },
) {
  const d = await getDb();
  await d.execute(
    "UPDATE membros SET nome = $1, cor = $2, ativo = $3 WHERE id = $4",
    [campos.nome, campos.cor, campos.ativo ? 1 : 0, id],
  );
}

// ---------- Cartões de crédito ----------

export async function listarCartoesCredito(
  incluirInativos = false,
): Promise<CartaoCredito[]> {
  const d = await getDb();
  return d.select<CartaoCredito[]>(
    `SELECT * FROM cartoes_credito ${incluirInativos ? "" : "WHERE ativo = 1"} ORDER BY ativo DESC, nome`,
  );
}

export async function criarCartaoCredito(campos: NovoCartaoCredito) {
  const d = await getDb();
  await d.execute(
    `INSERT INTO cartoes_credito
      (nome, emissor, cor, icone, membro_id, dia_fechamento, dia_vencimento, cashback_percentual_bps, cashback_aplica_na_fatura, ativo)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      campos.nome,
      campos.emissor,
      campos.cor,
      campos.icone,
      campos.membro_id,
      campos.dia_fechamento,
      campos.dia_vencimento,
      campos.cashback_percentual_bps,
      campos.cashback_aplica_na_fatura ? 1 : 0,
      campos.ativo ? 1 : 0,
    ],
  );
}

export async function atualizarCartaoCredito(
  id: number,
  campos: NovoCartaoCredito,
) {
  const d = await getDb();
  await d.execute(
    `UPDATE cartoes_credito
     SET nome = $1, emissor = $2, cor = $3, icone = $4, membro_id = $5,
         dia_fechamento = $6, dia_vencimento = $7,
         cashback_percentual_bps = $8, cashback_aplica_na_fatura = $9,
         ativo = $10
     WHERE id = $11`,
    [
      campos.nome,
      campos.emissor,
      campos.cor,
      campos.icone,
      campos.membro_id,
      campos.dia_fechamento,
      campos.dia_vencimento,
      campos.cashback_percentual_bps,
      campos.cashback_aplica_na_fatura ? 1 : 0,
      campos.ativo ? 1 : 0,
      id,
    ],
  );
}

export async function listarLancamentosCartao(filtro?: {
  cartaoId?: number;
  inicio?: string;
  fim?: string;
  categoriaId?: number;
  membroId?: number;
  familia?: boolean;
}): Promise<LancamentoCartao[]> {
  const d = await getDb();
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filtro?.cartaoId) {
    params.push(filtro.cartaoId);
    clauses.push(`cartao_id = $${params.length}`);
  }
  if (filtro?.inicio) {
    params.push(filtro.inicio);
    clauses.push(`data_compra >= $${params.length}`);
  }
  if (filtro?.fim) {
    params.push(filtro.fim);
    clauses.push(`data_compra <= $${params.length}`);
  }
  if (filtro?.categoriaId) {
    params.push(filtro.categoriaId);
    clauses.push(`categoria_id = $${params.length}`);
  }
  if (filtro?.membroId) {
    params.push(filtro.membroId);
    clauses.push(`membro_id = $${params.length}`);
  }
  if (filtro?.familia) {
    clauses.push("membro_id IS NULL");
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return d.select<LancamentoCartao[]>(
    `SELECT * FROM cartao_lancamentos ${where} ORDER BY data_compra DESC, id DESC`,
    params,
  );
}

export async function criarLancamentoCartao(campos: NovoLancamentoCartao) {
  const d = await getDb();
  const base =
    `INSERT INTO cartao_lancamentos
      (cartao_id, descricao, categoria_id, membro_id, valor_centavos, data_compra, observacoes, parcela_num, parcela_total, serie_id, cashback_elegivel)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`;

  const totalParcelas = Math.max(campos.parcela_total, 1);
  if (totalParcelas > 1) {
    const serie = crypto.randomUUID();
    for (let i = 0; i < totalParcelas; i++) {
      await d.execute(base, [
        campos.cartao_id,
        `${campos.descricao} (${i + 1}/${totalParcelas})`,
        campos.categoria_id,
        campos.membro_id,
        campos.valor_centavos,
        somarMeses(campos.data_compra, i),
        campos.observacoes,
        i + 1,
        totalParcelas,
        serie,
        campos.cashback_elegivel ? 1 : 0,
      ]);
    }
  } else {
    await d.execute(base, [
      campos.cartao_id,
      campos.descricao,
      campos.categoria_id,
      campos.membro_id,
      campos.valor_centavos,
      campos.data_compra,
      campos.observacoes,
      null,
      null,
      null,
      campos.cashback_elegivel ? 1 : 0,
    ]);
  }
}

export async function atualizarLancamentoCartao(
  id: number,
  campos: Omit<NovoLancamentoCartao, "parcela_total">,
) {
  const d = await getDb();
  await d.execute(
    `UPDATE cartao_lancamentos
     SET cartao_id = $1, descricao = $2, categoria_id = $3, membro_id = $4,
         valor_centavos = $5, data_compra = $6, observacoes = $7,
         cashback_elegivel = $8
     WHERE id = $9`,
    [
      campos.cartao_id,
      campos.descricao,
      campos.categoria_id,
      campos.membro_id,
      campos.valor_centavos,
      campos.data_compra,
      campos.observacoes,
      campos.cashback_elegivel ? 1 : 0,
      id,
    ],
  );
}

export async function excluirLancamentoCartao(id: number) {
  const d = await getDb();
  await d.execute("DELETE FROM cartao_lancamentos WHERE id = $1", [id]);
}

export async function listarPagamentosFaturaCartao(): Promise<
  PagamentoFaturaCartao[]
> {
  const d = await getDb();
  return d.select<PagamentoFaturaCartao[]>(
    "SELECT * FROM cartao_faturas ORDER BY ano_mes, cartao_id",
  );
}

export async function listarFaturasCartao(
  inicioAnoMes?: string,
  fimAnoMes?: string,
): Promise<FaturaCartao[]> {
  const [cartoes, lancamentos, pagamentos] = await Promise.all([
    listarCartoesCredito(true),
    listarLancamentosCartao(),
    listarPagamentosFaturaCartao(),
  ]);

  return calcularFaturasCartao(cartoes, lancamentos, pagamentos).filter((f) => {
    if (inicioAnoMes && f.ano_mes < inicioAnoMes) return false;
    if (fimAnoMes && f.ano_mes > fimAnoMes) return false;
    return true;
  });
}

export async function marcarFaturaCartaoPaga(
  cartaoId: number,
  anoMes: string,
  dataPagamento: string,
) {
  const d = await getDb();
  await d.execute(
    `INSERT INTO cartao_faturas (cartao_id, ano_mes, status, data_pagamento)
     VALUES ($1, $2, 'paga', $3)
     ON CONFLICT(cartao_id, ano_mes)
     DO UPDATE SET status = 'paga', data_pagamento = $3`,
    [cartaoId, anoMes, dataPagamento],
  );
}

export async function marcarFaturaCartaoPendente(
  cartaoId: number,
  anoMes: string,
) {
  const d = await getDb();
  await d.execute(
    `INSERT INTO cartao_faturas (cartao_id, ano_mes, status, data_pagamento)
     VALUES ($1, $2, 'pendente', NULL)
     ON CONFLICT(cartao_id, ano_mes)
     DO UPDATE SET status = 'pendente', data_pagamento = NULL`,
    [cartaoId, anoMes],
  );
}

// ---------- Contas ----------

export async function listarContas(filtro?: {
  anoMes?: string; // "YYYY-MM" — filtra por mês de vencimento
  status?: string;
  categoriaId?: number;
  membroId?: number;
  familia?: boolean;
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
  if (filtro?.membroId) {
    params.push(filtro.membroId);
    clauses.push(`membro_id = $${params.length}`);
  }
  if (filtro?.familia) {
    clauses.push("membro_id IS NULL");
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
    "INSERT INTO contas (descricao, categoria_id, membro_id, valor_centavos, vencimento, observacoes, tipo, serie_id, parcela_num, parcela_total, recorrente) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)";

  if (nova.parcelado && nova.parcela_total > 1) {
    const serie = crypto.randomUUID();
    for (let i = 0; i < nova.parcela_total; i++) {
      await d.execute(base, [
        `${nova.descricao} (${i + 1}/${nova.parcela_total})`,
        nova.categoria_id,
        nova.membro_id,
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
        nova.membro_id,
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
      nova.membro_id,
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
    membro_id: number | null;
    valor_centavos: number;
    vencimento: string;
    observacoes: string | null;
    tipo: string;
  },
) {
  const d = await getDb();
  await d.execute(
    "UPDATE contas SET descricao = $1, categoria_id = $2, membro_id = $3, valor_centavos = $4, vencimento = $5, observacoes = $6, tipo = $7, notificada = 0, email_enviado = 0 WHERE id = $8",
    [
      campos.descricao,
      campos.categoria_id,
      campos.membro_id,
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
  membro_id: number | null;
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
    "INSERT INTO lembretes (titulo, data, hora, recorrencia, observacoes, membro_id) VALUES ($1, $2, $3, $4, $5, $6)",
    [l.titulo, l.data, l.hora, l.recorrencia, l.observacoes, l.membro_id],
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
    "UPDATE lembretes SET titulo = $1, data = $2, hora = $3, recorrencia = $4, observacoes = $5, membro_id = $6, notificado = 0 WHERE id = $7",
    [l.titulo, l.data, l.hora, l.recorrencia, l.observacoes, l.membro_id, id],
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
