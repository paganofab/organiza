import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Eye,
  Paperclip,
  Pencil,
  Plus,
  Repeat,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import ContaForm from "../components/ContaForm";
import { MembroBadge } from "../components/MembroBadge";
import { IconeCategoria } from "../lib/icons";
import { useAtualizacaoExterna } from "../lib/eventos";
import {
  definirComprovante,
  excluirConta,
  excluirSerieAPartirDe,
  listarCategorias,
  listarContas,
  listarMembros,
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
import type { Membro } from "../lib/types";

export default function Contas() {
  const hoje = hojeISO();
  const [anoMes, setAnoMes] = useState(hoje.slice(0, 7));
  const [contas, setContas] = useState<Conta[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [membros, setMembros] = useState<Membro[]>([]);
  const [filtroStatus, setFiltroStatus] = useState("");
  const [filtroCategoria, setFiltroCategoria] = useState("");
  const [filtroMembro, setFiltroMembro] = useState("");
  const [filtroTipo, setFiltroTipo] = useState("");
  const [busca, setBusca] = useState("");
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  const [formAberto, setFormAberto] = useState(false);
  const [editando, setEditando] = useState<Conta | null>(null);

  const carregar = useCallback(async () => {
    const [cs, cats, mems] = await Promise.all([
      listarContas({ anoMes }),
      listarCategorias(),
      listarMembros(true),
    ]);
    setContas(cs);
    setCategorias(cats);
    setMembros(mems);
  }, [anoMes]);

  useEffect(() => {
    carregar().catch(console.error);
  }, [carregar]);

  useAtualizacaoExterna(carregar);

  const catPorId = useMemo(
    () => new Map(categorias.map((c) => [c.id, c])),
    [categorias],
  );
  const membroPorId = useMemo(
    () => new Map(membros.map((m) => [m.id, m])),
    [membros],
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
      if (filtroMembro === "familia" && c.membro_id !== null) return false;
      if (
        filtroMembro &&
        filtroMembro !== "familia" &&
        c.membro_id !== Number(filtroMembro)
      )
        return false;
      if (filtroTipo && c.tipo !== filtroTipo) return false;
      if (busca && !c.descricao.toLowerCase().includes(busca.toLowerCase()))
        return false;
      return true;
    });
  }, [
    contas,
    filtroStatus,
    filtroCategoria,
    filtroMembro,
    filtroTipo,
    busca,
    hoje,
  ]);

  const totalVisivel = visiveis.reduce(
    (t, c) => t + (c.tipo === "receita" ? c.valor_centavos : -c.valor_centavos),
    0,
  );
  const quantidadeFiltrosAtivos = [
    filtroTipo,
    filtroStatus,
    filtroCategoria,
    filtroMembro,
  ].filter(Boolean).length;

  function limparFiltros() {
    setFiltroTipo("");
    setFiltroStatus("");
    setFiltroCategoria("");
    setFiltroMembro("");
  }

  function formatarDataCurta(iso: string) {
    const [, mes, dia] = iso.split("-");
    return `${dia}/${mes}`;
  }

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

  function statusConta(c: Conta) {
    const receita = c.tipo === "receita";
    const atrasada = !receita && estaAtrasada(c, hoje);
    const rotulo = atrasada
      ? "Atrasada"
      : c.status === "paga"
        ? receita
          ? "Recebida"
          : "Paga"
        : receita
          ? "A receber"
          : "Pendente";
    return (
      <div className="status-conta">
        <span className={`badge ${atrasada ? "atrasada" : c.status}`}>
          {rotulo}
        </span>
        {c.status === "paga" && c.data_pagamento && (
          <span className="status-data">
            em <span className="data-completa">{formatarData(c.data_pagamento)}</span>
            <span className="data-curta">{formatarDataCurta(c.data_pagamento)}</span>
          </span>
        )}
      </div>
    );
  }

  function acoesConta(c: Conta) {
    const receita = c.tipo === "receita";
    const rotuloPagamento =
      c.status === "paga"
        ? "Reabrir lançamento"
        : receita
          ? "Marcar como recebida"
          : "Marcar como paga";
    return (
      <div className="acoes-conta">
        <button
          className={`btn-icone ${c.status === "paga" ? "btn-secundario" : "btn-primario"}`}
          onClick={() => alternarPagamento(c)}
          title={rotuloPagamento}
          aria-label={rotuloPagamento}
        >
          {c.status === "paga" ? <RotateCcw size={15} /> : <Check size={16} />}
        </button>
        {c.comprovante ? (
          <>
            <button
              className="btn-icone btn-secundario"
              onClick={() => abrirComprovante(c)}
              title="Abrir comprovante"
              aria-label="Abrir comprovante"
            >
              <Eye size={15} />
            </button>
            <button
              className="btn-icone btn-secundario acao-perigo-sutil"
              onClick={() => removerComprovante(c)}
              title="Remover comprovante"
              aria-label="Remover comprovante"
            >
              <X size={15} />
            </button>
          </>
        ) : (
          <button
            className="btn-icone btn-secundario"
            onClick={() => anexarComprovante(c)}
            title="Anexar comprovante"
            aria-label="Anexar comprovante"
          >
            <Paperclip size={15} />
          </button>
        )}
        <button
          className="btn-icone btn-secundario"
          onClick={() => {
            setEditando(c);
            setFormAberto(true);
          }}
          title="Editar lançamento"
          aria-label="Editar lançamento"
        >
          <Pencil size={15} />
        </button>
        <button
          className="btn-icone btn-perigo"
          onClick={() => excluir(c)}
          title="Excluir lançamento"
          aria-label="Excluir lançamento"
        >
          <Trash2 size={15} />
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="cabecalho-pagina cabecalho-contas">
        <div>
          <h1>Contas</h1>
          <div className="subtitulo">
            {visiveis.length} lançamento(s) · saldo {formatarMoeda(totalVisivel)}
          </div>
        </div>
        <div className="navegador-mes">
          <button
            className="btn-secundario btn-icone"
            onClick={() => mudarMes(-1)}
            title="Mês anterior"
            aria-label="Mês anterior"
          >
            <ChevronLeft size={15} />
          </button>
          <span className="mes-atual">{nomeMesAno(anoMes)}</span>
          <button
            className="btn-secundario btn-icone"
            onClick={() => mudarMes(1)}
            title="Próximo mês"
            aria-label="Próximo mês"
          >
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

      <div className="filtros contas-filtros">
        <input
          className="busca-contas"
          placeholder="Buscar descrição…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
        <button
          className={`btn-secundario botao-filtros ${filtrosAbertos ? "ativo" : ""}`}
          onClick={() => setFiltrosAbertos((aberto) => !aberto)}
          aria-expanded={filtrosAbertos}
          aria-controls="painel-filtros-contas"
        >
          <SlidersHorizontal size={15} /> Filtros
          {quantidadeFiltrosAtivos > 0 && (
            <span className="contador-filtros">{quantidadeFiltrosAtivos}</span>
          )}
        </button>
        <div
          id="painel-filtros-contas"
          className={`painel-filtros ${filtrosAbertos ? "aberto" : ""}`}
        >
          <div className="painel-filtros-topo">
            <strong>Filtrar lançamentos</strong>
            {quantidadeFiltrosAtivos > 0 && (
              <button className="link-acao" onClick={limparFiltros}>
                Limpar
              </button>
            )}
          </div>
          <select
            value={filtroTipo}
            onChange={(e) => setFiltroTipo(e.target.value)}
          >
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
          <select
            value={filtroMembro}
            onChange={(e) => setFiltroMembro(e.target.value)}
          >
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

      <div className="card tabela-contas-wrapper">
        <div className="tabela-scroll">
          <table className="tabela-contas">
            <thead>
              <tr>
                <th className="col-descricao">Descrição</th>
                <th className="col-categoria">Categoria</th>
                <th className="col-responsavel">Responsável</th>
                <th className="col-vencimento">Vencimento</th>
                <th className="col-status">Status</th>
                <th className="num col-valor">Valor</th>
                <th className="col-acoes">Ações</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    <div className="vazio">
                      Nenhuma conta encontrada neste mês.
                    </div>
                  </td>
                </tr>
              )}
              {visiveis.map((c) => {
                const cat = c.categoria_id
                  ? catPorId.get(c.categoria_id)
                  : undefined;
                const membro = c.membro_id
                  ? membroPorId.get(c.membro_id)
                  : null;
                const receita = c.tipo === "receita";
                return (
                  <tr key={c.id}>
                    <td className="col-descricao">
                      <div className="conta-descricao">
                        <strong>{c.descricao}</strong>
                        {c.recorrente === 1 && (
                          <span
                            className="icone-recorrente"
                            title="Conta recorrente"
                          >
                            <Repeat size={13} />
                          </span>
                        )}
                      </div>
                      {c.observacoes && (
                        <div className="conta-observacao">{c.observacoes}</div>
                      )}
                      <div className="conta-meta-compacta">
                        {cat ? (
                          <span className="celula-categoria">
                            <IconeCategoria
                              nome={cat.icone}
                              cor={cat.cor}
                              size={14}
                            />
                            {cat.nome}
                          </span>
                        ) : (
                          <span>Sem categoria</span>
                        )}
                        <MembroBadge membro={membro} mostrarFamilia />
                      </div>
                    </td>
                    <td className="col-categoria">
                      {cat ? (
                        <span className="celula-categoria">
                          <IconeCategoria
                            nome={cat.icone}
                            cor={cat.cor}
                            size={15}
                          />
                          {cat.nome}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="col-responsavel">
                      <MembroBadge membro={membro} mostrarFamilia />
                    </td>
                    <td className="col-vencimento">
                      <span className="data-completa">
                        {formatarData(c.vencimento)}
                      </span>
                      <span className="data-curta">
                        {formatarDataCurta(c.vencimento)}
                      </span>
                    </td>
                    <td className="col-status">{statusConta(c)}</td>
                    <td className="num col-valor">
                      <strong
                        style={receita ? { color: "var(--green)" } : undefined}
                      >
                        {receita ? "+" : ""}
                        {formatarMoeda(c.valor_centavos)}
                      </strong>
                    </td>
                    <td className="col-acoes">{acoesConta(c)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card lista-contas-mobile">
        {visiveis.length === 0 ? (
          <div className="vazio">Nenhuma conta encontrada neste mês.</div>
        ) : (
          visiveis.map((c) => {
            const cat = c.categoria_id
              ? catPorId.get(c.categoria_id)
              : undefined;
            const membro = c.membro_id
              ? membroPorId.get(c.membro_id)
              : null;
            const receita = c.tipo === "receita";
            return (
              <div className="conta-mobile" key={c.id}>
                <div className="conta-mobile-topo">
                  <div className="info">
                    <div className="conta-descricao">
                      <strong>{c.descricao}</strong>
                      {c.recorrente === 1 && (
                        <span
                          className="icone-recorrente"
                          title="Conta recorrente"
                        >
                          <Repeat size={13} />
                        </span>
                      )}
                    </div>
                    {c.observacoes && (
                      <div className="conta-observacao">{c.observacoes}</div>
                    )}
                  </div>
                  <strong
                    className="conta-mobile-valor"
                    style={receita ? { color: "var(--green)" } : undefined}
                  >
                    {receita ? "+" : ""}
                    {formatarMoeda(c.valor_centavos)}
                  </strong>
                </div>
                <div className="conta-mobile-meta">
                  {cat ? (
                    <span className="celula-categoria">
                      <IconeCategoria
                        nome={cat.icone}
                        cor={cat.cor}
                        size={14}
                      />
                      {cat.nome}
                    </span>
                  ) : (
                    <span>Sem categoria</span>
                  )}
                  <MembroBadge membro={membro} mostrarFamilia />
                  <span>{formatarData(c.vencimento)}</span>
                </div>
                <div className="conta-mobile-rodape">
                  {statusConta(c)}
                  {acoesConta(c)}
                </div>
              </div>
            );
          })
        )}
      </div>

      <ContaForm
        aberto={formAberto}
        aoFechar={() => setFormAberto(false)}
        aoSalvar={carregar}
        categorias={categorias}
        membros={membros}
        contaEditando={editando}
        dataInicial={`${anoMes}-01`}
      />
    </div>
  );
}
