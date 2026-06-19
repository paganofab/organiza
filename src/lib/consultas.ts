import {
  contasEntre,
  listarCategorias,
  listarContas,
  listarFaturasCartao,
  listarLancamentosCartao,
  listarLembretes,
} from "./db";
import { diffDias, formatarData, formatarMoeda, hojeISO } from "./format";
import { encontrarCategoriaPorTexto, normalizar } from "./parser";
import {
  estaAtrasada,
  type Categoria,
  type Conta,
  type LancamentoCartao,
  type Lembrete,
} from "./types";

function soma(contas: Conta[]): number {
  return contas.reduce((t, c) => t + c.valor_centavos, 0);
}

function somaLancamentos(lancamentos: LancamentoCartao[]): number {
  return lancamentos.reduce((t, l) => t + l.valor_centavos, 0);
}

function extrairTermoCategoriaGastos(texto: string): string | null {
  const t = normalizar(texto)
    .replace(/[?!.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const m = t.match(
    /\b(?:quanto\s+)?(?:gastei|gasto|gastos|despesas?|saiu|foi)\b.*?\b(?:com|em|de|da|do|no|na)\s+(.+)$/,
  );
  if (!m) return null;

  const termo = m[1]
    .replace(/\b(?:nesse|neste|esse|este)\s+mes\b.*$/, "")
    .replace(/\bmes\s+atual\b.*$/, "")
    .replace(/\b(?:hoje|ontem|essa\s+semana|esta\s+semana|semana)\b.*$/, "")
    .replace(/\b(?:ano|ano\s+atual)\b.*$/, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!termo || /^(?:mes|atual|semana|ano)$/.test(termo)) return null;
  return termo;
}

function categoriaConsultaGastos(
  texto: string,
  categorias: Categoria[],
): { termo: string; categoria: Categoria | null } | null {
  const termo = extrairTermoCategoriaGastos(texto);
  if (!termo) return null;
  return {
    termo,
    categoria:
      (encontrarCategoriaPorTexto(
        termo,
        categorias,
        "despesa",
      ) as Categoria | null) ?? null,
  };
}

/** Saldo do mês atual: receitas − despesas, com detalhamento. */
export async function respostaSaldo(): Promise<string> {
  const anoMes = hojeISO().slice(0, 7);
  const [contas, faturas] = await Promise.all([
    listarContas({ anoMes }),
    listarFaturasCartao(anoMes, anoMes),
  ]);
  const receitas = soma(contas.filter((c) => c.tipo === "receita"));
  const totalFaturas = faturas.reduce((t, f) => t + f.valor_liquido_centavos, 0);
  const despesas = soma(contas.filter((c) => c.tipo === "despesa")) + totalFaturas;
  const saldo = receitas - despesas;
  const pago =
    soma(contas.filter((c) => c.tipo === "despesa" && c.status === "paga")) +
    faturas
      .filter((f) => f.status === "paga")
      .reduce((t, f) => t + f.valor_liquido_centavos, 0);
  return [
    `💰 Saldo do mês: ${formatarMoeda(saldo)}`,
    `Receitas: ${formatarMoeda(receitas)}`,
    `Despesas: ${formatarMoeda(despesas)} (pago: ${formatarMoeda(pago)})`,
  ].join("\n");
}

/** Quanto já foi gasto no mês, opcionalmente filtrando por categoria. */
export async function respostaGastos(textoConsulta?: string): Promise<string> {
  const anoMes = hojeISO().slice(0, 7);
  const [contas, comprasCartao, categorias] = await Promise.all([
    listarContas({ anoMes, tipo: "despesa" }),
    listarLancamentosCartao({
      inicio: `${anoMes}-01`,
      fim: `${anoMes}-31`,
    }),
    listarCategorias(),
  ]);
  if (!contas.length && !comprasCartao.length) {
    return "Nenhuma despesa lançada neste mês.";
  }

  const filtro = textoConsulta
    ? categoriaConsultaGastos(textoConsulta, categorias)
    : null;

  if (filtro && !filtro.categoria) {
    const disponiveis = categorias
      .filter((c) => c.tipo === "despesa")
      .map((c) => c.nome)
      .join(", ");
    return `Não encontrei uma categoria para "${filtro.termo}". Categorias disponíveis: ${disponiveis}.`;
  }

  if (filtro?.categoria) {
    const filtradas = contas.filter(
      (c) => c.categoria_id === filtro.categoria!.id,
    );
    const comprasFiltradas = comprasCartao.filter(
      (l) => l.categoria_id === filtro.categoria!.id,
    );
    if (!filtradas.length && !comprasFiltradas.length) {
      return `Nenhuma despesa em ${filtro.categoria.nome} lançada neste mês.`;
    }

    const maiores = [
      ...filtradas.map((c) => ({
        descricao: c.descricao,
        valor_centavos: c.valor_centavos,
      })),
      ...comprasFiltradas.map((l) => ({
        descricao: `${l.descricao} (cartão)`,
        valor_centavos: l.valor_centavos,
      })),
    ]
      .sort((a, b) => b.valor_centavos - a.valor_centavos)
      .slice(0, 5);
    return [
      `💸 ${filtro.categoria.nome} neste mês: ${formatarMoeda(
        soma(filtradas) + somaLancamentos(comprasFiltradas),
      )}`,
      `${filtradas.length + comprasFiltradas.length} lançamento(s).`,
      "Maiores lançamentos:",
      ...maiores.map((c) => `• ${c.descricao}: ${formatarMoeda(c.valor_centavos)}`),
    ].join("\n");
  }

  const catNome = new Map(categorias.map((c) => [c.id, c.nome]));
  const porCat = new Map<string, number>();
  for (const c of contas) {
    const nome = c.categoria_id ? catNome.get(c.categoria_id) ?? "Outros" : "Sem categoria";
    porCat.set(nome, (porCat.get(nome) ?? 0) + c.valor_centavos);
  }
  for (const l of comprasCartao) {
    const nome = l.categoria_id ? catNome.get(l.categoria_id) ?? "Outros" : "Sem categoria";
    porCat.set(nome, (porCat.get(nome) ?? 0) + l.valor_centavos);
  }
  const top = [...porCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  return [
    `💸 Despesas do mês: ${formatarMoeda(soma(contas) + somaLancamentos(comprasCartao))}`,
    "Maiores categorias:",
    ...top.map(([nome, v]) => `• ${nome}: ${formatarMoeda(v)}`),
  ].join("\n");
}

/** Próximos vencimentos (despesas pendentes nos próximos 14 dias). */
export async function respostaProximos(): Promise<string> {
  const hoje = hojeISO();
  const fim = new Date(`${hoje}T00:00:00`);
  fim.setDate(fim.getDate() + 14);
  const fimISO = `${fim.getFullYear()}-${String(fim.getMonth() + 1).padStart(2, "0")}-${String(fim.getDate()).padStart(2, "0")}`;

  const [contasRaw, faturasRaw] = await Promise.all([
    contasEntre(hoje, fimISO),
    listarFaturasCartao(hoje.slice(0, 7), fimISO.slice(0, 7)),
  ]);
  const contas = contasRaw.filter(
    (c) => c.tipo === "despesa" && c.status === "pendente",
  );
  const faturas = faturasRaw.filter(
    (f) =>
      f.status === "pendente" &&
      f.vencimento >= hoje &&
      f.vencimento <= fimISO,
  );
  if (!contas.length && !faturas.length) {
    return "🎉 Nada vencendo nos próximos 14 dias.";
  }

  const linhasContas = contas.map((c) => {
    const dias = diffDias(hoje, c.vencimento);
    const quando = dias === 0 ? "hoje" : `em ${dias}d`;
    return `• ${c.descricao} — ${formatarMoeda(c.valor_centavos)} (${quando})`;
  });
  const linhasFaturas = faturas.map((f) => {
    const dias = diffDias(hoje, f.vencimento);
    const quando = dias === 0 ? "hoje" : `em ${dias}d`;
    return `• Fatura ${f.cartao_nome} — ${formatarMoeda(f.valor_liquido_centavos)} (${quando})`;
  });
  return [
    `⏰ Próximos vencimentos (${formatarMoeda(
      soma(contas) +
        faturas.reduce((t, f) => t + f.valor_liquido_centavos, 0),
    )}):`,
    ...linhasContas,
    ...linhasFaturas,
  ].join("\n");
}

/** Contas atrasadas (pendentes vencidas). */
export async function respostaAtrasadas(): Promise<string> {
  const hoje = hojeISO();
  const [contasRaw, faturasRaw] = await Promise.all([
    listarContas({ status: "pendente", tipo: "despesa" }),
    listarFaturasCartao(),
  ]);
  const contas = contasRaw.filter((c) => estaAtrasada(c, hoje));
  const faturas = faturasRaw.filter(
    (f) => f.status === "pendente" && f.vencimento < hoje,
  );
  if (!contas.length && !faturas.length) return "✅ Nenhuma conta atrasada.";

  const linhas = contas.map(
    (c) =>
      `• ${c.descricao} — ${formatarMoeda(c.valor_centavos)} (venceu ${formatarData(c.vencimento)})`,
  );
  const linhasFaturas = faturas.map(
    (f) =>
      `• Fatura ${f.cartao_nome} — ${formatarMoeda(f.valor_liquido_centavos)} (venceu ${formatarData(f.vencimento)})`,
  );
  return [
    `🔴 Atrasadas (${formatarMoeda(
      soma(contas) +
        faturas.reduce((t, f) => t + f.valor_liquido_centavos, 0),
    )}):`,
    ...linhas,
    ...linhasFaturas,
  ].join("\n");
}

/** Lembretes (tarefas) pendentes, atrasados e de hoje primeiro. */
export async function respostaLembretes(): Promise<string> {
  const hoje = hojeISO();
  const pend = (await listarLembretes()).filter((l) => !l.concluido);
  if (!pend.length) return "✅ Nenhum lembrete pendente.";

  const linha = (l: Lembrete) => {
    const quando =
      l.data === null
        ? "sem prazo"
        : l.data < hoje
          ? `atrasado (${formatarData(l.data)})`
          : l.data === hoje
            ? "hoje"
            : formatarData(l.data);
    return `• ${l.titulo} — ${quando}${l.hora ? ` ${l.hora}` : ""}`;
  };
  return [`📝 Lembretes pendentes (${pend.length}):`, ...pend.slice(0, 15).map(linha)].join(
    "\n",
  );
}

/**
 * Resumo matinal: atrasadas + contas que vencem hoje + lembretes do dia.
 * Retorna null quando não há nada a avisar (não envia mensagem nesse caso).
 */
export async function resumoDiario(): Promise<string | null> {
  const hoje = hojeISO();
  const [pendentes, doDia, faturas, lembretes] = await Promise.all([
    listarContas({ status: "pendente", tipo: "despesa" }),
    listarContas({ anoMes: hoje.slice(0, 7), tipo: "despesa" }),
    listarFaturasCartao(),
    listarLembretes(),
  ]);
  const atrasadas = pendentes.filter((c) => estaAtrasada(c, hoje));
  const hojeVencem = doDia.filter(
    (c) => c.vencimento === hoje && c.status === "pendente",
  );
  const faturasAtrasadas = faturas.filter(
    (f) => f.status === "pendente" && f.vencimento < hoje,
  );
  const faturasHoje = faturas.filter(
    (f) => f.status === "pendente" && f.vencimento === hoje,
  );
  const lembHoje = lembretes.filter(
    (l) => !l.concluido && l.data && l.data <= hoje,
  );

  if (
    !atrasadas.length &&
    !hojeVencem.length &&
    !faturasAtrasadas.length &&
    !faturasHoje.length &&
    !lembHoje.length
  ) {
    return null;
  }

  const partes: string[] = ["☀️ Bom dia! Resumo do Organiza:"];
  if (hojeVencem.length) {
    partes.push(
      "",
      `📅 Vencem hoje (${formatarMoeda(soma(hojeVencem))}):`,
      ...hojeVencem.map(
        (c) => `• ${c.descricao} — ${formatarMoeda(c.valor_centavos)}`,
      ),
    );
  }
  if (faturasHoje.length) {
    partes.push(
      "",
      `💳 Faturas vencem hoje (${formatarMoeda(
        faturasHoje.reduce((t, f) => t + f.valor_liquido_centavos, 0),
      )}):`,
      ...faturasHoje.map(
        (f) =>
          `• ${f.cartao_nome} — ${formatarMoeda(f.valor_liquido_centavos)}`,
      ),
    );
  }
  if (atrasadas.length) {
    partes.push(
      "",
      `🔴 Atrasadas (${formatarMoeda(soma(atrasadas))}):`,
      ...atrasadas
        .slice(0, 5)
        .map(
          (c) =>
            `• ${c.descricao} — ${formatarMoeda(c.valor_centavos)} (${formatarData(c.vencimento)})`,
        ),
    );
    if (atrasadas.length > 5) partes.push(`…e mais ${atrasadas.length - 5}.`);
  }
  if (faturasAtrasadas.length) {
    partes.push(
      "",
      `💳 Faturas atrasadas (${formatarMoeda(
        faturasAtrasadas.reduce((t, f) => t + f.valor_liquido_centavos, 0),
      )}):`,
      ...faturasAtrasadas
        .slice(0, 5)
        .map(
          (f) =>
            `• ${f.cartao_nome} — ${formatarMoeda(f.valor_liquido_centavos)} (${formatarData(f.vencimento)})`,
        ),
    );
    if (faturasAtrasadas.length > 5) {
      partes.push(`…e mais ${faturasAtrasadas.length - 5}.`);
    }
  }
  if (lembHoje.length) {
    partes.push(
      "",
      `📝 Lembretes (${lembHoje.length}):`,
      ...lembHoje
        .slice(0, 5)
        .map((l) => `• ${l.titulo}${l.hora ? ` (${l.hora})` : ""}`),
    );
  }
  return partes.join("\n");
}

/**
 * Tenta responder uma pergunta de consulta. Retorna o texto da resposta,
 * ou null se a mensagem não for uma consulta reconhecida.
 */
export async function tentarConsulta(texto: string): Promise<string | null> {
  const t = texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

  if (/\b(saldo|balanco|quanto sobrou|quanto tenho)\b/.test(t)) {
    return respostaSaldo();
  }
  if (/\b(gast|despesa|quanto gastei|quanto saiu)\w*/.test(t)) {
    return respostaGastos(t);
  }
  if (/\b(atrasad|vencid|devendo)\w*/.test(t)) {
    return respostaAtrasadas();
  }
  if (
    /\b(proxim|venciment|a vencer|a pagar|o que vence|quais contas)\w*/.test(t)
  ) {
    return respostaProximos();
  }
  return null;
}
