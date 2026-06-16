const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function formatarMoeda(centavos: number): string {
  return brl.format(centavos / 100);
}

/** Converte texto digitado ("1.234,56" ou "1234.56") para centavos. */
export function parseMoeda(texto: string): number {
  const limpo = texto.replace(/[^\d.,-]/g, "").trim();
  if (!limpo) return 0;
  // Formato brasileiro: vírgula como separador decimal
  const normalizado = limpo.includes(",")
    ? limpo.replace(/\./g, "").replace(",", ".")
    : limpo;
  const valor = parseFloat(normalizado);
  return isNaN(valor) ? 0 : Math.round(valor * 100);
}

export function hojeISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function formatarData(iso: string): string {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

export const MESES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

export const DIAS_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

/** "2026-06" → "Junho de 2026" */
export function nomeMesAno(anoMes: string): string {
  const [ano, mes] = anoMes.split("-").map(Number);
  return `${MESES[mes - 1]} de ${ano}`;
}

/** Soma meses a uma data ISO mantendo o dia quando possível (senão usa o último dia do mês). */
export function somarMeses(iso: string, meses: number): string {
  const [ano, mes, dia] = iso.split("-").map(Number);
  const totalMeses = ano * 12 + (mes - 1) + meses;
  const novoAno = Math.floor(totalMeses / 12);
  const novoMes = (totalMeses % 12) + 1;
  const ultimoDia = new Date(novoAno, novoMes, 0).getDate();
  const novoDia = Math.min(dia, ultimoDia);
  return `${novoAno}-${String(novoMes).padStart(2, "0")}-${String(novoDia).padStart(2, "0")}`;
}

/** Diferença em dias entre duas datas ISO (b - a). */
export function diffDias(a: string, b: string): number {
  const da = new Date(`${a}T00:00:00`);
  const db = new Date(`${b}T00:00:00`);
  return Math.round((db.getTime() - da.getTime()) / 86400000);
}
