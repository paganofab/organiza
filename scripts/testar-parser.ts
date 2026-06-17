// Teste manual do parser: npx esbuild scripts/testar-parser.ts --bundle --format=esm | node --input-type=module
import {
  encontrarCategoriaPorTexto,
  interpretarCorrecao,
  interpretarLembrete,
  interpretarMensagem,
} from "../src/lib/parser";

const categorias = [
  { nome: "Água", tipo: "despesa" },
  { nome: "Energia", tipo: "despesa" },
  { nome: "Internet/Telefone", tipo: "despesa" },
  { nome: "Cartão de Crédito", tipo: "despesa" },
  { nome: "Alimentação", tipo: "despesa" },
  { nome: "Transporte", tipo: "despesa" },
  { nome: "Saúde", tipo: "despesa" },
  { nome: "Lazer", tipo: "despesa" },
  { nome: "Assinaturas", tipo: "despesa" },
  { nome: "Impostos", tipo: "despesa" },
  { nome: "Salário", tipo: "receita" },
  { nome: "Freelance/Extras", tipo: "receita" },
];

const hoje = "2026-06-11";

const casos = [
  "conta de agua 12 dezembro 250 reais",
  "luz vence dia 20 R$ 189,90",
  "internet 15/07 99,99",
  "fatura nubank 10/07 1.234,56",
  "netflix amanha 55 reais",
  "ipva 3x dia 9 412 reais",
  "receita freela site 30/06 2000",
  "salario dia 5 5500",
  "mercado 180 hoje",
  "ifood amanha 55 reais",
  "academia 89,90",
  "presente aniversario mae 18 de julho 150 reais",
  "luz 189,90 dia 20 // medidor trocado, leitura manual",
  "internet 99 15/07 obs: plano novo 500MB",
  "recebi 1500 freela #cliente Acme, projeto X",
  "so texto sem valor nenhum",
  "agua 12 dezembro 2027 250 reais",
  "iptu 12/12/2027 480",
  "seguro do carro dia 15 ano que vem 1.200,00",
  "luz 20/01 2028 100 reais",
];

for (const caso of casos) {
  const r = interpretarMensagem(caso, hoje, categorias);
  if (r.ok) {
    const c = r.conta;
    console.log(
      `OK   "${caso}"\n     -> ${c.tipo} | ${c.descricao} | R$ ${(c.valor_centavos / 100).toFixed(2)} | ${c.vencimento} | ${c.categoriaNome ?? "sem categoria"}${c.observacao ? ` | obs: ${c.observacao}` : ""}`,
    );
  } else {
    console.log(`ERRO "${caso}"\n     -> ${r.erro}`);
  }
}

console.log("\n--- categorias por texto ---");
const casosCategoria = [
  "comida",
  "delivery",
  "restaurante",
  "mercado",
  "cartao nubank",
  "algo sem categoria",
];
for (const caso of casosCategoria) {
  const c = encontrarCategoriaPorTexto(caso, categorias, "despesa");
  console.log(`"${caso}" -> ${c?.nome ?? "sem categoria"}`);
}

console.log("\n--- ano de datas passadas (hoje = 2026-06-16) ---");
const hoje16 = "2026-06-16";
const casosAno = [
  "gasolina subaru 180 14/06", // 2 dias atrás -> deve ficar em 2026
  "luz 10/06 200", // 6 dias atrás -> 2026
  "ipva 15 janeiro 480", // ~5 meses atrás -> 2027 (próxima ocorrência)
  "agua 20/06 90", // futuro próximo -> 2026
  "seguro 14/06/2028 1200", // ano explícito -> 2028
];
for (const caso of casosAno) {
  const r = interpretarMensagem(caso, hoje16, categorias);
  console.log(
    `"${caso}" -> ${r.ok ? r.conta.vencimento : "ERRO: " + r.erro}`,
  );
}

console.log("\n--- correções (vencimento atual: 2026-12-12) ---");
const correcoes = [
  "muda para 2027",
  "ano que vem",
  "para 15/01",
  "coloca para 10 de marco",
  "joga para o proximo ano",
  "isso nao e uma correcao",
];
for (const caso of correcoes) {
  console.log(
    `"${caso}" -> ${interpretarCorrecao(caso, hoje, "2026-12-12") ?? "não entendido"}`,
  );
}

console.log("\n--- lembretes (hoje = 2026-06-16, terça=16) ---");
const casosLemb = [
  "lembrar de levar o lixo amanha",
  "lembrete: pagar academia toda terca",
  "me lembra de ligar pro dentista dia 20 as 14:30",
  "lembrar comprar pao",
  "lembrete reuniao 25/06 10h",
  "lembrar de tomar remedio todo dia as 8",
  "gasolina 180", // NAO e lembrete -> null
];
for (const caso of casosLemb) {
  const l = interpretarLembrete(caso, "2026-06-16");
  console.log(
    `"${caso}" -> ${l ? `${l.titulo} | data=${l.data} | hora=${l.hora} | rec=${l.recorrencia}` : "null (nao e lembrete)"}`,
  );
}

console.log("\n--- lembretes preservando acentos ---");
const casosAcento = [
  "lembrar de ligar pro médico amanhã às 9h",
  "lembrete: pagar a Conta de Água toda terça",
  "me lembra de comprar pão na padaria",
  "lembrar de Reunião com José dia 25 14:30",
];
for (const caso of casosAcento) {
  const l = interpretarLembrete(caso, "2026-06-16");
  console.log(`"${caso}"\n   -> "${l?.titulo}" | data=${l?.data} | hora=${l?.hora} | rec=${l?.recorrencia}`);
}
