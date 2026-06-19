import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  Check,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Pencil,
  Plus,
  Receipt,
  RotateCcw,
  Trash2,
} from "lucide-react";
import Modal from "../components/Modal";
import { MembroBadge } from "../components/MembroBadge";
import { IconeCategoria } from "../lib/icons";
import {
  atualizarCartaoCredito,
  atualizarLancamentoCartao,
  criarCartaoCredito,
  criarLancamentoCartao,
  excluirLancamentoCartao,
  listarCartoesCredito,
  listarCategorias,
  listarFaturasCartao,
  listarLancamentosCartao,
  listarMembros,
  marcarFaturaCartaoPaga,
  marcarFaturaCartaoPendente,
  mesFaturaCartao,
} from "../lib/db";
import {
  formatarData,
  formatarMoeda,
  hojeISO,
  nomeMesAno,
  parseMoeda,
  somarMeses,
} from "../lib/format";
import type {
  CartaoCredito,
  Categoria,
  FaturaCartao,
  LancamentoCartao,
  Membro,
  NovoCartaoCredito,
} from "../lib/types";

function formatarPercentualBps(bps: number): string {
  return (bps / 100)
    .toFixed(2)
    .replace(".", ",")
    .replace(/,00$/, "")
    .replace(/,(\d)0$/, ",$1");
}

function parsePercentualBps(texto: string): number {
  const valor = Number(texto.replace(",", "."));
  return Number.isFinite(valor) ? Math.max(0, Math.round(valor * 100)) : 0;
}

export default function Cartoes() {
  const hoje = hojeISO();
  const [anoMes, setAnoMes] = useState(hoje.slice(0, 7));
  const [cartoes, setCartoes] = useState<CartaoCredito[]>([]);
  const [lancamentos, setLancamentos] = useState<LancamentoCartao[]>([]);
  const [faturas, setFaturas] = useState<FaturaCartao[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [membros, setMembros] = useState<Membro[]>([]);
  const [filtroCartao, setFiltroCartao] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [erro, setErro] = useState("");

  const [cartaoModal, setCartaoModal] = useState(false);
  const [cartaoEditando, setCartaoEditando] = useState<CartaoCredito | null>(null);
  const [cartaoNome, setCartaoNome] = useState("");
  const [cartaoEmissor, setCartaoEmissor] = useState("");
  const [cartaoCor, setCartaoCor] = useState("#4f46e5");
  const [cartaoMembroId, setCartaoMembroId] = useState("");
  const [diaFechamento, setDiaFechamento] = useState(1);
  const [diaVencimento, setDiaVencimento] = useState(10);
  const [cashbackPct, setCashbackPct] = useState("0");
  const [cashbackNaFatura, setCashbackNaFatura] = useState(true);

  const [compraModal, setCompraModal] = useState(false);
  const [compraEditando, setCompraEditando] = useState<LancamentoCartao | null>(
    null,
  );
  const [compraCartaoId, setCompraCartaoId] = useState("");
  const [compraDescricao, setCompraDescricao] = useState("");
  const [compraCategoriaId, setCompraCategoriaId] = useState("");
  const [compraMembroId, setCompraMembroId] = useState("");
  const [compraValor, setCompraValor] = useState("");
  const [compraData, setCompraData] = useState(hoje);
  const [compraObservacoes, setCompraObservacoes] = useState("");
  const [compraParcelada, setCompraParcelada] = useState(false);
  const [compraParcelas, setCompraParcelas] = useState(2);
  const [cashbackElegivel, setCashbackElegivel] = useState(true);

  const carregar = useCallback(async () => {
    const [cards, charges, bills, cats, mems] = await Promise.all([
      listarCartoesCredito(true),
      listarLancamentosCartao(),
      listarFaturasCartao(),
      listarCategorias(),
      listarMembros(true),
    ]);
    setCartoes(cards);
    setLancamentos(charges);
    setFaturas(bills);
    setCategorias(cats);
    setMembros(mems);
  }, []);

  useEffect(() => {
    carregar().catch(console.error);
  }, [carregar]);

  function avisar(texto: string) {
    setMensagem(texto);
    setErro("");
    setTimeout(() => setMensagem(""), 4000);
  }

  const cartaoPorId = useMemo(
    () => new Map(cartoes.map((c) => [c.id, c])),
    [cartoes],
  );
  const catPorId = useMemo(
    () => new Map(categorias.map((c) => [c.id, c])),
    [categorias],
  );
  const membroPorId = useMemo(
    () => new Map(membros.map((m) => [m.id, m])),
    [membros],
  );
  const cartoesAtivos = useMemo(
    () => cartoes.filter((c) => c.ativo === 1),
    [cartoes],
  );
  const categoriasDespesa = useMemo(
    () => categorias.filter((c) => c.tipo === "despesa"),
    [categorias],
  );

  const faturasMes = useMemo(
    () =>
      faturas.filter(
        (f) =>
          f.ano_mes === anoMes &&
          (!filtroCartao || f.cartao_id === Number(filtroCartao)),
      ),
    [faturas, anoMes, filtroCartao],
  );

  const totalBruto = faturasMes.reduce(
    (total, f) => total + f.valor_bruto_centavos,
    0,
  );
  const totalCashback = faturasMes.reduce(
    (total, f) => total + f.cashback_centavos,
    0,
  );
  const totalLiquido = faturasMes.reduce(
    (total, f) => total + f.valor_liquido_centavos,
    0,
  );
  const totalPendente = faturasMes
    .filter((f) => f.status === "pendente")
    .reduce((total, f) => total + f.valor_liquido_centavos, 0);

  function mudarMes(delta: number) {
    setAnoMes(somarMeses(`${anoMes}-01`, delta).slice(0, 7));
  }

  function abrirNovoCartao() {
    setCartaoEditando(null);
    setCartaoNome("");
    setCartaoEmissor("");
    setCartaoCor("#4f46e5");
    setCartaoMembroId("");
    setDiaFechamento(1);
    setDiaVencimento(10);
    setCashbackPct("0");
    setCashbackNaFatura(true);
    setErro("");
    setCartaoModal(true);
  }

  function abrirEditarCartao(cartao: CartaoCredito) {
    setCartaoEditando(cartao);
    setCartaoNome(cartao.nome);
    setCartaoEmissor(cartao.emissor ?? "");
    setCartaoCor(cartao.cor);
    setCartaoMembroId(cartao.membro_id?.toString() ?? "");
    setDiaFechamento(cartao.dia_fechamento);
    setDiaVencimento(cartao.dia_vencimento);
    setCashbackPct(formatarPercentualBps(cartao.cashback_percentual_bps));
    setCashbackNaFatura(cartao.cashback_aplica_na_fatura === 1);
    setErro("");
    setCartaoModal(true);
  }

  async function salvarCartao(e: FormEvent) {
    e.preventDefault();
    const nome = cartaoNome.trim();
    if (!nome) return setErro("Informe o nome do cartão.");
    if (diaFechamento < 1 || diaFechamento > 31) {
      return setErro("Dia de fechamento deve ficar entre 1 e 31.");
    }
    if (diaVencimento < 1 || diaVencimento > 31) {
      return setErro("Dia de vencimento deve ficar entre 1 e 31.");
    }

    const campos: NovoCartaoCredito = {
      nome,
      emissor: cartaoEmissor.trim() || null,
      cor: cartaoCor,
      icone: "credit-card",
      membro_id: cartaoMembroId ? Number(cartaoMembroId) : null,
      dia_fechamento: diaFechamento,
      dia_vencimento: diaVencimento,
      cashback_percentual_bps: parsePercentualBps(cashbackPct),
      cashback_aplica_na_fatura: cashbackNaFatura,
      ativo: cartaoEditando ? cartaoEditando.ativo === 1 : true,
    };

    try {
      if (cartaoEditando) {
        await atualizarCartaoCredito(cartaoEditando.id, campos);
        avisar(`Cartão "${nome}" atualizado.`);
      } else {
        await criarCartaoCredito(campos);
        avisar(`Cartão "${nome}" criado.`);
      }
      setCartaoModal(false);
      await carregar();
    } catch {
      setErro("Já existe um cartão com esse nome.");
    }
  }

  async function alternarCartaoAtivo(cartao: CartaoCredito) {
    await atualizarCartaoCredito(cartao.id, {
      nome: cartao.nome,
      emissor: cartao.emissor,
      cor: cartao.cor,
      icone: cartao.icone,
      membro_id: cartao.membro_id,
      dia_fechamento: cartao.dia_fechamento,
      dia_vencimento: cartao.dia_vencimento,
      cashback_percentual_bps: cartao.cashback_percentual_bps,
      cashback_aplica_na_fatura: cartao.cashback_aplica_na_fatura === 1,
      ativo: cartao.ativo !== 1,
    });
    await carregar();
    avisar(
      cartao.ativo === 1
        ? `${cartao.nome} foi arquivado.`
        : `${cartao.nome} foi reativado.`,
    );
  }

  function definirCartaoCompra(cartaoId: string) {
    setCompraCartaoId(cartaoId);
    const cartao = cartaoId ? cartaoPorId.get(Number(cartaoId)) : null;
    setCompraMembroId(cartao?.membro_id?.toString() ?? "");
  }

  function abrirNovaCompra(cartaoId?: number) {
    const cartaoFiltrado = filtroCartao
      ? cartaoPorId.get(Number(filtroCartao))
      : null;
    const id =
      cartaoId ??
      (cartaoFiltrado?.ativo === 1
        ? cartaoFiltrado.id
        : cartoesAtivos[0]?.id ?? null);
    const cartao = id ? cartaoPorId.get(id) : null;
    setCompraEditando(null);
    setCompraCartaoId(id?.toString() ?? "");
    setCompraDescricao("");
    setCompraCategoriaId("");
    setCompraMembroId(cartao?.membro_id?.toString() ?? "");
    setCompraValor("");
    setCompraData(hoje);
    setCompraObservacoes("");
    setCompraParcelada(false);
    setCompraParcelas(2);
    setCashbackElegivel(true);
    setErro("");
    setCompraModal(true);
  }

  function abrirEditarCompra(compra: LancamentoCartao) {
    setCompraEditando(compra);
    setCompraCartaoId(compra.cartao_id.toString());
    setCompraDescricao(compra.descricao);
    setCompraCategoriaId(compra.categoria_id?.toString() ?? "");
    setCompraMembroId(compra.membro_id?.toString() ?? "");
    setCompraValor(formatarMoeda(compra.valor_centavos).replace(/R\$\s?/, ""));
    setCompraData(compra.data_compra);
    setCompraObservacoes(compra.observacoes ?? "");
    setCompraParcelada(false);
    setCompraParcelas(compra.parcela_total ?? 2);
    setCashbackElegivel(compra.cashback_elegivel === 1);
    setErro("");
    setCompraModal(true);
  }

  async function salvarCompra(e: FormEvent) {
    e.preventDefault();
    const valorCentavos = parseMoeda(compraValor);
    if (!compraCartaoId) return setErro("Escolha o cartão.");
    if (!compraDescricao.trim()) return setErro("Informe a descrição.");
    if (valorCentavos <= 0) return setErro("Informe um valor válido.");
    if (!compraData) return setErro("Informe a data da compra.");

    try {
      if (compraEditando) {
        await atualizarLancamentoCartao(compraEditando.id, {
          cartao_id: Number(compraCartaoId),
          descricao: compraDescricao.trim(),
          categoria_id: compraCategoriaId ? Number(compraCategoriaId) : null,
          membro_id: compraMembroId ? Number(compraMembroId) : null,
          valor_centavos: valorCentavos,
          data_compra: compraData,
          observacoes: compraObservacoes.trim() || null,
          cashback_elegivel: cashbackElegivel,
        });
        avisar("Compra atualizada.");
      } else {
        await criarLancamentoCartao({
          cartao_id: Number(compraCartaoId),
          descricao: compraDescricao.trim(),
          categoria_id: compraCategoriaId ? Number(compraCategoriaId) : null,
          membro_id: compraMembroId ? Number(compraMembroId) : null,
          valor_centavos: valorCentavos,
          data_compra: compraData,
          observacoes: compraObservacoes.trim() || null,
          parcela_total: compraParcelada ? compraParcelas : 1,
          cashback_elegivel: cashbackElegivel,
        });
        avisar("Compra adicionada.");
      }
      setCompraModal(false);
      await carregar();
    } catch (err) {
      setErro(`Erro ao salvar compra: ${err}`);
    }
  }

  async function excluirCompra(compra: LancamentoCartao) {
    if (!confirm(`Excluir "${compra.descricao}"?`)) return;
    await excluirLancamentoCartao(compra.id);
    await carregar();
  }

  async function alternarFatura(fatura: FaturaCartao) {
    if (fatura.status === "paga") {
      await marcarFaturaCartaoPendente(fatura.cartao_id, fatura.ano_mes);
    } else {
      await marcarFaturaCartaoPaga(fatura.cartao_id, fatura.ano_mes, hoje);
    }
    await carregar();
  }

  function lancamentosDaFatura(fatura: FaturaCartao) {
    const cartao = cartaoPorId.get(fatura.cartao_id);
    if (!cartao) return [];
    return lancamentos
      .filter(
        (l) =>
          l.cartao_id === fatura.cartao_id &&
          mesFaturaCartao(
            l.data_compra,
            cartao.dia_fechamento,
            cartao.dia_vencimento,
          ) === fatura.ano_mes,
      )
      .sort((a, b) => a.data_compra.localeCompare(b.data_compra));
  }

  function cashbackLancamento(compra: LancamentoCartao): number {
    const cartao = cartaoPorId.get(compra.cartao_id);
    if (!cartao || compra.cashback_elegivel !== 1) return 0;
    return Math.round(
      (compra.valor_centavos * cartao.cashback_percentual_bps) / 10000,
    );
  }

  return (
    <div>
      <div className="cabecalho-pagina">
        <div>
          <h1>Cartões</h1>
          <div className="subtitulo">
            Compras, faturas mensais e cashback de cartões de crédito
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
        <button className="btn-secundario" onClick={abrirNovoCartao}>
          <CreditCard size={16} /> Novo cartão
        </button>
        <button
          className="btn-primario"
          onClick={() => abrirNovaCompra()}
          disabled={!cartoesAtivos.length}
        >
          <Plus size={16} /> Nova compra
        </button>
      </div>

      {mensagem && (
        <div className="toast-ok">
          <Check size={16} /> {mensagem}
        </div>
      )}
      {erro && <div className="aviso">{erro}</div>}

      <div className="cards-resumo">
        <div className="card">
          <div className="rotulo">Faturas do mês</div>
          <div className="valor">{formatarMoeda(totalBruto)}</div>
        </div>
        <div className="card">
          <div className="rotulo">Cashback calculado</div>
          <div className="valor verde">{formatarMoeda(totalCashback)}</div>
        </div>
        <div className="card">
          <div className="rotulo">Impacto líquido</div>
          <div className="valor">{formatarMoeda(totalLiquido)}</div>
        </div>
        <div className="card">
          <div className="rotulo">Ainda pendente</div>
          <div className="valor ambar">{formatarMoeda(totalPendente)}</div>
        </div>
      </div>

      <div className="filtros">
        <select
          value={filtroCartao}
          onChange={(e) => setFiltroCartao(e.target.value)}
        >
          <option value="">Todos os cartões</option>
          {cartoes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
              {c.ativo !== 1 ? " (arquivado)" : ""}
            </option>
          ))}
        </select>
      </div>

      <div className="grade-dashboard">
        <div className="card">
          <h2>
            <CreditCard size={16} color="var(--accent)" /> Cartões cadastrados
          </h2>
          <div className="lista-itens">
            {cartoes.length === 0 ? (
              <div className="vazio">
                Nenhum cartão cadastrado. Crie um cartão para começar a lançar
                compras.
              </div>
            ) : (
              cartoes.map((cartao) => {
                const membro = cartao.membro_id
                  ? membroPorId.get(cartao.membro_id)
                  : null;
                return (
                  <div
                    className={`item-linha cartao-linha ${cartao.ativo !== 1 ? "inativo" : ""}`}
                    key={cartao.id}
                  >
                    <div
                      className="icone-cat"
                      style={{ background: `${cartao.cor}22`, color: cartao.cor }}
                    >
                      <CreditCard size={18} />
                    </div>
                    <div className="info">
                      <div className="titulo">
                        {cartao.nome}
                        {cartao.ativo !== 1 && (
                          <span className="badge pendente">Arquivado</span>
                        )}
                      </div>
                      <div className="detalhe">
                        {cartao.emissor ? `${cartao.emissor} · ` : ""}
                        fecha dia {cartao.dia_fechamento} · vence dia{" "}
                        {cartao.dia_vencimento}
                      </div>
                      <div className="detalhe cartao-detalhes">
                        <MembroBadge membro={membro} mostrarFamilia />
                        {cartao.cashback_percentual_bps > 0 && (
                          <span className="badge-membro">
                            cashback{" "}
                            {formatarPercentualBps(
                              cartao.cashback_percentual_bps,
                            )}
                            %
                            {cartao.cashback_aplica_na_fatura === 1
                              ? " na fatura"
                              : ""}
                          </span>
                        )}
                      </div>
                    </div>
                    {cartao.ativo === 1 && (
                      <button
                        className="btn-mini btn-primario"
                        onClick={() => abrirNovaCompra(cartao.id)}
                      >
                        <Plus size={13} /> Compra
                      </button>
                    )}
                    <button
                      className="btn-mini btn-secundario"
                      onClick={() => abrirEditarCartao(cartao)}
                    >
                      <Pencil size={13} /> Editar
                    </button>
                    <button
                      className={
                        cartao.ativo === 1
                          ? "btn-mini btn-perigo"
                          : "btn-mini btn-secundario"
                      }
                      onClick={() => alternarCartaoAtivo(cartao)}
                    >
                      {cartao.ativo === 1 ? (
                        <>
                          <Archive size={13} /> Arquivar
                        </>
                      ) : (
                        <>
                          <RotateCcw size={13} /> Reativar
                        </>
                      )}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="card">
          <h2>
            <Receipt size={16} color="var(--accent)" /> Faturas de{" "}
            {nomeMesAno(anoMes)}
          </h2>
          {faturasMes.length === 0 ? (
            <div className="vazio">Nenhuma fatura neste mês.</div>
          ) : (
            <div className="lista-faturas-cartao">
              {faturasMes.map((fatura) => {
                const compras = lancamentosDaFatura(fatura);
                const membro = fatura.cartao_membro_id
                  ? membroPorId.get(fatura.cartao_membro_id)
                  : null;
                return (
                  <section
                    className="fatura-cartao"
                    key={`${fatura.cartao_id}-${fatura.ano_mes}`}
                  >
                    <div className="fatura-cartao-topo">
                      <div>
                        <div className="titulo">
                          <span
                            className="cartao-cor"
                            style={{ background: fatura.cartao_cor }}
                          />
                          {fatura.cartao_nome}
                        </div>
                        <div className="detalhe">
                          fecha {formatarData(fatura.fechamento)} · vence{" "}
                          {formatarData(fatura.vencimento)}
                        </div>
                        <div className="detalhe">
                          <MembroBadge membro={membro} mostrarFamilia />
                        </div>
                      </div>
                      <div className="fatura-cartao-valores">
                        <span
                          className={`badge ${fatura.status === "paga" ? "paga" : "pendente"}`}
                        >
                          {fatura.status === "paga" ? "Paga" : "Pendente"}
                        </span>
                        <strong>{formatarMoeda(fatura.valor_liquido_centavos)}</strong>
                        {fatura.cashback_centavos > 0 && (
                          <small>
                            bruto {formatarMoeda(fatura.valor_bruto_centavos)} ·
                            cashback {formatarMoeda(fatura.cashback_centavos)}
                          </small>
                        )}
                      </div>
                      <button
                        className={
                          fatura.status === "paga"
                            ? "btn-mini btn-secundario"
                            : "btn-mini btn-primario"
                        }
                        onClick={() => alternarFatura(fatura)}
                      >
                        {fatura.status === "paga" ? "Reabrir" : "Pagar"}
                      </button>
                    </div>
                    <table className="tabela-compacta">
                      <thead>
                        <tr>
                          <th>Compra</th>
                          <th>Categoria</th>
                          <th>Responsável</th>
                          <th className="num">Cashback</th>
                          <th className="num">Valor</th>
                          <th style={{ width: 96 }}>Ações</th>
                        </tr>
                      </thead>
                      <tbody>
                        {compras.map((compra) => {
                          const cat = compra.categoria_id
                            ? catPorId.get(compra.categoria_id)
                            : null;
                          const membroCompra = compra.membro_id
                            ? membroPorId.get(compra.membro_id)
                            : null;
                          return (
                            <tr key={compra.id}>
                              <td>
                                <strong>{compra.descricao}</strong>
                                <div className="detalhe">
                                  {formatarData(compra.data_compra)}
                                  {compra.observacoes
                                    ? ` · ${compra.observacoes}`
                                    : ""}
                                </div>
                              </td>
                              <td>
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
                                  "Sem categoria"
                                )}
                              </td>
                              <td>
                                <MembroBadge membro={membroCompra} mostrarFamilia />
                              </td>
                              <td className="num">
                                {cashbackLancamento(compra) > 0
                                  ? formatarMoeda(cashbackLancamento(compra))
                                  : "—"}
                              </td>
                              <td className="num">
                                <strong>{formatarMoeda(compra.valor_centavos)}</strong>
                              </td>
                              <td>
                                <span style={{ display: "flex", gap: 6 }}>
                                  <button
                                    className="btn-mini btn-secundario"
                                    onClick={() => abrirEditarCompra(compra)}
                                  >
                                    <Pencil size={13} />
                                  </button>
                                  <button
                                    className="btn-mini btn-perigo"
                                    onClick={() => excluirCompra(compra)}
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <Modal
        titulo={cartaoEditando ? "Editar cartão" : "Novo cartão"}
        aberto={cartaoModal}
        aoFechar={() => setCartaoModal(false)}
      >
        <form onSubmit={salvarCartao}>
          <div className="form-grid">
            <label className="campo largura-total">
              Nome do cartão
              <input
                value={cartaoNome}
                onChange={(e) => setCartaoNome(e.target.value)}
                placeholder="Ex: Nubank Ultravioleta"
                autoFocus
              />
            </label>
            <label className="campo">
              Emissor/banco
              <input
                value={cartaoEmissor}
                onChange={(e) => setCartaoEmissor(e.target.value)}
                placeholder="Opcional"
              />
            </label>
            <label className="campo">
              Cor
              <input
                type="color"
                value={cartaoCor}
                onChange={(e) => setCartaoCor(e.target.value)}
                style={{ height: 38, padding: 4 }}
              />
            </label>
            <label className="campo">
              Responsável
              <select
                value={cartaoMembroId}
                onChange={(e) => setCartaoMembroId(e.target.value)}
              >
                <option value="">Família inteira</option>
                {membros
                  .filter(
                    (m) =>
                      m.ativo === 1 || m.id === cartaoEditando?.membro_id,
                  )
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nome}
                      {m.ativo !== 1 ? " (arquivado)" : ""}
                    </option>
                  ))}
              </select>
            </label>
            <label className="campo">
              Dia de fechamento
              <input
                type="number"
                min={1}
                max={31}
                value={diaFechamento}
                onChange={(e) => setDiaFechamento(Number(e.target.value))}
              />
            </label>
            <label className="campo">
              Dia de vencimento
              <input
                type="number"
                min={1}
                max={31}
                value={diaVencimento}
                onChange={(e) => setDiaVencimento(Number(e.target.value))}
              />
            </label>
            <label className="campo">
              Cashback (%)
              <input
                value={cashbackPct}
                onChange={(e) => setCashbackPct(e.target.value)}
                inputMode="decimal"
                placeholder="0"
              />
            </label>
            <label className="caixa">
              <input
                type="checkbox"
                checked={cashbackNaFatura}
                onChange={(e) => setCashbackNaFatura(e.target.checked)}
              />
              Cashback reduz a fatura
            </label>
          </div>
          {erro && <p style={{ color: "var(--red)", fontWeight: 600 }}>{erro}</p>}
          <div className="acoes">
            <button
              type="button"
              className="btn-secundario"
              onClick={() => setCartaoModal(false)}
            >
              Cancelar
            </button>
            <button type="submit" className="btn-primario">
              {cartaoEditando ? "Salvar alterações" : "Criar cartão"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        titulo={compraEditando ? "Editar compra" : "Nova compra no cartão"}
        aberto={compraModal}
        aoFechar={() => setCompraModal(false)}
      >
        <form onSubmit={salvarCompra}>
          <div className="form-grid">
            <label className="campo largura-total">
              Cartão
              <select
                value={compraCartaoId}
                onChange={(e) => definirCartaoCompra(e.target.value)}
                disabled={!!compraEditando}
              >
                <option value="">Escolha um cartão</option>
                {(compraEditando ? cartoes : cartoesAtivos).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                    {c.ativo !== 1 ? " (arquivado)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="campo largura-total">
              Descrição
              <input
                value={compraDescricao}
                onChange={(e) => setCompraDescricao(e.target.value)}
                placeholder="Ex: Mercado, restaurante, passagem"
                autoFocus
              />
            </label>
            <label className="campo">
              Categoria
              <select
                value={compraCategoriaId}
                onChange={(e) => setCompraCategoriaId(e.target.value)}
              >
                <option value="">Sem categoria</option>
                {categoriasDespesa.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </select>
            </label>
            <label className="campo">
              Responsável
              <select
                value={compraMembroId}
                onChange={(e) => setCompraMembroId(e.target.value)}
              >
                <option value="">Família inteira</option>
                {membros
                  .filter(
                    (m) =>
                      m.ativo === 1 ||
                      m.id === compraEditando?.membro_id ||
                      m.id ===
                        cartaoPorId.get(Number(compraCartaoId))?.membro_id,
                  )
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nome}
                      {m.ativo !== 1 ? " (arquivado)" : ""}
                    </option>
                  ))}
              </select>
            </label>
            <label className="campo">
              Valor (R$){compraParcelada && !compraEditando ? " — por parcela" : ""}
              <input
                value={compraValor}
                onChange={(e) => setCompraValor(e.target.value)}
                placeholder="0,00"
                inputMode="decimal"
              />
            </label>
            <label className="campo">
              Data da compra
              <input
                type="date"
                value={compraData}
                onChange={(e) => setCompraData(e.target.value)}
              />
            </label>
            {!compraEditando && (
              <>
                <label className="caixa largura-total">
                  <input
                    type="checkbox"
                    checked={compraParcelada}
                    onChange={(e) => setCompraParcelada(e.target.checked)}
                  />
                  Compra parcelada
                </label>
                {compraParcelada && (
                  <label className="campo">
                    Número de parcelas
                    <input
                      type="number"
                      min={2}
                      max={120}
                      value={compraParcelas}
                      onChange={(e) => setCompraParcelas(Number(e.target.value))}
                    />
                  </label>
                )}
              </>
            )}
            <label className="caixa largura-total">
              <input
                type="checkbox"
                checked={cashbackElegivel}
                onChange={(e) => setCashbackElegivel(e.target.checked)}
              />
              Compra elegível para cashback
            </label>
            <label className="campo largura-total">
              Observações
              <textarea
                rows={2}
                value={compraObservacoes}
                onChange={(e) => setCompraObservacoes(e.target.value)}
                placeholder="Opcional"
              />
            </label>
          </div>
          {erro && <p style={{ color: "var(--red)", fontWeight: 600 }}>{erro}</p>}
          <div className="acoes">
            <button
              type="button"
              className="btn-secundario"
              onClick={() => setCompraModal(false)}
            >
              Cancelar
            </button>
            <button type="submit" className="btn-primario">
              {compraEditando ? "Salvar alterações" : "Adicionar compra"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
