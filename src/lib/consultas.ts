import {
  contasEntre,
  listarCategorias,
  listarContas,
  listarLembretes,
} from "./db";
import { diffDias, formatarData, formatarMoeda, hojeISO } from "./format";
import { estaAtrasada, type Conta, type Lembrete } from "./types";

function soma(contas: Conta[]): number {
  return contas.reduce((t, c) => t + c.valor_centavos, 0);
}

/** Saldo do mês atual: receitas − despesas, com detalhamento. */
export async function respostaSaldo(): Promise<string> {
  const anoMes = hojeISO().slice(0, 7);
  const contas = await listarContas({ anoMes });
  const receitas = soma(contas.filter((c) => c.tipo === "receita"));
  const despesas = soma(contas.filter((c) => c.tipo === "despesa"));
  const saldo = receitas - despesas;
  const pago = soma(
    contas.filter((c) => c.tipo === "despesa" && c.status === "paga"),
  );
  return [
    `💰 Saldo do mês: ${formatarMoeda(saldo)}`,
    `Receitas: ${formatarMoeda(receitas)}`,
    `Despesas: ${formatarMoeda(despesas)} (pago: ${formatarMoeda(pago)})`,
  ].join("\n");
}

/** Quanto já foi gasto no mês, com as 3 maiores categorias. */
export async function respostaGastos(): Promise<string> {
  const anoMes = hojeISO().slice(0, 7);
  const [contas, categorias] = await Promise.all([
    listarContas({ anoMes, tipo: "despesa" }),
    listarCategorias(),
  ]);
  if (!contas.length) return "Nenhuma despesa lançada neste mês.";

  const catNome = new Map(categorias.map((c) => [c.id, c.nome]));
  const porCat = new Map<string, number>();
  for (const c of contas) {
    const nome = c.categoria_id ? catNome.get(c.categoria_id) ?? "Outros" : "Sem categoria";
    porCat.set(nome, (porCat.get(nome) ?? 0) + c.valor_centavos);
  }
  const top = [...porCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  return [
    `💸 Despesas do mês: ${formatarMoeda(soma(contas))}`,
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

  const contas = (await contasEntre(hoje, fimISO)).filter(
    (c) => c.tipo === "despesa" && c.status === "pendente",
  );
  if (!contas.length) return "🎉 Nada vencendo nos próximos 14 dias.";

  const linhas = contas.map((c) => {
    const dias = diffDias(hoje, c.vencimento);
    const quando = dias === 0 ? "hoje" : `em ${dias}d`;
    return `• ${c.descricao} — ${formatarMoeda(c.valor_centavos)} (${quando})`;
  });
  return [
    `⏰ Próximos vencimentos (${formatarMoeda(soma(contas))}):`,
    ...linhas,
  ].join("\n");
}

/** Contas atrasadas (pendentes vencidas). */
export async function respostaAtrasadas(): Promise<string> {
  const hoje = hojeISO();
  const contas = (await listarContas({ status: "pendente", tipo: "despesa" }))
    .filter((c) => estaAtrasada(c, hoje));
  if (!contas.length) return "✅ Nenhuma conta atrasada.";

  const linhas = contas.map(
    (c) =>
      `• ${c.descricao} — ${formatarMoeda(c.valor_centavos)} (venceu ${formatarData(c.vencimento)})`,
  );
  return [
    `🔴 Atrasadas (${formatarMoeda(soma(contas))}):`,
    ...linhas,
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
  const [pendentes, doDia, lembretes] = await Promise.all([
    listarContas({ status: "pendente", tipo: "despesa" }),
    listarContas({ anoMes: hoje.slice(0, 7), tipo: "despesa" }),
    listarLembretes(),
  ]);
  const atrasadas = pendentes.filter((c) => estaAtrasada(c, hoje));
  const hojeVencem = doDia.filter(
    (c) => c.vencimento === hoje && c.status === "pendente",
  );
  const lembHoje = lembretes.filter(
    (l) => !l.concluido && l.data && l.data <= hoje,
  );

  if (!atrasadas.length && !hojeVencem.length && !lembHoje.length) return null;

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
    return respostaGastos();
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
