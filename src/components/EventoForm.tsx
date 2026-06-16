import { FormEvent, useEffect, useState } from "react";
import Modal from "./Modal";
import { atualizarEvento, criarEvento, excluirEvento } from "../lib/db";
import { hojeISO } from "../lib/format";
import type { Evento } from "../lib/types";

const CORES = [
  { valor: "#0ea5e9", nome: "Azul" },
  { valor: "#10b981", nome: "Verde" },
  { valor: "#f59e0b", nome: "Laranja" },
  { valor: "#ef4444", nome: "Vermelho" },
  { valor: "#8b5cf6", nome: "Roxo" },
];

interface Props {
  aberto: boolean;
  aoFechar: () => void;
  aoSalvar: () => void;
  eventoEditando: Evento | null;
  dataInicial?: string;
}

export default function EventoForm({
  aberto,
  aoFechar,
  aoSalvar,
  eventoEditando,
  dataInicial,
}: Props) {
  const [titulo, setTitulo] = useState("");
  const [data, setData] = useState(hojeISO());
  const [hora, setHora] = useState("");
  const [descricao, setDescricao] = useState("");
  const [cor, setCor] = useState(CORES[0].valor);
  const [erro, setErro] = useState("");

  useEffect(() => {
    if (!aberto) return;
    setErro("");
    if (eventoEditando) {
      setTitulo(eventoEditando.titulo);
      setData(eventoEditando.data);
      setHora(eventoEditando.hora ?? "");
      setDescricao(eventoEditando.descricao ?? "");
      setCor(eventoEditando.cor);
    } else {
      setTitulo("");
      setData(dataInicial ?? hojeISO());
      setHora("");
      setDescricao("");
      setCor(CORES[0].valor);
    }
  }, [aberto, eventoEditando, dataInicial]);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!titulo.trim()) return setErro("Informe o título.");
    if (!data) return setErro("Informe a data.");
    try {
      const campos = {
        titulo: titulo.trim(),
        data,
        hora: hora || null,
        descricao: descricao.trim() || null,
        cor,
      };
      if (eventoEditando) {
        await atualizarEvento({ ...campos, id: eventoEditando.id });
      } else {
        await criarEvento(campos);
      }
      aoSalvar();
      aoFechar();
    } catch (err) {
      setErro(`Erro ao salvar: ${err}`);
    }
  }

  async function excluir() {
    if (!eventoEditando) return;
    await excluirEvento(eventoEditando.id);
    aoSalvar();
    aoFechar();
  }

  return (
    <Modal
      titulo={eventoEditando ? "Editar evento" : "Novo evento"}
      aberto={aberto}
      aoFechar={aoFechar}
    >
      <form onSubmit={salvar}>
        <div className="form-grid">
          <label className="campo largura-total">
            Título
            <input
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Ex: Consulta médica"
              autoFocus
            />
          </label>
          <label className="campo">
            Data
            <input
              type="date"
              value={data}
              onChange={(e) => setData(e.target.value)}
            />
          </label>
          <label className="campo">
            Hora (opcional)
            <input
              type="time"
              value={hora}
              onChange={(e) => setHora(e.target.value)}
            />
          </label>
          <label className="campo">
            Cor
            <select value={cor} onChange={(e) => setCor(e.target.value)}>
              {CORES.map((c) => (
                <option key={c.valor} value={c.valor}>
                  {c.nome}
                </option>
              ))}
            </select>
          </label>
          <label className="campo largura-total">
            Descrição
            <textarea
              rows={2}
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Opcional"
            />
          </label>
        </div>

        {erro && <p style={{ color: "var(--red)", fontWeight: 600 }}>{erro}</p>}

        <div className="acoes">
          {eventoEditando && (
            <button
              type="button"
              className="btn-perigo"
              onClick={excluir}
              style={{ marginRight: "auto" }}
            >
              Excluir
            </button>
          )}
          <button type="button" className="btn-secundario" onClick={aoFechar}>
            Cancelar
          </button>
          <button type="submit" className="btn-primario">
            {eventoEditando ? "Salvar" : "Adicionar evento"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
