import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  CalendarDays,
  ChartPie,
  CircleAlert,
  Clock,
  ListChecks,
  Target,
  TriangleAlert,
} from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { IconeCategoria } from "../lib/icons";
import { useAtualizacaoExterna } from "../lib/eventos";
import {
  concluirLembrete,
  contasEntre,
  eventosEntre,
  lembretesPendentesAte,
  listarCategorias,
  listarContas,
  marcarPaga,
} from "../lib/db";
import {
  diffDias,
  formatarData,
  formatarMoeda,
  hojeISO,
  nomeMesAno,
} from "../lib/format";
import {
  estaAtrasada,
  type Categoria,
  type Conta,
  type Evento,
  type Lembrete,
} from "../lib/types";

function somar(contas: Conta[]): number {
  return contas.reduce((t, c) => t + c.valor_centavos, 0);
}

export default function Dashboard() {
  const hoje = hojeISO();
  const anoMes = hoje.slice(0, 7);
  const [contasMes, setContasMes] = useState<Conta[]>([]);
  const [atrasadasTodas, setAtrasadasTodas] = useState<Conta[]>([]);
  const [proximas, setProximas] = useState<Conta[]>([]);
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [lembretes, setLembretes] = useState<Lembrete[]>([]);

  const carregar = useCallback(async () => {
    const em14dias = new Date(`${hoje}T00:00:00`);
    em14dias.setDate(em14dias.getDate() + 14);
    const limite = `${em14dias.getFullYear()}-${String(em14dias.getMonth() + 1).padStart(2, "0")}-${String(em14dias.getDate()).padStart(2, "0")}`;

    const [mes, pendentes, prox, evts, cats, lembs] = await Promise.all([
      listarContas({ anoMes }),
      listarContas({ status: "pendente", tipo: "despesa" }),
      contasEntre(hoje, limite),
      eventosEntre(hoje, limite),
      listarCategorias(),
      lembretesPendentesAte(hoje), // atrasados + de hoje
    ]);
    setContasMes(mes);
    setAtrasadasTodas(pendentes.filter((c) => estaAtrasada(c, hoje)));
    setProximas(
      prox.filter((c) => c.status === "pendente" && c.tipo === "despesa"),
    );
    setEventos(evts);
    setCategorias(cats);
    setLembretes(lembs);
  }, [anoMes, hoje]);

  async function concluirLembreteDash(id: number) {
    await concluirLembrete(id, hoje);
    await carregar();
  }

  useEffect(() => {
    carregar().catch(console.error);
  }, [carregar]);

  useAtualizacaoExterna(carregar);

  const catPorId = useMemo(
    () => new Map(categorias.map((c) => [c.id, c])),
    [categorias],
  );

  const despesasMes = useMemo(
    () => contasMes.filter((c) => c.tipo === "despesa"),
    [contasMes],
  );
  const receitasMes = useMemo(
    () => contasMes.filter((c) => c.tipo === "receita"),
    [contasMes],
  );

  const totalDespesas = somar(despesasMes);
  const totalReceitas = somar(receitasMes);
  const saldo = totalReceitas - totalDespesas;
  const pendenteMes = somar(despesasMes.filter((c) => c.status === "pendente"));
  const totalAtrasado = somar(atrasadasTodas);

  const dadosPizza = useMemo(() => {
    const porCategoria = new Map<string, { nome: string; cor: string; valor: number }>();
    for (const c of despesasMes) {
      const cat = c.categoria_id ? catPorId.get(c.categoria_id) : undefined;
      const chave = cat?.nome ?? "Sem categoria";
      const atual = porCategoria.get(chave) ?? {
        nome: chave,
        cor: cat?.cor ?? "#a3a3a3",
        valor: 0,
      };
      atual.valor += c.valor_centavos;
      porCategoria.set(chave, atual);
    }
    return [...porCategoria.values()].sort((a, b) => b.valor - a.valor);
  }, [despesasMes, catPorId]);

  // Consumo do orçamento: gasto do mês por categoria com orçamento definido
  const orcamentos = useMemo(() => {
    return categorias
      .filter((cat) => cat.tipo === "despesa" && cat.orcamento_centavos > 0)
      .map((cat) => {
        const gasto = somar(despesasMes.filter((c) => c.categoria_id === cat.id));
        const pct = (gasto / cat.orcamento_centavos) * 100;
        return { cat, gasto, pct };
      })
      .sort((a, b) => b.pct - a.pct);
  }, [categorias, despesasMes]);

  async function pagarAgora(c: Conta) {
    await marcarPaga(c.id, hoje);
    await carregar();
  }

  function linhaVencimento(c: Conta) {
    const dias = diffDias(hoje, c.vencimento);
    const quando =
      dias < 0
        ? `venceu há ${-dias} dia(s)`
        : dias === 0
          ? "vence hoje"
          : `vence em ${dias} dia(s)`;
    const cat = c.categoria_id ? catPorId.get(c.categoria_id) : undefined;
    return (
      <div className="item-linha" key={c.id}>
        <div
          className="icone-cat"
          style={{ background: `${cat?.cor ?? "#a3a3a3"}22` }}
        >
          <IconeCategoria nome={cat?.icone} cor={cat?.cor ?? "#a3a3a3"} />
        </div>
        <div className="info">
          <div className="titulo">{c.descricao}</div>
          <div className="detalhe">
            {formatarData(c.vencimento)} · {quando}
          </div>
        </div>
        <span className={`badge ${estaAtrasada(c, hoje) ? "atrasada" : "pendente"}`}>
          {estaAtrasada(c, hoje) ? "Atrasada" : "Pendente"}
        </span>
        <div className="valor-item">{formatarMoeda(c.valor_centavos)}</div>
        <button className="btn-mini btn-primario" onClick={() => pagarAgora(c)}>
          Pagar
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="cabecalho-pagina">
        <div>
          <h1>Dashboard</h1>
          <div className="subtitulo">Visão geral de {nomeMesAno(anoMes)}</div>
        </div>
        <Link to="/contas">
          <button className="btn-primario">+ Nova conta</button>
        </Link>
      </div>

      {atrasadasTodas.length > 0 && (
        <div className="aviso">
          <TriangleAlert size={16} /> Você tem {atrasadasTodas.length} conta(s)
          atrasada(s) somando {formatarMoeda(totalAtrasado)}.
        </div>
      )}

      <div className="cards-resumo">
        <div className="card">
          <div className="rotulo">Receitas do mês</div>
          <div className="valor verde">{formatarMoeda(totalReceitas)}</div>
        </div>
        <div className="card">
          <div className="rotulo">Despesas do mês</div>
          <div className="valor">{formatarMoeda(totalDespesas)}</div>
        </div>
        <div className="card">
          <div className="rotulo">Saldo do mês</div>
          <div className={`valor ${saldo >= 0 ? "verde" : "vermelho"}`}>
            {formatarMoeda(saldo)}
          </div>
        </div>
        <div className="card">
          <div className="rotulo">A pagar</div>
          <div className="valor ambar">{formatarMoeda(pendenteMes)}</div>
        </div>
        <div className="card">
          <div className="rotulo">Atrasadas</div>
          <div className="valor vermelho">
            {atrasadasTodas.length} · {formatarMoeda(totalAtrasado)}
          </div>
        </div>
      </div>

      <div className="grade-dashboard">
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="card">
            <h2>
              <CircleAlert size={16} color="var(--red)" /> Contas atrasadas
            </h2>
            <div className="lista-itens">
              {atrasadasTodas.length === 0 ? (
                <div className="vazio">Nenhuma conta atrasada.</div>
              ) : (
                atrasadasTodas.map(linhaVencimento)
              )}
            </div>
          </div>
          <div className="card">
            <h2>
              <Clock size={16} color="var(--amber)" /> Próximos vencimentos (14
              dias)
            </h2>
            <div className="lista-itens">
              {proximas.length === 0 ? (
                <div className="vazio">Nada vencendo nos próximos 14 dias.</div>
              ) : (
                proximas.map(linhaVencimento)
              )}
            </div>
          </div>
          {orcamentos.length > 0 && (
            <div className="card">
              <h2>
                <Target size={16} color="var(--accent)" /> Orçamentos do mês
              </h2>
              <div className="lista-orcamentos">
                {orcamentos.map(({ cat, gasto, pct }) => (
                  <div className="orcamento" key={cat.id}>
                    <div className="orcamento-topo">
                      <span className="celula-categoria">
                        <IconeCategoria nome={cat.icone} cor={cat.cor} size={15} />
                        {cat.nome}
                      </span>
                      <span
                        className={
                          pct >= 100 ? "estourado" : pct >= 80 ? "quase" : ""
                        }
                      >
                        {formatarMoeda(gasto)} /{" "}
                        {formatarMoeda(cat.orcamento_centavos)} ·{" "}
                        {pct.toFixed(0)}%
                      </span>
                    </div>
                    <div className="barra-fundo">
                      <div
                        className="barra"
                        style={{
                          width: `${Math.min(pct, 100)}%`,
                          background:
                            pct >= 100
                              ? "var(--red)"
                              : pct >= 80
                                ? "var(--amber)"
                                : cat.cor,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="card">
            <h2>
              <ChartPie size={16} color="var(--accent)" /> Gastos do mês por
              categoria
            </h2>
            {dadosPizza.length === 0 ? (
              <div className="vazio">Sem despesas neste mês.</div>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={210}>
                  <PieChart>
                    <Pie
                      data={dadosPizza}
                      dataKey="valor"
                      nameKey="nome"
                      innerRadius={55}
                      outerRadius={90}
                      paddingAngle={2}
                    >
                      {dadosPizza.map((d) => (
                        <Cell key={d.nome} fill={d.cor} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v) => formatarMoeda(Number(v))}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="lista-itens">
                  {dadosPizza.slice(0, 5).map((d) => (
                    <div className="item-linha" key={d.nome}>
                      <span
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: 99,
                          background: d.cor,
                          flexShrink: 0,
                        }}
                      />
                      <div className="info">
                        <div className="titulo">{d.nome}</div>
                      </div>
                      <div className="valor-item">{formatarMoeda(d.valor)}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
          <div className="card">
            <h2>
              <ListChecks size={16} color="var(--accent)" /> Lembretes (hoje e
              atrasados)
            </h2>
            <div className="lista-itens">
              {lembretes.length === 0 ? (
                <div className="vazio">
                  Nada pendente para hoje.{" "}
                  <Link to="/lembretes">Ver lembretes</Link>
                </div>
              ) : (
                lembretes.map((l) => {
                  const atrasado = l.data! < hoje;
                  return (
                    <div className="item-linha" key={l.id}>
                      <button
                        className="checkbox-lembrete"
                        title="Concluir"
                        onClick={() => concluirLembreteDash(l.id)}
                      />
                      <div className="info">
                        <div className="titulo">{l.titulo}</div>
                        <div className="detalhe">
                          {formatarData(l.data!)}
                          {l.hora ? ` às ${l.hora}` : ""}
                        </div>
                      </div>
                      <span
                        className={`badge ${atrasado ? "atrasada" : "pendente"}`}
                      >
                        {atrasado ? "Atrasado" : "Hoje"}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
          <div className="card">
            <h2>
              <CalendarDays size={16} color="var(--accent)" /> Próximos eventos
            </h2>
            <div className="lista-itens">
              {eventos.length === 0 ? (
                <div className="vazio">
                  Nenhum evento nos próximos 14 dias.{" "}
                  <Link to="/calendario">Adicionar</Link>
                </div>
              ) : (
                eventos.map((e) => (
                  <div className="item-linha" key={e.id}>
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 99,
                        background: e.cor,
                        flexShrink: 0,
                      }}
                    />
                    <div className="info">
                      <div className="titulo">{e.titulo}</div>
                      <div className="detalhe">
                        {formatarData(e.data)}
                        {e.hora ? ` às ${e.hora}` : ""}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
