import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import EventoForm from "../components/EventoForm";
import { useAtualizacaoExterna } from "../lib/eventos";
import { contasEntre, eventosEntre, lembretesEntre, listarMembros } from "../lib/db";
import {
  DIAS_SEMANA,
  formatarMoeda,
  hojeISO,
  nomeMesAno,
  somarMeses,
} from "../lib/format";
import type { Conta, Evento, Lembrete, Membro } from "../lib/types";

interface Dia {
  iso: string;
  numero: number;
  doMes: boolean;
}

function montarGrade(anoMes: string): Dia[] {
  const [ano, mes] = anoMes.split("-").map(Number);
  const primeiro = new Date(ano, mes - 1, 1);
  const inicio = new Date(primeiro);
  inicio.setDate(1 - primeiro.getDay()); // volta até domingo

  const dias: Dia[] = [];
  const cursor = new Date(inicio);
  for (let i = 0; i < 42; i++) {
    dias.push({
      iso: `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`,
      numero: cursor.getDate(),
      doMes: cursor.getMonth() === mes - 1,
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return dias;
}

export default function Calendario() {
  const hoje = hojeISO();
  const [anoMes, setAnoMes] = useState(hoje.slice(0, 7));
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [contas, setContas] = useState<Conta[]>([]);
  const [lembretes, setLembretes] = useState<Lembrete[]>([]);
  const [membros, setMembros] = useState<Membro[]>([]);
  const [formAberto, setFormAberto] = useState(false);
  const [editando, setEditando] = useState<Evento | null>(null);
  const [dataNova, setDataNova] = useState<string>(hoje);

  const grade = useMemo(() => montarGrade(anoMes), [anoMes]);

  const carregar = useCallback(async () => {
    const inicio = grade[0].iso;
    const fim = grade[grade.length - 1].iso;
    const [evts, cts, lembs, mems] = await Promise.all([
      eventosEntre(inicio, fim),
      contasEntre(inicio, fim),
      lembretesEntre(inicio, fim),
      listarMembros(true),
    ]);
    setEventos(evts);
    setContas(cts);
    setLembretes(lembs);
    setMembros(mems);
  }, [grade]);

  useEffect(() => {
    carregar().catch(console.error);
  }, [carregar]);

  useAtualizacaoExterna(carregar);

  const porDia = useMemo(() => {
    const mapa = new Map<
      string,
      { eventos: Evento[]; contas: Conta[]; lembretes: Lembrete[] }
    >();
    const get = (iso: string) => {
      let v = mapa.get(iso);
      if (!v) {
        v = { eventos: [], contas: [], lembretes: [] };
        mapa.set(iso, v);
      }
      return v;
    };
    for (const e of eventos) get(e.data).eventos.push(e);
    for (const c of contas) get(c.vencimento).contas.push(c);
    for (const l of lembretes) if (l.data) get(l.data).lembretes.push(l);
    return mapa;
  }, [eventos, contas, lembretes]);

  const membroPorId = useMemo(
    () => new Map(membros.map((m) => [m.id, m])),
    [membros],
  );

  function clicarDia(d: Dia) {
    setEditando(null);
    setDataNova(d.iso);
    setFormAberto(true);
  }

  function clicarEvento(e: Evento, ev: React.MouseEvent) {
    ev.stopPropagation();
    setEditando(e);
    setFormAberto(true);
  }

  return (
    <div>
      <div className="cabecalho-pagina">
        <div>
          <h1>Calendário</h1>
          <div className="subtitulo">
            Clique em um dia para adicionar um evento
          </div>
        </div>
        <div className="navegador-mes">
          <button
            className="btn-secundario btn-mini"
            onClick={() => setAnoMes(somarMeses(`${anoMes}-01`, -1).slice(0, 7))}
          >
            <ChevronLeft size={15} />
          </button>
          <span className="mes-atual">{nomeMesAno(anoMes)}</span>
          <button
            className="btn-secundario btn-mini"
            onClick={() => setAnoMes(somarMeses(`${anoMes}-01`, 1).slice(0, 7))}
          >
            <ChevronRight size={15} />
          </button>
          <button
            className="btn-secundario btn-mini"
            onClick={() => setAnoMes(hoje.slice(0, 7))}
          >
            Hoje
          </button>
        </div>
        <button
          className="btn-primario"
          onClick={() => {
            setEditando(null);
            setDataNova(hoje);
            setFormAberto(true);
          }}
        >
          <Plus size={16} /> Novo evento
        </button>
      </div>

      <div className="calendario">
        <div className="semana-cabecalho">
          {DIAS_SEMANA.map((d) => (
            <div key={d}>{d}</div>
          ))}
        </div>
        {[0, 1, 2, 3, 4, 5].map((semana) => (
          <div className="semana" key={semana}>
            {grade.slice(semana * 7, semana * 7 + 7).map((d) => {
              const itens = porDia.get(d.iso);
              const pilulas: { chave: string; texto: string; cor: string; aoClicar?: (ev: React.MouseEvent) => void }[] = [];
              for (const e of itens?.eventos ?? []) {
                pilulas.push({
                  chave: `e${e.id}`,
                  texto: `${e.hora ? `${e.hora} ` : ""}${e.titulo}`,
                  cor: e.cor,
                  aoClicar: (ev) => clicarEvento(e, ev),
                });
              }
              for (const c of itens?.contas ?? []) {
                const receita = c.tipo === "receita";
                const membro = c.membro_id ? membroPorId.get(c.membro_id) : null;
                pilulas.push({
                  chave: `c${c.id}`,
                  texto: `${membro ? `${membro.nome} · ` : ""}${receita ? "+" : ""}${c.descricao} · ${formatarMoeda(c.valor_centavos)}`,
                  cor: receita
                    ? c.status === "paga"
                      ? "#16a34a"
                      : "#0d9488"
                    : c.status === "paga"
                      ? "#16a34a"
                      : c.vencimento < hoje
                        ? "#dc2626"
                        : "#d97706",
                });
              }
              for (const l of itens?.lembretes ?? []) {
                const membro = l.membro_id ? membroPorId.get(l.membro_id) : null;
                pilulas.push({
                  chave: `l${l.id}`,
                  texto: `✓ ${membro ? `${membro.nome} · ` : ""}${l.titulo}`,
                  cor: l.concluido ? "#9ca3af" : "#7c3aed",
                });
              }
              const visiveis = pilulas.slice(0, 3);
              return (
                <div
                  key={d.iso}
                  className={`dia ${d.doMes ? "" : "fora-mes"} ${d.iso === hoje ? "hoje" : ""}`}
                  onClick={() => clicarDia(d)}
                >
                  <div className="numero-dia">{d.numero}</div>
                  {visiveis.map((p) => (
                    <div
                      key={p.chave}
                      className="pilula"
                      style={{ background: p.cor }}
                      title={p.texto}
                      onClick={p.aoClicar}
                    >
                      {p.texto}
                    </div>
                  ))}
                  {pilulas.length > 3 && (
                    <div className="mais">+{pilulas.length - 3} mais</div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className="legenda">
        <strong>Legenda:</strong>
        <span><i style={{ background: "#d97706" }} /> conta pendente</span>
        <span><i style={{ background: "#dc2626" }} /> conta atrasada</span>
        <span><i style={{ background: "#16a34a" }} /> paga / recebida</span>
        <span><i style={{ background: "#0d9488" }} /> receita a receber</span>
        <span><i style={{ background: "#7c3aed" }} /> lembrete</span>
        <span>demais cores são eventos</span>
      </div>

      <EventoForm
        aberto={formAberto}
        aoFechar={() => setFormAberto(false)}
        aoSalvar={carregar}
        eventoEditando={editando}
        dataInicial={dataNova}
      />
    </div>
  );
}
