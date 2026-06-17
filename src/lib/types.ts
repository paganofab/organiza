export type StatusConta = "pendente" | "paga";
export type TipoConta = "despesa" | "receita";

export interface Categoria {
  id: number;
  nome: string;
  cor: string;
  icone: string;
  orcamento_centavos: number; // 0 = sem orçamento definido
  tipo: TipoConta;
}

export interface Membro {
  id: number;
  nome: string;
  cor: string;
  ativo: number;
  criado_em: string;
}

export interface Conta {
  id: number;
  descricao: string;
  categoria_id: number | null;
  membro_id: number | null;
  valor_centavos: number;
  vencimento: string; // YYYY-MM-DD
  status: StatusConta;
  data_pagamento: string | null;
  serie_id: string | null;
  parcela_num: number | null;
  parcela_total: number | null;
  recorrente: number;
  comprovante: string | null;
  observacoes: string | null;
  notificada: number;
  email_enviado: number;
  tipo: TipoConta;
}

export interface Evento {
  id: number;
  titulo: string;
  data: string; // YYYY-MM-DD
  hora: string | null;
  descricao: string | null;
  cor: string;
}

export type Recorrencia = "nenhuma" | "diario" | "semanal" | "mensal";

export interface Lembrete {
  id: number;
  titulo: string;
  data: string | null; // YYYY-MM-DD ou null (tarefa sem data)
  hora: string | null;
  recorrencia: Recorrencia;
  concluido: number;
  data_conclusao: string | null;
  notificado: number;
  observacoes: string | null;
  membro_id: number | null;
}

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
  to: string;
}

export interface NovaConta {
  descricao: string;
  categoria_id: number | null;
  membro_id: number | null;
  valor_centavos: number;
  vencimento: string;
  observacoes: string | null;
  tipo: TipoConta;
  recorrente: boolean;
  meses_recorrencia: number;
  parcelado: boolean;
  parcela_total: number;
}

/** Conta atrasada = pendente com vencimento anterior a hoje. */
export function estaAtrasada(c: Conta, hoje: string): boolean {
  return c.status === "pendente" && c.vencimento < hoje;
}
