import { diffDias, parseMoeda } from "./format";

export interface ContaInterpretada {
  descricao: string;
  valor_centavos: number;
  vencimento: string; // ISO
  categoriaNome: string | null;
  tipo: "despesa" | "receita";
  observacao: string | null;
}

// Nota livre: tudo após "//", "#", "obs:" ou "nota:" vira observação da conta.
// Exige ":" nas palavras para não casar acidentalmente dentro do texto.
const MARCADOR_NOTA =
  /(?:\/\/|#|\b(?:obs|nota|observa[cç][aã]o)\s*:)\s*(.*)$/i;

const MESES_NOMES: Record<string, number> = {
  janeiro: 1, jan: 1,
  fevereiro: 2, fev: 2,
  marco: 3, mar: 3,
  abril: 4, abr: 4,
  maio: 5, mai: 5,
  junho: 6, jun: 6,
  julho: 7, jul: 7,
  agosto: 8, ago: 8,
  setembro: 9, set: 9,
  outubro: 10, out: 10,
  novembro: 11, nov: 11,
  dezembro: 12, dez: 12,
};

// palavra-chave normalizada → nome canônico da categoria
const PALAVRAS_CATEGORIA: [RegExp, string][] = [
  [/\b(agua|saneamento|sabesp)\b/, "Água"],
  [/\b(luz|energia|eletrica|enel|cemig|copel|light)\b/, "Energia"],
  [/\b(internet|wifi|telefone|celular|vivo|claro|tim|oi|fibra)\b/, "Internet/Telefone"],
  [/\b(aluguel|condominio|moradia|imobiliaria)\b/, "Moradia"],
  [/\b(cartao|fatura|nubank|credito)\b/, "Cartão de Crédito"],
  [/\b(uber|gasolina|combustivel|onibus|metro|estacionamento|pedagio|transporte|carro|mecanico)\b/, "Transporte"],
  [/\b(medico|dentista|farmacia|remedio|consulta|exame|saude|academia)\b/, "Saúde"],
  [/\b(escola|faculdade|curso|mensalidade|educacao|livro)\b/, "Educação"],
  [/\b(cinema|show|viagem|restaurante|bar|lazer|festa|presente)\b/, "Lazer"],
  [/\b(netflix|spotify|disney|hbo|max|prime|youtube|assinatura|streaming|icloud)\b/, "Assinaturas"],
  [/\b(imposto|iptu|ipva|darf|taxa|multa)\b/, "Impostos"],
  [/\b(salario|pagamento|holerite)\b/, "Salário"],
  [/\b(freela|freelance|bico|extra)\b/, "Freelance/Extras"],
  [/\b(dividendo|rendimento|juros|investimento)\b/, "Investimentos"],
  [/\b(reembolso|estorno)\b/, "Reembolsos"],
];

export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

const DIAS_SEMANA_NOME: Record<string, number> = {
  domingo: 0,
  segunda: 1,
  terca: 2,
  quarta: 3,
  quinta: 4,
  sexta: 5,
  sabado: 6,
};

/** Pr\u00f3xima data (>= hoje) que cai no dia da semana indicado. */
function proximoDiaSemana(hoje: string, alvo: number): string {
  const d = new Date(`${hoje}T00:00:00`);
  const delta = (alvo - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dataISO(ano: number, mes: number, dia: number): string {
  // Ajusta dia para o último do mês quando necessário (ex: 31 fev)
  const ultimo = new Date(ano, mes, 0).getDate();
  const d = Math.min(dia, ultimo);
  return `${ano}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const ANO_QUE_VEM = /\b(?:no\s+)?(?:ano que vem|proximo ano|ano seguinte)\b/;
const ANO_SOLTO = /(?<![\d/.,-])\b(20\d{2})\b(?![\d/])/;

/** Um número solto só é tratado como ano se for plausível (atual até +10);
 *  fora disso, é valor (ex: "2000" em "freela 2000"). */
function anoSoltoValido(
  texto: string,
  anoHoje: number,
): RegExpMatchArray | null {
  const m = texto.match(ANO_SOLTO);
  if (!m) return null;
  const ano = Number(m[1]);
  return ano >= anoHoje && ano <= anoHoje + 10 ? m : null;
}

/**
 * Extrai a data do texto normalizado.
 * Retorna a data ISO e os trechos a remover do texto, ou null.
 */
function extrairData(
  texto: string,
  hoje: string,
): { iso: string; trechos: string[] } | null {
  const [anoHoje, mesHoje, diaHoje] = hoje.split("-").map(Number);
  const trechos: string[] = [];

  // Modificadores de ano: "ano que vem" ou um ano explícito ("2027")
  let somaAno = 0;
  const proxAno = texto.match(ANO_QUE_VEM);
  if (proxAno) {
    somaAno = 1;
    trechos.push(proxAno[0]);
  }
  const anoSolto = anoSoltoValido(texto, anoHoje);

  // Resolve o ano final dado o que veio junto da data
  function resolverAno(anoExplicito: number | null, isoSemAno: (ano: number) => string): number {
    if (anoExplicito) return anoExplicito;
    if (anoSolto) {
      trechos.push(anoSolto[0]);
      return Number(anoSolto[1]);
    }
    if (somaAno) return anoHoje + somaAno;
    // Sem ano: usa o ano atual. Só joga para o ano seguinte se a data já passou
    // há bastante tempo (> 60 dias) — uma conta vencida há poucos dias é deste
    // ano (conta atrasada), não do ano que vem.
    const candidato = isoSemAno(anoHoje);
    if (candidato >= hoje) return anoHoje;
    return diffDias(candidato, hoje) > 60 ? anoHoje + 1 : anoHoje;
  }

  if (/\bamanha\b/.test(texto)) {
    const d = new Date(anoHoje, mesHoje - 1, diaHoje + 1);
    return {
      iso: dataISO(d.getFullYear(), d.getMonth() + 1, d.getDate()),
      trechos: [...trechos, "amanha"],
    };
  }
  if (/\bhoje\b/.test(texto)) {
    return { iso: hoje, trechos: [...trechos, "hoje"] };
  }

  // dd/mm ou dd-mm, ano opcional
  const numerica = texto.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (numerica) {
    const dia = Number(numerica[1]);
    const mes = Number(numerica[2]);
    if (mes >= 1 && mes <= 12 && dia >= 1 && dia <= 31) {
      const explicito = numerica[3]
        ? Number(numerica[3].length === 2 ? `20${numerica[3]}` : numerica[3])
        : null;
      const ano = resolverAno(explicito, (a) => dataISO(a, mes, dia));
      return { iso: dataISO(ano, mes, dia), trechos: [...trechos, numerica[0]] };
    }
  }

  // "12 dezembro", "12 de dezembro 2027", "12 dez"
  const porNome = texto.match(
    /\b(\d{1,2})\s*(?:de\s+)?(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\b(?:\s*(?:de\s+)?(20\d{2})\b)?/,
  );
  if (porNome) {
    const dia = Number(porNome[1]);
    const mes = MESES_NOMES[porNome[2]];
    const explicito = porNome[3] ? Number(porNome[3]) : null;
    const ano = resolverAno(explicito, (a) => dataISO(a, mes, dia));
    return { iso: dataISO(ano, mes, dia), trechos: [...trechos, porNome[0]] };
  }

  // "dia 12" → este mês, ou o próximo se já passou
  const diaSolto = texto.match(/\bdia\s+(\d{1,2})\b/);
  if (diaSolto) {
    const dia = Number(diaSolto[1]);
    let ano = anoHoje;
    let mes = mesHoje;
    if (anoSolto) {
      trechos.push(anoSolto[0]);
      ano = Number(anoSolto[1]);
    } else if (somaAno) {
      ano += somaAno;
    } else if (dia < diaHoje) {
      mes += 1;
      if (mes > 12) {
        mes = 1;
        ano += 1;
      }
    }
    return { iso: dataISO(ano, mes, dia), trechos: [...trechos, diaSolto[0]] };
  }

  return null;
}

/**
 * Interpreta uma mensagem de correção de data da última conta
 * ("muda para 2027", "ano que vem", "para 15/01").
 * Retorna o novo vencimento ou null se não entendeu.
 */
export function interpretarCorrecao(
  original: string,
  hoje: string,
  vencimentoAtual: string,
): string | null {
  const texto = normalizar(original).replace(/\s+/g, " ").trim();
  const [ano, mes, dia] = vencimentoAtual.split("-").map(Number);

  const data = extrairData(texto, hoje);
  if (data) return data.iso;

  // Só o ano: mantém dia/mês da conta
  const anoSolto = anoSoltoValido(texto, Number(hoje.slice(0, 4)));
  if (anoSolto) return dataISO(Number(anoSolto[1]), mes, dia);
  if (ANO_QUE_VEM.test(texto)) return dataISO(ano + 1, mes, dia);

  return null;
}

/** Extrai o valor; retorna [centavos, trecho casado] ou null. */
function extrairValor(texto: string): [number, string] | null {
  const comSimbolo = texto.match(/r\$\s*([\d.]+(?:,\d{1,2})?|\d+(?:\.\d{1,2})?)/);
  if (comSimbolo) return [parseMoeda(comSimbolo[1]), comSimbolo[0]];

  const comUnidade = texto.match(
    /([\d.]+(?:,\d{1,2})?|\d+(?:\.\d{1,2})?)\s*(?:reais|real|conto|contos|pila|pilas)\b/,
  );
  if (comUnidade) return [parseMoeda(comUnidade[1]), comUnidade[0]];

  // Último número solto do texto (depois da data já removida)
  const numeros = [
    ...texto.matchAll(
      /(?<![\d/,.-])(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)(?![\d/])/g,
    ),
  ];
  if (numeros.length) {
    const ultimo = numeros[numeros.length - 1];
    return [parseMoeda(ultimo[1]), ultimo[0]];
  }
  return null;
}

/**
 * Interpreta uma mensagem como "conta de agua 12 dezembro 250 reais".
 * Retorna a conta extraída ou um erro explicando o que faltou.
 */
export function interpretarMensagem(
  original: string,
  hoje: string,
  categorias: { nome: string; tipo: string }[],
): { ok: true; conta: ContaInterpretada } | { ok: false; erro: string } {
  // Extrai a observação livre do texto ORIGINAL (preserva acentos/maiúsculas)
  // e remove esse trecho antes de analisar valor/data/categoria.
  let observacao: string | null = null;
  let base = original;
  const mNota = original.match(MARCADOR_NOTA);
  if (mNota && mNota.index !== undefined) {
    observacao = mNota[1].trim() || null;
    base = original.slice(0, mNota.index);
  }

  let texto = normalizar(base).replace(/\s+/g, " ").trim();
  if (!texto) return { ok: false, erro: "Mensagem vazia." };

  // Tipo: mensagens começando com "receita"/"recebi"/"entrada" viram receita
  let tipo: "despesa" | "receita" = "despesa";
  const marcaReceita = texto.match(/^(receita|recebi|entrada)\b\s*/);
  if (marcaReceita) {
    tipo = "receita";
    texto = texto.slice(marcaReceita[0].length);
  }

  const data = extrairData(texto, hoje);
  if (data) {
    for (const trecho of data.trechos) {
      texto = texto.replace(trecho, " ");
    }
  }

  const valor = extrairValor(texto);
  if (!valor || valor[0] <= 0) {
    return {
      ok: false,
      erro: 'Não achei o valor. Inclua algo como "250 reais" ou "R$ 250,00".',
    };
  }
  texto = texto.replace(valor[1], " ");

  // Categoria: palavra-chave ou nome direto da categoria
  let categoriaNome: string | null = null;
  for (const [regex, nome] of PALAVRAS_CATEGORIA) {
    if (regex.test(texto)) {
      categoriaNome = nome;
      break;
    }
  }
  if (!categoriaNome) {
    for (const c of categorias) {
      if (c.tipo === tipo && texto.includes(normalizar(c.nome))) {
        categoriaNome = c.nome;
        break;
      }
    }
  }
  // Se a palavra-chave indicou categoria de receita, ajusta o tipo
  if (categoriaNome) {
    const cat = categorias.find(
      (c) => normalizar(c.nome) === normalizar(categoriaNome!),
    );
    if (cat) {
      categoriaNome = cat.nome;
      if (cat.tipo === "receita") tipo = "receita";
    } else {
      categoriaNome = null;
    }
  }

  // Descrição: o que sobrou, sem conectores soltos
  const descricao = texto
    .replace(/\b(conta|boleto|fatura)\s+(de|da|do)\b/g, " ")
    .replace(/\b(de|da|do|no|na|em|para|pra|vence|vencimento|pagar)\b/g, " ")
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  const descricaoFinal = descricao
    ? descricao.charAt(0).toUpperCase() + descricao.slice(1)
    : categoriaNome ?? (tipo === "receita" ? "Receita" : "Conta");

  return {
    ok: true,
    conta: {
      descricao: descricaoFinal,
      valor_centavos: valor[0],
      vencimento: data ? data.iso : hoje,
      categoriaNome,
      tipo,
      observacao,
    },
  };
}

// ---------- Lembretes (tarefas) ----------

export interface LembreteInterpretado {
  titulo: string;
  data: string | null;
  hora: string | null;
  recorrencia: "nenhuma" | "diario" | "semanal" | "mensal";
}

const GATILHO_LEMBRETE = /^\s*(?:me\s+)?(?:lembr(?:ar|ete|a|e))\b[:\s]*(?:de\s+|que\s+|pra\s+|para\s+)?/i;

/**
 * Interpreta "lembrar de X", "lembrete: X amanhã", "me lembra de Y toda terça".
 * Retorna o lembrete, ou null se a mensagem não começa com gatilho de lembrete.
 */
export function interpretarLembrete(
  original: string,
  hoje: string,
): LembreteInterpretado | null {
  const gat = original.match(GATILHO_LEMBRETE);
  if (!gat) return null;

  // `resto` preserva o texto original (acentos/maiúsculas); `norm` é a versão
  // normalizada, alinhada caractere a caractere (a normalização preserva o
  // comprimento para texto em português). Encontramos os trechos em `norm` e os
  // removemos por POSIÇÃO de `resto`, mantendo o título no formato original.
  const resto = original.slice(gat[0].length);
  let norm = normalizar(resto);
  if (!norm.trim()) return null;

  const removidos: boolean[] = new Array(resto.length).fill(false);
  const mascarar = (inicio: number, fim: number) => {
    for (let i = inicio; i < fim; i++) removidos[i] = true;
    norm = norm.slice(0, inicio) + " ".repeat(fim - inicio) + norm.slice(fim);
  };
  // Casa um regex em `norm` e remove o trecho casado (retorna o match).
  const consumir = (re: RegExp): RegExpMatchArray | null => {
    const m = norm.match(re);
    if (m && m.index !== undefined) mascarar(m.index, m.index + m[0].length);
    return m;
  };

  let recorrencia: LembreteInterpretado["recorrencia"] = "nenhuma";
  let data: string | null = null;
  let hora: string | null = null;

  // Recorrência por palavra-chave
  const recMap: [RegExp, LembreteInterpretado["recorrencia"]][] = [
    [/\b(todo dia|todos os dias|diariamente|diario)\b/, "diario"],
    [/\b(toda semana|semanalmente|semanal)\b/, "semanal"],
    [/\b(todo mes|mensalmente|mensal)\b/, "mensal"],
  ];
  for (const [re, rec] of recMap) {
    if (consumir(re)) {
      recorrencia = rec;
      break;
    }
  }

  // Dia da semana ("toda terça", "na sexta", "segunda")
  const md = consumir(
    /\b(toda|todo|na|no|nesta|nesse)?\s*(domingo|segunda|terca|quarta|quinta|sexta|sabado)(?:-?feira)?\b/,
  );
  if (md) {
    data = proximoDiaSemana(hoje, DIAS_SEMANA_NOME[md[2]]);
    if ((md[1] === "toda" || md[1] === "todo") && recorrencia === "nenhuma") {
      recorrencia = "semanal";
    }
  } else {
    // Datas explícitas (amanhã, hoje, dd/mm, DD mês, dia X)
    const dt = extrairData(norm, hoje);
    if (dt) {
      data = dt.iso;
      for (const t of dt.trechos) {
        const i = norm.indexOf(t);
        if (i >= 0) mascarar(i, i + t.length);
      }
    }
  }

  // Hora: "às 14:30", "14h", "14h30", "às 8", "as 8 horas"
  let mh = consumir(/\b[a]s\s+(\d{1,2})(?:[:h](\d{2})?)?(?:\s*horas?)?\b/);
  if (!mh) mh = consumir(/\b(\d{1,2})(?::(\d{2})|h(\d{2})?)\b/);
  if (mh) {
    const h = Number(mh[1]);
    const min = mh[2] ?? mh[3] ?? "00";
    if (h <= 23) hora = `${String(h).padStart(2, "0")}:${min.padStart(2, "0")}`;
  }

  // Título: remove do ORIGINAL os trechos marcados, preservando acentos/maiúsc.
  let titulo = [...resto]
    .map((ch, i) => (removidos[i] ? " " : ch))
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:de|do|da|que|para|pra)\s+/i, "")
    .trim();

  const tituloFinal = titulo
    ? titulo.charAt(0).toUpperCase() + titulo.slice(1)
    : "Lembrete";

  return { titulo: tituloFinal, data, hora, recorrencia };
}
