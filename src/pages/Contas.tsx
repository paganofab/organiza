import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { ChevronLeft, ChevronRight, Plus, Repeat } from "lucide-react";
import ContaForm from "../components/ContaForm";
import { IconeCategoria } from "../lib/icons";
import { useAtualizacaoExterna } from "../lib/eventos";
import {
  definirComprovante,
  excluirConta,
  excluirSerieAPartirDe,
  listarCategorias,
  listarContas,
  marcarPaga,
  marcarPendente,
} from "../lib/db";
import {
  formatarData,
  formatarMoeda,
  hojeISO,
  nomeMesAno,
  somarMeses,
} from "../lib/format";
import { estaAtrasada, type Categoria, type Conta } from "../lib/types";

export default function Contas() {
  const hoje = hojeISO();
  const [anoMes, setAnoMes] = useState(hoje.slice(0, 7));
  const [contas, setContas] = useState<Conta[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [filtroStatus, setFiltroStatus] = useState("");
  const [filtroCategoria, setFiltroCategoria] = useState("");
  const [filtroTipo, setFiltroTipo] = useState("");
  const [busca, setBusca] = useState("");
  const [formAberto, setFormAberto] = useState(false);
  const [editando, setEditando] = useState<Conta | null>(null);

  const carregar = useCallback(async () => {
    const [cs, cats] = await Promise.all([
      listarContas({ anoMes }),
      listarCategorias(),
    ]);
    setContas(cs);
    setCategorias(cats);
  }, [anoMes]);

  useEffect(() => {
    carregar().catch(console.error);
  }, [carregar]);

  useAtualizacaoExterna(carregar);

  const catPorId = useMemo(
    () => new Map(categorias.map((c) => [c.id, c])),
    [categorias],
  );

  const visiveis = useMemo(() => {
    return contas.filter((c) => {
      if (filtroStatus === "atrasada" && !estaAtrasada(c, hoje)) return false;
      if (
        (filtroStatus === "paga" || filtroStatus === "pendente") &&
        c.status !== filtroStatus
      )
        return false;
      if (filtroCategoria && c.categoria_id !== Number(filtroCategoria))
        return false;
      if (filtroTipo && c.tipo !== filtroTipo) return false;
      if (busca && !c.descricao.toLowerCase().includes(busca.toLowerCase()))
        return false;
      return true;
    });
  }, [contas, filtroStatus, filtroCategoria, filtroTipo, busca, hoje]);

  const totalVisivel = visiveis.reduce(
    (t, c) => t + (c.tipo === "receita" ? c.valor_centavos : -c.valor_centavos),
    0,
  );

  function mudarMes(delta: number) {
    setAnoMes(somarMeses(`${anoMes}-01`, delta).slice(0, 7));
  }

  async function alternarPagamento(c: Conta) {
    if (c.status === "paga") {
      await marcarPendente(c.id);
    } else {
      await marcarPaga(c.id, hoje);
    }
    await carregar();
  }

  async function excluir(c: Conta) {
    if (c.serie_id) {
      const futuras = confirm(
        `"${c.descricao}" faz parte de uma série (recorrência ou parcelamento).\n\nOK = excluir esta e as próximas pendentes\nCancelar = excluir só esta`,
      );
      if (futuras) {
        await excluirSerieAPartirDe(c.serie_id, c.vencimento);
      } else {
        await excluirConta(c.id);
      }
    } else {
      if (!confirm(`Excluir "${c.descricao}"?`)) return;
      await excluirConta(c.id);
    }
    await carregar();
  }

  async function anexarComprovante(c: Conta) {
    const escolhido = await open({
      multiple: false,
      title: "Selecionar comprovante",
      filters: [
        { name: "Documentos e imagens", extensions: ["pdf", "png", "jpg", "jpeg", "webp"] },
      ],
    });
    if (!escolhido) return;
    const salvo = await invoke<string>("save_attachment", { src: escolhido });
    await definirComprovante(c.id, salvo);
    await carregar();
  }

  async function abrirComprovante(c: Conta) {
    if (!c.comprovante) return;
    await invoke("open_attachment", { path: c.comprovante });
  }

  async function removerComprovante(c: Conta) {
    if (!c.comprovante) return;
    if (!confirm("Remover o comprovante desta conta?")) return;
    try {
      await invoke("delete_attachment", { path: c.comprovante });
    } catch {
      // arquivo pode já ter sido apagado manualmente; segue limpando o vínculo
    }
    await definirComprovante(c.id, null);
    await carregar();
  }

  return (
    <div>
      <div className="cabecalho-pagina">
        <div>
          <h1>Contas</h1>
          <div className="subtitulo">
            {visiveis.length} lançamento(s) · saldo {formatarMoeda(totalVisivel)}
          </div>
        </div>
        <div className="navegador-mes">
          <button className="btn-secundario btn-mini" onClick={() => mudarMes(-1)}>
            <ChevronLeft size={15} />
          </button>
          <span className="mes-atual">{nomeMesAno(anoMes)}</span>
          <button className="btn-secundario btn-mini" onClick={() => mudarMes(1)}>
            <ChevronRight size={15} />
          </button>
        </div>
        <button
          className="btn-primario"
          onClick={() => {
            setEditando(null);
            setFormAberto(true);
          }}
        >
          <Plus size={16} /> Nova conta
        </button>
      </div>

      <div className="filtros">
        <input
          placeholder="Buscar descrição…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          style={{ minWidth: 200 }}
        />
        <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)}>
          <option value="">Despesas e receitas</option>
          <option value="despesa">Só despesas</option>
          <option value="receita">Só receitas</option>
        </select>
        <select
          value={filtroStatus}
          onChange={(e) => setFiltroStatus(e.target.value)}
        >
          <option value="">Todos os status</option>
          <option value="pendente">Pendentes</option>
          <option value="atrasada">Atrasadas</option>
          <option value="paga">Pagas</option>
        </select>
        <select
          value={filtroCategoria}
          onChange={(e) => setFiltroCategoria(e.target.value)}
        >
          <option value="">Todas as categorias</option>
          <optgroup label="Despesas">
            {categorias
              .filter((c) => c.tipo === "despesa")
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
          </optgroup>
          <optgroup label="Receitas">
            {categorias
              .filter((c) => c.tipo === "receita")
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
          </optgroup>
        </select>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Descrição</th>
              <th>Categoria</th>
              <th>Vencimento</th>
              <th>Status</th>
              <th className="num">Valor</th>
              <th>Comprovante</th>
              <th style={{ width: 220 }}>Ações</th>
            </tr>
          </thead>
          <tbody>
            {visiveis.length === 0 && (
              <tr>
                <td colSpan={7}>
                  <div className="vazio">Nenhuma conta encontrada neste mês.</div>
                </td>
              </tr>
            )}
            {visiveis.map((c) => {
              const cat = c.categoria_id ? catPorId.get(c.categoria_id) : undefined;
              const receita = c.tipo === "receita";
              const atrasada = !receita && estaAtrasada(c, hoje);
              return (
                <tr key={c.id}>
                  <td>
                    <strong>{c.descricao}</strong>
                    {c.recorrente === 1 && (
                      <span title="Conta recorrente" style={{ marginLeft: 6, verticalAlign: "middle", color: "var(--text-soft)" }}>
                        <Repeat size={13} />
                      </span>
                    )}
                    {c.observacoes && (
                      <div style={{ color: "var(--text-soft)", fontSize: 12 }}>
                        {c.observacoes}
                      </div>
                    )}
                  </td>
                  <td>
                    {cat ? (
                      <span className="celula-categoria">
                        <IconeCategoria nome={cat.icone} cor={cat.cor} size={15} />
                        {cat.nome}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>{formatarData(c.vencimento)}</td>
                  <td>
                    <span
                      className={`badge ${atrasada ? "atrasada" : c.status}`}
                    >
                      {atrasada
                        ? "Atrasada"
                        : c.status === "paga"
                          ? `${receita ? "Recebida" : "Paga"}${c.data_pagamento ? ` em ${formatarData(c.data_pagamento)}` : ""}`
                          : receita
                            ? "A receber"
                            : "Pendente"}
                    </span>
                  </td>
                  <td className="num">
                    <strong style={receita ? { color: "var(--green)" } : undefined}>
                      {receita ? "+" : ""}
                      {formatarMoeda(c.valor_centavos)}
                    </strong>
                  </td>
                  <td>
                    {c.comprovante ? (
                      <span style={{ display: "flex", gap: 8 }}>
                        <button className="link-acao" onClick={() => abrirComprovante(c)}>
                          Ver
                        </button>
                        <button
                          className="link-acao"
                          style={{ color: "var(--red)" }}
                          onClick={() => removerComprovante(c)}
                        >
                          Remover
                        </button>
                      </span>
                    ) : (
                      <button className="link-acao" onClick={() => anexarComprovante(c)}>
                        Anexar
                      </button>
                    )}
                  </td>
                  <td>
                    <span style={{ display: "flex", gap: 6 }}>
                      <button
                        className={`btn-mini ${c.status === "paga" ? "btn-secundario" : "btn-primario"}`}
                        onClick={() => alternarPagamento(c)}
                      >
                        {c.status === "paga"
                          ? "Reabrir"
                          : receita
                            ? "Receber"
                            : "Pagar"}
                      </button>
                      <button
                        className="btn-mini btn-secundario"
                        onClick={() => {
                          setEditando(c);
                          setFormAberto(true);
                        }}
                      >
                        Editar
                      </button>
                      <button
                        className="btn-mini btn-perigo"
                        onClick={() => excluir(c)}
                      >
                        Excluir
                      </button>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ContaForm
        aberto={formAberto}
        aoFechar={() => setFormAberto(false)}
        aoSalvar={carregar}
        categorias={categorias}
        contaEditando={editando}
        dataInicial={`${anoMes}-01`}
      />
    </div>
  );
}
