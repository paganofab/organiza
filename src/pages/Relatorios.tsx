import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChartPie,
  CircleCheck,
  Download,
  FolderOpen,
  TrendingUp,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { contasEntre, listarCategorias } from "../lib/db";
import { exportarCsv } from "../lib/csv";
import {
  MESES,
  formatarData,
  formatarMoeda,
  hojeISO,
  nomeMesAno,
  somarMeses,
} from "../lib/format";
import type { Categoria, Conta } from "../lib/types";

type Periodo = 3 | 6 | 12;

export default function Relatorios() {
  const hoje = hojeISO();
  const anoMesAtual = hoje.slice(0, 7);
  const [periodo, setPeriodo] = useState<Periodo>(6);
  const [contas, setContas] = useState<Conta[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [mesSelecionado, setMesSelecionado] = useState(anoMesAtual);
  const [exportado, setExportado] = useState(false);

  const inicioPeriodo = useMemo(
    () => somarMeses(`${anoMesAtual}-01`, -(periodo - 1)),
    [anoMesAtual, periodo],
  );

  const carregar = useCallback(async () => {
    const fim = `${anoMesAtual}-31`;
    const [cs, cats] = await Promise.all([
      contasEntre(inicioPeriodo, fim),
      listarCategorias(),
    ]);
    setContas(cs);
    setCategorias(cats);
  }, [inicioPeriodo, anoMesAtual]);

  useEffect(() => {
    carregar().catch(console.error);
  }, [carregar]);

  const catPorId = useMemo(
    () => new Map(categorias.map((c) => [c.id, c])),
    [categorias],
  );

  const mesesDoPeriodo = useMemo(() => {
    const lista: string[] = [];
    for (let i = 0; i < periodo; i++) {
      lista.push(somarMeses(inicioPeriodo, i).slice(0, 7));
    }
    return lista;
  }, [inicioPeriodo, periodo]);

  // Evolução mensal: total, pago e pendente por mês
  const evolucao = useMemo(() => {
    return mesesDoPeriodo.map((am) => {
      const doMes = contas.filter((c) => c.vencimento.startsWith(am));
      const despesas = doMes.filter((c) => c.tipo === "despesa");
      const [, m] = am.split("-").map(Number);
      return {
        mes: MESES[m - 1].slice(0, 3),
        anoMes: am,
        total: despesas.reduce((t, c) => t + c.valor_centavos, 0) / 100,
        pago:
          despesas
            .filter((c) => c.status === "paga")
            .reduce((t, c) => t + c.valor_centavos, 0) / 100,
        receitas:
          doMes
            .filter((c) => c.tipo === "receita")
            .reduce((t, c) => t + c.valor_centavos, 0) / 100,
      };
    });
  }, [contas, mesesDoPeriodo]);

  // Gastos por categoria no mês selecionado (apenas despesas)
  const contasDoMes = useMemo(
    () =>
      contas.filter(
        (c) => c.vencimento.startsWith(mesSelecionado) && c.tipo === "despesa",
      ),
    [contas, mesSelecionado],
  );

  const porCategoria = useMemo(() => {
    const mapa = new Map<string, { nome: string; cor: string; valor: number; qtd: number }>();
    for (const c of contasDoMes) {
      const cat = c.categoria_id ? catPorId.get(c.categoria_id) : undefined;
      const chave = cat?.nome ?? "Sem categoria";
      const atual = mapa.get(chave) ?? {
        nome: chave,
        cor: cat?.cor ?? "#a3a3a3",
        valor: 0,
        qtd: 0,
      };
      atual.valor += c.valor_centavos;
      atual.qtd += 1;
      mapa.set(chave, atual);
    }
    return [...mapa.values()].sort((a, b) => b.valor - a.valor);
  }, [contasDoMes, catPorId]);

  const totalMes = porCategoria.reduce((t, c) => t + c.valor, 0);

  async function exportar() {
    const linhas = contas.map((c) => {
      const cat = c.categoria_id ? catPorId.get(c.categoria_id) : undefined;
      return [
        c.descricao,
        c.tipo === "receita" ? "Receita" : "Despesa",
        cat?.nome ?? "Sem categoria",
        formatarData(c.vencimento),
        (c.valor_centavos / 100).toFixed(2).replace(".", ","),
        c.status === "paga"
          ? c.tipo === "receita"
            ? "Recebida"
            : "Paga"
          : c.tipo === "despesa" && c.vencimento < hoje
            ? "Atrasada"
            : "Pendente",
        c.data_pagamento ? formatarData(c.data_pagamento) : "",
        c.parcela_num ? `${c.parcela_num}/${c.parcela_total}` : "",
        c.observacoes ?? "",
      ];
    });
    const ok = await exportarCsv(
      `organiza-contas-${inicioPeriodo.slice(0, 7)}-a-${anoMesAtual}.csv`,
      ["Descrição", "Tipo", "Categoria", "Vencimento", "Valor (R$)", "Status", "Pago em", "Parcela", "Observações"],
      linhas,
    );
    if (ok) {
      setExportado(true);
      setTimeout(() => setExportado(false), 4000);
    }
  }

  return (
    <div>
      <div className="cabecalho-pagina">
        <div>
          <h1>Relatórios</h1>
          <div className="subtitulo">
            Período: últimos {periodo} meses (desde {nomeMesAno(inicioPeriodo.slice(0, 7))})
          </div>
        </div>
        <div className="filtros" style={{ margin: 0 }}>
          <select
            value={periodo}
            onChange={(e) => setPeriodo(Number(e.target.value) as Periodo)}
          >
            <option value={3}>Últimos 3 meses</option>
            <option value={6}>Últimos 6 meses</option>
            <option value={12}>Últimos 12 meses</option>
          </select>
          <button className="btn-primario" onClick={exportar}>
            <Download size={16} /> Exportar CSV
          </button>
        </div>
      </div>

      {exportado && (
        <div className="toast-ok">
          <CircleCheck size={16} /> CSV exportado com sucesso!
        </div>
      )}

      <div className="cards-resumo">
        <div className="card" style={{ gridColumn: "1 / -1" }}>
          <h2>
            <TrendingUp size={16} color="var(--accent)" /> Evolução mensal
          </h2>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={evolucao}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="mes" />
              <YAxis
                tickFormatter={(v) =>
                  `R$${Number(v) >= 1000 ? `${(Number(v) / 1000).toFixed(1)}k` : v}`
                }
              />
              <Tooltip formatter={(v) => formatarMoeda(Math.round(Number(v) * 100))} />
              <Legend />
              <Line
                type="monotone"
                dataKey="receitas"
                name="Receitas"
                stroke="#0d9488"
                strokeWidth={2.5}
                dot={{ r: 4 }}
              />
              <Line
                type="monotone"
                dataKey="total"
                name="Despesas"
                stroke="#4f46e5"
                strokeWidth={2.5}
                dot={{ r: 4 }}
              />
              <Line
                type="monotone"
                dataKey="pago"
                name="Pago"
                stroke="#16a34a"
                strokeWidth={2.5}
                strokeDasharray="6 4"
                dot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grade-dashboard">
        <div className="card">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 14,
            }}
          >
            <h2 style={{ margin: 0 }}>
              <FolderOpen size={16} color="var(--accent)" /> Gastos por categoria
            </h2>
            <select
              value={mesSelecionado}
              onChange={(e) => setMesSelecionado(e.target.value)}
            >
              {mesesDoPeriodo.map((am) => (
                <option key={am} value={am}>
                  {nomeMesAno(am)}
                </option>
              ))}
            </select>
          </div>
          {porCategoria.length === 0 ? (
            <div className="vazio">Sem contas em {nomeMesAno(mesSelecionado)}.</div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={porCategoria} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis
                    type="number"
                    tickFormatter={(v) => `R$${(Number(v) / 100).toFixed(0)}`}
                  />
                  <YAxis type="category" dataKey="nome" width={130} />
                  <Tooltip formatter={(v) => formatarMoeda(Number(v))} />
                  <Bar dataKey="valor" radius={[0, 6, 6, 0]}>
                    {porCategoria.map((d) => (
                      <Cell key={d.nome} fill={d.cor} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <table style={{ marginTop: 10 }}>
                <thead>
                  <tr>
                    <th>Categoria</th>
                    <th className="num">Contas</th>
                    <th className="num">Total</th>
                    <th className="num">% do mês</th>
                  </tr>
                </thead>
                <tbody>
                  {porCategoria.map((d) => (
                    <tr key={d.nome}>
                      <td>{d.nome}</td>
                      <td className="num">{d.qtd}</td>
                      <td className="num">
                        <strong>{formatarMoeda(d.valor)}</strong>
                      </td>
                      <td className="num">
                        {totalMes ? `${((d.valor / totalMes) * 100).toFixed(1)}%` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>

        <div className="card">
          <h2>
            <ChartPie size={16} color="var(--accent)" /> Distribuição em{" "}
            {nomeMesAno(mesSelecionado)}
          </h2>
          {porCategoria.length === 0 ? (
            <div className="vazio">Sem dados.</div>
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <PieChart>
                <Pie
                  data={porCategoria}
                  dataKey="valor"
                  nameKey="nome"
                  innerRadius={60}
                  outerRadius={110}
                  paddingAngle={2}
                  label={(p: { percent?: number }) =>
                    `${((p.percent ?? 0) * 100).toFixed(0)}%`
                  }
                >
                  {porCategoria.map((d) => (
                    <Cell key={d.nome} fill={d.cor} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => formatarMoeda(Number(v))} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
