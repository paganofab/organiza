import { useCallback, useEffect, useMemo, useState } from "react";
import { TrendingUp } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { contasEntre, listarMembros } from "../lib/db";
import { useAtualizacaoExterna } from "../lib/eventos";
import { MESES, formatarMoeda, hojeISO, somarMeses } from "../lib/format";
import type { Conta, Membro } from "../lib/types";

type Horizonte = 6 | 12;

export default function FluxoCaixa() {
  const hoje = hojeISO();
  const anoMesAtual = hoje.slice(0, 7);
  const [horizonte, setHorizonte] = useState<Horizonte>(6);
  const [contas, setContas] = useState<Conta[]>([]);
  const [membros, setMembros] = useState<Membro[]>([]);
  const [filtroMembro, setFiltroMembro] = useState("");

  const fim = useMemo(
    () => somarMeses(`${anoMesAtual}-01`, horizonte - 1).slice(0, 7),
    [anoMesAtual, horizonte],
  );

  const carregar = useCallback(async () => {
    const [cs, mems] = await Promise.all([
      contasEntre(`${anoMesAtual}-01`, `${fim}-31`),
      listarMembros(true),
    ]);
    setContas(cs);
    setMembros(mems);
  }, [anoMesAtual, fim]);

  useEffect(() => {
    carregar().catch(console.error);
  }, [carregar]);

  useAtualizacaoExterna(carregar);

  const meses = useMemo(() => {
    const lista: string[] = [];
    for (let i = 0; i < horizonte; i++) {
      lista.push(somarMeses(`${anoMesAtual}-01`, i).slice(0, 7));
    }
    return lista;
  }, [anoMesAtual, horizonte]);

  const contasFiltradas = useMemo(() => {
    return contas.filter((c) => {
      if (filtroMembro === "familia") return c.membro_id === null;
      if (filtroMembro) return c.membro_id === Number(filtroMembro);
      return true;
    });
  }, [contas, filtroMembro]);

  // Projeção: por mês, despesas e receitas já lançadas + saldo acumulado
  const dados = useMemo(() => {
    let acumulado = 0;
    return meses.map((am) => {
      const doMes = contasFiltradas.filter((c) => c.vencimento.startsWith(am));
      const despesas = doMes
        .filter((c) => c.tipo === "despesa")
        .reduce((t, c) => t + c.valor_centavos, 0);
      const receitas = doMes
        .filter((c) => c.tipo === "receita")
        .reduce((t, c) => t + c.valor_centavos, 0);
      acumulado += receitas - despesas;
      const [, m] = am.split("-").map(Number);
      return {
        mes: MESES[m - 1].slice(0, 3),
        despesas: despesas / 100,
        receitas: receitas / 100,
        saldoMes: (receitas - despesas) / 100,
        acumulado: acumulado / 100,
      };
    });
  }, [contasFiltradas, meses]);

  const totalDespesas = dados.reduce((t, d) => t + d.despesas, 0);
  const totalReceitas = dados.reduce((t, d) => t + d.receitas, 0);
  const saldoFinal = dados.length ? dados[dados.length - 1].acumulado : 0;

  const cents = (v: number) => formatarMoeda(Math.round(v * 100));

  return (
    <div>
      <div className="cabecalho-pagina">
        <div>
          <h1>Fluxo de caixa</h1>
          <div className="subtitulo">
            Compromissos já lançados (recorrências e parcelas) nos próximos{" "}
            {horizonte} meses
          </div>
        </div>
        <div className="filtros" style={{ margin: 0 }}>
          <select
            value={horizonte}
            onChange={(e) => setHorizonte(Number(e.target.value) as Horizonte)}
          >
            <option value={6}>Próximos 6 meses</option>
            <option value={12}>Próximos 12 meses</option>
          </select>
          <select value={filtroMembro} onChange={(e) => setFiltroMembro(e.target.value)}>
            <option value="">Todos os responsáveis</option>
            <option value="familia">Família inteira</option>
            {membros.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nome}
                {m.ativo !== 1 ? " (arquivado)" : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="cards-resumo">
        <div className="card">
          <div className="rotulo">Receitas previstas</div>
          <div className="valor verde">{cents(totalReceitas)}</div>
        </div>
        <div className="card">
          <div className="rotulo">Despesas previstas</div>
          <div className="valor">{cents(totalDespesas)}</div>
        </div>
        <div className="card">
          <div className="rotulo">Saldo projetado no período</div>
          <div className={`valor ${saldoFinal >= 0 ? "verde" : "vermelho"}`}>
            {cents(saldoFinal)}
          </div>
        </div>
      </div>

      <div className="card">
        <h2>
          <TrendingUp size={16} color="var(--accent)" /> Receitas × despesas por
          mês
        </h2>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={dados}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="mes" />
            <YAxis
              tickFormatter={(v) =>
                `R$${Number(v) >= 1000 ? `${(Number(v) / 1000).toFixed(0)}k` : v}`
              }
            />
            <Tooltip formatter={(v) => cents(Number(v))} />
            <Legend />
            <Bar dataKey="receitas" name="Receitas" fill="#0d9488" radius={[4, 4, 0, 0]} />
            <Bar dataKey="despesas" name="Despesas" fill="#4f46e5" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <h2>📈 Saldo acumulado projetado</h2>
        <p style={{ color: "var(--text-soft)", marginTop: 0 }}>
          Considera só o que já está lançado. Valores negativos indicam meses em
          que os compromissos superam as receitas previstas.
        </p>
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={dados}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="mes" />
            <YAxis
              tickFormatter={(v) =>
                `R$${Number(v) >= 1000 || Number(v) <= -1000 ? `${(Number(v) / 1000).toFixed(0)}k` : v}`
              }
            />
            <Tooltip formatter={(v) => cents(Number(v))} />
            <Legend />
            <Bar dataKey="saldoMes" name="Saldo do mês" radius={[4, 4, 0, 0]}>
              {dados.map((d, i) => (
                <Cell
                  key={i}
                  fill={d.saldoMes >= 0 ? "#16a34a" : "#dc2626"}
                />
              ))}
            </Bar>
            <Line
              type="monotone"
              dataKey="acumulado"
              name="Saldo acumulado"
              stroke="#4f46e5"
              strokeWidth={2.5}
              dot={{ r: 4 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="card" style={{ marginTop: 14, padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Mês</th>
              <th className="num">Receitas</th>
              <th className="num">Despesas</th>
              <th className="num">Saldo do mês</th>
              <th className="num">Acumulado</th>
            </tr>
          </thead>
          <tbody>
            {dados.map((d) => (
              <tr key={d.mes}>
                <td>{d.mes}</td>
                <td className="num" style={{ color: "var(--green)" }}>
                  {cents(d.receitas)}
                </td>
                <td className="num">{cents(d.despesas)}</td>
                <td
                  className="num"
                  style={{ color: d.saldoMes >= 0 ? "var(--green)" : "var(--red)" }}
                >
                  {cents(d.saldoMes)}
                </td>
                <td
                  className="num"
                  style={{
                    fontWeight: 700,
                    color: d.acumulado >= 0 ? "var(--text)" : "var(--red)",
                  }}
                >
                  {cents(d.acumulado)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
