import { FormEvent, useEffect, useMemo, useState } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import Modal from "./Modal";
import { atualizarConta, criarConta } from "../lib/db";
import { formatarMoeda, hojeISO, parseMoeda } from "../lib/format";
import type { Categoria, Conta, Membro, TipoConta } from "../lib/types";

interface Props {
  aberto: boolean;
  aoFechar: () => void;
  aoSalvar: () => void;
  categorias: Categoria[];
  membros: Membro[];
  contaEditando: Conta | null;
  dataInicial?: string;
}

const TEXTOS = {
  despesa: {
    novo: "Nova despesa",
    editar: "Editar despesa",
    placeholder: "Ex: Conta de luz",
    data: "Vencimento",
    dataParcelada: "Vencimento da 1ª parcela",
    recorrente: "Despesa recorrente (mensal) — ex: aluguel, internet",
    adicionar: "Adicionar despesa",
  },
  receita: {
    novo: "Nova receita",
    editar: "Editar receita",
    placeholder: "Ex: Salário",
    data: "Data de recebimento",
    dataParcelada: "Data do 1º recebimento",
    recorrente: "Receita recorrente (mensal) — ex: salário",
    adicionar: "Adicionar receita",
  },
} as const;

export default function ContaForm({
  aberto,
  aoFechar,
  aoSalvar,
  categorias,
  membros,
  contaEditando,
  dataInicial,
}: Props) {
  const [tipo, setTipo] = useState<TipoConta>("despesa");
  const [descricao, setDescricao] = useState("");
  const [categoriaId, setCategoriaId] = useState<string>("");
  const [membroId, setMembroId] = useState<string>("");
  const [valor, setValor] = useState("");
  const [vencimento, setVencimento] = useState(hojeISO());
  const [observacoes, setObservacoes] = useState("");
  const [recorrente, setRecorrente] = useState(false);
  const [mesesRecorrencia, setMesesRecorrencia] = useState(12);
  const [parcelado, setParcelado] = useState(false);
  const [parcelaTotal, setParcelaTotal] = useState(2);
  const [erro, setErro] = useState("");

  const t = TEXTOS[tipo];

  // Só categorias do tipo selecionado
  const categoriasDoTipo = useMemo(
    () => categorias.filter((c) => c.tipo === tipo),
    [categorias, tipo],
  );
  const membrosDisponiveis = useMemo(
    () =>
      membros.filter(
        (m) => m.ativo === 1 || m.id === contaEditando?.membro_id,
      ),
    [membros, contaEditando],
  );

  useEffect(() => {
    if (!aberto) return;
    setErro("");
    if (contaEditando) {
      setTipo(contaEditando.tipo);
      setDescricao(contaEditando.descricao);
      setCategoriaId(contaEditando.categoria_id?.toString() ?? "");
      setMembroId(contaEditando.membro_id?.toString() ?? "");
      setValor(
        formatarMoeda(contaEditando.valor_centavos).replace(/R\$\s?/, ""),
      );
      setVencimento(contaEditando.vencimento);
      setObservacoes(contaEditando.observacoes ?? "");
      setRecorrente(false);
      setParcelado(false);
    } else {
      setTipo("despesa");
      setDescricao("");
      setCategoriaId("");
      setMembroId("");
      setValor("");
      setVencimento(dataInicial ?? hojeISO());
      setObservacoes("");
      setRecorrente(false);
      setMesesRecorrencia(12);
      setParcelado(false);
      setParcelaTotal(2);
    }
  }, [aberto, contaEditando, dataInicial]);

  function mudarTipo(novo: TipoConta) {
    if (novo === tipo) return;
    setTipo(novo);
    setCategoriaId("");
    if (novo === "receita") {
      // Parcelamento só existe para despesas
      setParcelado(false);
    }
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    const centavos = parseMoeda(valor);
    if (!descricao.trim()) return setErro("Informe a descrição.");
    if (centavos <= 0) return setErro("Informe um valor válido.");
    if (!vencimento) return setErro("Informe a data.");

    try {
      if (contaEditando) {
        await atualizarConta(contaEditando.id, {
          descricao: descricao.trim(),
          categoria_id: categoriaId ? Number(categoriaId) : null,
          membro_id: membroId ? Number(membroId) : null,
          valor_centavos: centavos,
          vencimento,
          observacoes: observacoes.trim() || null,
          tipo,
        });
      } else {
        await criarConta({
          descricao: descricao.trim(),
          categoria_id: categoriaId ? Number(categoriaId) : null,
          membro_id: membroId ? Number(membroId) : null,
          valor_centavos: centavos,
          vencimento,
          observacoes: observacoes.trim() || null,
          tipo,
          recorrente,
          meses_recorrencia: mesesRecorrencia,
          parcelado,
          parcela_total: parcelaTotal,
        });
      }
      aoSalvar();
      aoFechar();
    } catch (err) {
      setErro(`Erro ao salvar: ${err}`);
    }
  }

  return (
    <Modal
      titulo={contaEditando ? t.editar : t.novo}
      aberto={aberto}
      aoFechar={aoFechar}
    >
      <form onSubmit={salvar} className={`form-conta ${tipo}`}>
        {!contaEditando && (
          <div className="seletor-tipo">
            <button
              type="button"
              className={tipo === "despesa" ? "ativo despesa" : ""}
              onClick={() => mudarTipo("despesa")}
            >
              <TrendingDown size={15} /> Despesa
            </button>
            <button
              type="button"
              className={tipo === "receita" ? "ativo receita" : ""}
              onClick={() => mudarTipo("receita")}
            >
              <TrendingUp size={15} /> Receita
            </button>
          </div>
        )}
        <div className="form-grid">
          <label className="campo largura-total">
            Descrição
            <input
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder={t.placeholder}
              autoFocus
            />
          </label>
          <label className="campo">
            Categoria
            <select
              value={categoriaId}
              onChange={(e) => setCategoriaId(e.target.value)}
            >
              <option value="">Sem categoria</option>
              {categoriasDoTipo.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </label>
          <label className="campo">
            Valor (R$){parcelado ? " — por parcela" : ""}
            <input
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              placeholder="0,00"
              inputMode="decimal"
            />
          </label>
          <label className="campo">
            Responsável
            <select value={membroId} onChange={(e) => setMembroId(e.target.value)}>
              <option value="">Família inteira</option>
              {membrosDisponiveis.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nome}
                  {m.ativo !== 1 ? " (arquivado)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="campo">
            {parcelado ? t.dataParcelada : t.data}
            <input
              type="date"
              value={vencimento}
              onChange={(e) => setVencimento(e.target.value)}
            />
          </label>
          <label className="campo">
            Observações
            <input
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              placeholder="Opcional"
            />
          </label>

          {!contaEditando && (
            <>
              <label className="caixa largura-total">
                <input
                  type="checkbox"
                  checked={recorrente}
                  disabled={parcelado}
                  onChange={(e) => setRecorrente(e.target.checked)}
                />
                {t.recorrente}
              </label>
              {tipo === "despesa" && (
                <label className="caixa largura-total">
                  <input
                    type="checkbox"
                    checked={parcelado}
                    disabled={recorrente}
                    onChange={(e) => setParcelado(e.target.checked)}
                  />
                  Compra parcelada — ex: 12x no cartão
                </label>
              )}
              {recorrente && (
                <label className="campo">
                  Gerar quantos meses?
                  <input
                    type="number"
                    min={2}
                    max={60}
                    value={mesesRecorrencia}
                    onChange={(e) =>
                      setMesesRecorrencia(Number(e.target.value))
                    }
                  />
                </label>
              )}
              {parcelado && (
                <label className="campo">
                  Número de parcelas
                  <input
                    type="number"
                    min={2}
                    max={120}
                    value={parcelaTotal}
                    onChange={(e) => setParcelaTotal(Number(e.target.value))}
                  />
                </label>
              )}
            </>
          )}
        </div>

        {erro && <p style={{ color: "var(--red)", fontWeight: 600 }}>{erro}</p>}

        <div className="acoes">
          <button type="button" className="btn-secundario" onClick={aoFechar}>
            Cancelar
          </button>
          <button
            type="submit"
            className="btn-primario"
            style={
              tipo === "receita" ? { background: "var(--green)" } : undefined
            }
          >
            {contaEditando ? "Salvar alterações" : t.adicionar}
          </button>
        </div>
      </form>
    </Modal>
  );
}
