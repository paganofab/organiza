import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Plus, RotateCcw, Repeat } from "lucide-react";
import LembreteForm from "../components/LembreteForm";
import { MembroBadge } from "../components/MembroBadge";
import { useAtualizacaoExterna } from "../lib/eventos";
import {
  concluirLembrete,
  excluirLembrete,
  listarLembretes,
  listarMembros,
  reabrirLembrete,
} from "../lib/db";
import { diffDias, formatarData, hojeISO } from "../lib/format";
import type { Lembrete, Membro } from "../lib/types";

const ROTULO_RECORRENCIA: Record<string, string> = {
  diario: "todo dia",
  semanal: "toda semana",
  mensal: "todo mês",
};

export default function Lembretes() {
  const hoje = hojeISO();
  const [lembretes, setLembretes] = useState<Lembrete[]>([]);
  const [membros, setMembros] = useState<Membro[]>([]);
  const [filtroMembro, setFiltroMembro] = useState("");
  const [formAberto, setFormAberto] = useState(false);
  const [editando, setEditando] = useState<Lembrete | null>(null);

  const carregar = useCallback(async () => {
    const [lembs, mems] = await Promise.all([
      listarLembretes(),
      listarMembros(true),
    ]);
    setLembretes(lembs);
    setMembros(mems);
  }, []);

  useEffect(() => {
    carregar().catch(console.error);
  }, [carregar]);

  useAtualizacaoExterna(carregar);

  const membroPorId = useMemo(
    () => new Map(membros.map((m) => [m.id, m])),
    [membros],
  );
  const lembretesFiltrados = useMemo(() => {
    return lembretes.filter((l) => {
      if (filtroMembro === "familia") return l.membro_id === null;
      if (filtroMembro) return l.membro_id === Number(filtroMembro);
      return true;
    });
  }, [lembretes, filtroMembro]);

  const { atrasados, hojeList, futuros, semData, concluidos } = useMemo(() => {
    const pend = lembretesFiltrados.filter((l) => !l.concluido);
    return {
      atrasados: pend.filter((l) => l.data && l.data < hoje),
      hojeList: pend.filter((l) => l.data === hoje),
      futuros: pend.filter((l) => l.data && l.data > hoje),
      semData: pend.filter((l) => !l.data),
      concluidos: lembretesFiltrados.filter((l) => l.concluido).slice(0, 20),
    };
  }, [lembretesFiltrados, hoje]);

  async function concluir(l: Lembrete) {
    await concluirLembrete(l.id, hoje);
    await carregar();
  }
  async function reabrir(l: Lembrete) {
    await reabrirLembrete(l.id);
    await carregar();
  }
  async function excluir(l: Lembrete) {
    if (!confirm(`Excluir o lembrete "${l.titulo}"?`)) return;
    await excluirLembrete(l.id);
    await carregar();
  }

  function abrirNovo() {
    setEditando(null);
    setFormAberto(true);
  }

  function linha(l: Lembrete) {
    const membro = l.membro_id ? membroPorId.get(l.membro_id) : null;
    const dias = l.data ? diffDias(hoje, l.data) : null;
    const quando =
      l.data === null
        ? "sem data"
        : dias! < 0
          ? `atrasado ${-dias!}d`
          : dias === 0
            ? "hoje"
            : `em ${dias}d`;
    return (
      <div className="item-linha" key={l.id}>
        <button
          className="checkbox-lembrete"
          title="Concluir"
          onClick={() => (l.concluido ? reabrir(l) : concluir(l))}
        >
          {l.concluido ? <Check size={14} /> : null}
        </button>
        <div className="info">
          <div
            className="titulo"
            style={
              l.concluido
                ? { textDecoration: "line-through", color: "var(--text-soft)" }
                : undefined
            }
          >
            {l.titulo}
            {l.recorrencia !== "nenhuma" && (
              <span
                title={`Repete ${ROTULO_RECORRENCIA[l.recorrencia]}`}
                style={{ marginLeft: 6, verticalAlign: "middle", color: "var(--text-soft)" }}
              >
                <Repeat size={13} />
              </span>
            )}
          </div>
          <div className="detalhe">
            {l.data
              ? `${formatarData(l.data)}${l.hora ? ` às ${l.hora}` : ""} · ${quando}`
              : "tarefa sem prazo"}
            {l.observacoes ? ` — ${l.observacoes}` : ""}
          </div>
          <div className="detalhe">
            <MembroBadge membro={membro} mostrarFamilia />
          </div>
        </div>
        {!l.concluido && (
          <button
            className="btn-mini btn-secundario"
            onClick={() => {
              setEditando(l);
              setFormAberto(true);
            }}
          >
            Editar
          </button>
        )}
        {l.concluido && (
          <button className="btn-mini btn-secundario" onClick={() => reabrir(l)}>
            <RotateCcw size={13} /> Reabrir
          </button>
        )}
        <button className="btn-mini btn-perigo" onClick={() => excluir(l)}>
          Excluir
        </button>
      </div>
    );
  }

  function secao(titulo: string, itens: Lembrete[], cor?: string) {
    if (!itens.length) return null;
    return (
      <div className="card" style={{ marginBottom: 14 }}>
        <h2 style={cor ? { color: cor } : undefined}>
          {titulo} <span style={{ color: "var(--text-soft)" }}>({itens.length})</span>
        </h2>
        <div className="lista-itens">{itens.map(linha)}</div>
      </div>
    );
  }

  const totalPendentes =
    atrasados.length + hojeList.length + futuros.length + semData.length;

  return (
    <div>
      <div className="cabecalho-pagina">
        <div>
          <h1>Lembretes</h1>
          <div className="subtitulo">{totalPendentes} pendente(s)</div>
        </div>
        <button className="btn-primario" onClick={abrirNovo}>
          <Plus size={16} /> Novo lembrete
        </button>
      </div>

      <div className="filtros">
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

      {totalPendentes === 0 && !concluidos.length && (
        <div className="card">
          <div className="vazio">
            Nenhum lembrete ainda. Clique em “Novo lembrete” ou mande{" "}
            <em>“lembrar de …”</em> para o bot do Telegram.
          </div>
        </div>
      )}

      {secao("🔴 Atrasados", atrasados, "var(--red)")}
      {secao("📅 Para hoje", hojeList, "var(--amber)")}
      {secao("⏳ Próximos", futuros)}
      {secao("📌 Sem data", semData)}
      {secao("✅ Concluídos", concluidos)}

      <LembreteForm
        aberto={formAberto}
        aoFechar={() => setFormAberto(false)}
        aoSalvar={carregar}
        lembreteEditando={editando}
        membros={membros}
      />
    </div>
  );
}
