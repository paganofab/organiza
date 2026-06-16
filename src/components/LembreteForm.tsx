import { FormEvent, useEffect, useState } from "react";
import Modal from "./Modal";
import { atualizarLembrete, criarLembrete } from "../lib/db";
import type { Lembrete, Recorrencia } from "../lib/types";

const RECORRENCIAS: { valor: Recorrencia; nome: string }[] = [
  { valor: "nenhuma", nome: "Não se repete" },
  { valor: "diario", nome: "Todo dia" },
  { valor: "semanal", nome: "Toda semana" },
  { valor: "mensal", nome: "Todo mês" },
];

interface Props {
  aberto: boolean;
  aoFechar: () => void;
  aoSalvar: () => void;
  lembreteEditando: Lembrete | null;
  dataInicial?: string;
}

export default function LembreteForm({
  aberto,
  aoFechar,
  aoSalvar,
  lembreteEditando,
  dataInicial,
}: Props) {
  const [titulo, setTitulo] = useState("");
  const [comData, setComData] = useState(true);
  const [data, setData] = useState("");
  const [hora, setHora] = useState("");
  const [recorrencia, setRecorrencia] = useState<Recorrencia>("nenhuma");
  const [observacoes, setObservacoes] = useState("");
  const [erro, setErro] = useState("");

  useEffect(() => {
    if (!aberto) return;
    setErro("");
    if (lembreteEditando) {
      setTitulo(lembreteEditando.titulo);
      setComData(!!lembreteEditando.data);
      setData(lembreteEditando.data ?? "");
      setHora(lembreteEditando.hora ?? "");
      setRecorrencia(lembreteEditando.recorrencia);
      setObservacoes(lembreteEditando.observacoes ?? "");
    } else {
      setTitulo("");
      setComData(true);
      setData(dataInicial ?? "");
      setHora("");
      setRecorrencia("nenhuma");
      setObservacoes("");
    }
  }, [aberto, lembreteEditando, dataInicial]);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!titulo.trim()) return setErro("Informe o que lembrar.");
    if (comData && !data) return setErro("Informe a data ou desmarque “tem data”.");

    const campos = {
      titulo: titulo.trim(),
      data: comData ? data : null,
      hora: comData && hora ? hora : null,
      recorrencia: comData ? recorrencia : "nenhuma",
      observacoes: observacoes.trim() || null,
    };
    try {
      if (lembreteEditando) {
        await atualizarLembrete(lembreteEditando.id, campos);
      } else {
        await criarLembrete(campos);
      }
      aoSalvar();
      aoFechar();
    } catch (err) {
      setErro(`Erro ao salvar: ${err}`);
    }
  }

  return (
    <Modal
      titulo={lembreteEditando ? "Editar lembrete" : "Novo lembrete"}
      aberto={aberto}
      aoFechar={aoFechar}
    >
      <form onSubmit={salvar}>
        <div className="form-grid">
          <label className="campo largura-total">
            O que lembrar?
            <input
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Ex: Levar o lixo para fora"
              autoFocus
            />
          </label>

          <label className="caixa largura-total">
            <input
              type="checkbox"
              checked={comData}
              onChange={(e) => setComData(e.target.checked)}
            />
            Tem data/prazo
          </label>

          {comData && (
            <>
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
              <label className="campo largura-total">
                Repetir
                <select
                  value={recorrencia}
                  onChange={(e) => setRecorrencia(e.target.value as Recorrencia)}
                >
                  {RECORRENCIAS.map((r) => (
                    <option key={r.valor} value={r.valor}>
                      {r.nome}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}

          <label className="campo largura-total">
            Observações
            <textarea
              rows={2}
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              placeholder="Opcional"
            />
          </label>
        </div>

        {erro && <p style={{ color: "var(--red)", fontWeight: 600 }}>{erro}</p>}

        <div className="acoes">
          <button type="button" className="btn-secundario" onClick={aoFechar}>
            Cancelar
          </button>
          <button type="submit" className="btn-primario">
            {lembreteEditando ? "Salvar" : "Adicionar lembrete"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
