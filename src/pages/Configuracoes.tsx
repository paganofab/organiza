import { FormEvent, useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { open as abrirDialogo } from "@tauri-apps/plugin-dialog";
import {
  Check,
  CircleCheck,
  DatabaseBackup,
  Mail,
  Pencil,
  Power,
  Send,
  Tags,
  TriangleAlert,
  X,
} from "lucide-react";
import { statusTelegram, testarToken } from "../lib/telegram";
import { exportarBackup, restaurarBackup } from "../lib/backup";
import {
  CONFIG_MANTER_ACORDADO,
  definirManterAcordado,
  manterAcordadoAtivo,
} from "../lib/power";

/** Indicador ao vivo do loop de escuta do Telegram. */
function StatusTelegram() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const i = window.setInterval(() => setTick((t) => t + 1), 2000);
    return () => window.clearInterval(i);
  }, []);

  const s = statusTelegram();
  let cor = "var(--amber)";
  let texto = "Conectando…";
  if (s.ultimoErro) {
    cor = "var(--red)";
    texto = `Erro de conexão: ${s.ultimoErro}`;
  } else if (s.ultimaSync) {
    cor = "var(--green)";
    const seg = Math.round((Date.now() - s.ultimaSync) / 1000);
    texto =
      seg < 3
        ? "Escutando — sincronizado agora"
        : `Escutando — última verificação há ${seg < 60 ? `${seg}s` : `${Math.round(seg / 60)}min`}`;
  }

  return (
    <p
      style={{
        marginBottom: 0,
        marginTop: 10,
        display: "flex",
        alignItems: "center",
        gap: 8,
        color: "var(--text-soft)",
        fontSize: 13,
      }}
    >
      <span
        style={{
          width: 9,
          height: 9,
          borderRadius: 99,
          background: cor,
          flexShrink: 0,
        }}
      />
      {texto}
    </p>
  );
}
import { ICONES_CATEGORIA, IconeCategoria } from "../lib/icons";
import {
  atualizarCategoria,
  criarCategoria,
  definirOrcamento,
  excluirCategoria,
  listarCategorias,
  obterConfig,
  salvarConfig,
} from "../lib/db";
import { formatarMoeda, parseMoeda } from "../lib/format";
import { DIAS_AVISO_PADRAO } from "../lib/reminders";
import type { Categoria, SmtpConfig, TipoConta } from "../lib/types";

const SMTP_VAZIO: SmtpConfig = {
  host: "",
  port: 587,
  user: "",
  password: "",
  from: "",
  to: "",
};

export default function Configuracoes() {
  const [smtp, setSmtp] = useState<SmtpConfig>(SMTP_VAZIO);
  const [diasAviso, setDiasAviso] = useState(DIAS_AVISO_PADRAO);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [novaCategoria, setNovaCategoria] = useState("");
  const [novoIcone, setNovoIcone] = useState("tag");
  const [novaCor, setNovaCor] = useState("#6366f1");
  const [novoTipo, setNovoTipo] = useState<TipoConta>("despesa");
  const [editandoCategoriaId, setEditandoCategoriaId] = useState<number | null>(
    null,
  );
  const [categoriaEditNome, setCategoriaEditNome] = useState("");
  const [categoriaEditCor, setCategoriaEditCor] = useState("#6366f1");
  const [categoriaEditIcone, setCategoriaEditIcone] = useState("tag");
  const [mensagem, setMensagem] = useState("");
  const [erro, setErro] = useState("");
  const [testando, setTestando] = useState(false);
  const [autostart, setAutostart] = useState(false);
  const [manterAcordado, setManterAcordado] = useState(false);
  const [alterandoEnergia, setAlterandoEnergia] = useState(false);
  const [orcamentos, setOrcamentos] = useState<Record<number, string>>({});
  const [tgToken, setTgToken] = useState("");
  const [tgChat, setTgChat] = useState<string | null>(null);
  const [tgTestando, setTgTestando] = useState(false);
  const [tgResumoHora, setTgResumoHora] = useState("");

  const carregar = useCallback(async () => {
    const [
      smtpJson,
      dias,
      cats,
      autoLigado,
      token,
      chat,
      resumoHora,
      manterSalvo,
      manterAtivo,
    ] =
      await Promise.all([
        obterConfig("smtp"),
        obterConfig("dias_aviso"),
        listarCategorias(),
        isEnabled().catch(() => false),
        obterConfig("telegram_token"),
        obterConfig("telegram_chat_id"),
        obterConfig("telegram_resumo_hora"),
        obterConfig(CONFIG_MANTER_ACORDADO),
        manterAcordadoAtivo().catch(() => false),
      ]);
    setTgToken(token ?? "");
    setTgChat(chat);
    setTgResumoHora(resumoHora ?? "");
    setAutostart(autoLigado);
    setManterAcordado(manterSalvo === "1" || manterAtivo);
    setOrcamentos(
      Object.fromEntries(
        cats.map((c) => [
          c.id,
          c.orcamento_centavos > 0
            ? (c.orcamento_centavos / 100).toFixed(2).replace(".", ",")
            : "",
        ]),
      ),
    );
    if (smtpJson) {
      try {
        setSmtp({ ...SMTP_VAZIO, ...JSON.parse(smtpJson) });
      } catch {
        // configuração corrompida; mantém vazio
      }
    }
    if (dias) setDiasAviso(parseInt(dias, 10) || DIAS_AVISO_PADRAO);
    setCategorias(cats);
  }, []);

  useEffect(() => {
    carregar().catch(console.error);
  }, [carregar]);

  // Detecta o pareamento do Telegram (feito pelo polling em segundo plano)
  useEffect(() => {
    if (!tgToken || tgChat) return;
    const i = window.setInterval(async () => {
      const chat = await obterConfig("telegram_chat_id");
      if (chat) setTgChat(chat);
    }, 5000);
    return () => window.clearInterval(i);
  }, [tgToken, tgChat]);

  function avisar(msg: string) {
    setMensagem(msg);
    setErro("");
    setTimeout(() => setMensagem(""), 4000);
  }

  async function salvarTudo(e: FormEvent) {
    e.preventDefault();
    await salvarConfig("smtp", JSON.stringify(smtp));
    await salvarConfig("dias_aviso", String(diasAviso));
    avisar("Configurações salvas!");
  }

  async function testarEmail() {
    setTestando(true);
    setErro("");
    try {
      await invoke("send_email", {
        config: smtp,
        subject: "Organiza — email de teste",
        body: "<h2>Funcionou! ✅</h2><p>Seu SMTP está configurado corretamente no Organiza.</p>",
      });
      avisar("Email de teste enviado! Verifique sua caixa de entrada.");
    } catch (err) {
      setErro(`Falha no envio: ${err}`);
    } finally {
      setTestando(false);
    }
  }

  async function adicionarCategoria(e: FormEvent) {
    e.preventDefault();
    if (!novaCategoria.trim()) return;
    try {
      await criarCategoria(
        novaCategoria.trim(),
        novaCor,
        novoIcone || "tag",
        novoTipo,
      );
      setNovaCategoria("");
      await carregar();
    } catch {
      setErro("Já existe uma categoria com esse nome.");
    }
  }

  function iniciarEdicaoCategoria(c: Categoria) {
    setEditandoCategoriaId(c.id);
    setCategoriaEditNome(c.nome);
    setCategoriaEditCor(c.cor);
    setCategoriaEditIcone(c.icone || "tag");
    setErro("");
  }

  function cancelarEdicaoCategoria() {
    setEditandoCategoriaId(null);
    setCategoriaEditNome("");
    setCategoriaEditCor("#6366f1");
    setCategoriaEditIcone("tag");
  }

  async function salvarCategoria(c: Categoria) {
    const nome = categoriaEditNome.trim();
    if (!nome) {
      setErro("Informe o nome da categoria.");
      return;
    }
    try {
      await atualizarCategoria(c.id, {
        nome,
        cor: categoriaEditCor,
        icone: categoriaEditIcone || "tag",
      });
      cancelarEdicaoCategoria();
      await carregar();
      avisar(`Categoria "${nome}" atualizada.`);
    } catch {
      setErro("Já existe uma categoria com esse nome.");
    }
  }

  async function salvarTelegram() {
    const token = tgToken.trim();
    if (!token) {
      await salvarConfig("telegram_token", "");
      await salvarConfig("telegram_chat_id", "");
      setTgChat(null);
      avisar("Integração com Telegram desativada.");
      return;
    }
    setTgTestando(true);
    setErro("");
    try {
      const username = await testarToken(token);
      await salvarConfig("telegram_token", token);
      avisar(
        `Bot @${username} conectado! Agora envie qualquer mensagem para ele no Telegram para parear.`,
      );
    } catch (err) {
      setErro(`Token inválido: ${err}`);
    } finally {
      setTgTestando(false);
    }
  }

  async function salvarResumoHora(valor: string) {
    setTgResumoHora(valor);
    await salvarConfig("telegram_resumo_hora", valor);
    // Reseta o controle de "enviado hoje" para o novo horário valer já hoje
    await salvarConfig("telegram_resumo_ultimo", "");
    avisar(
      valor
        ? `Resumo diário às ${valor} ativado.`
        : "Resumo diário desativado.",
    );
  }

  async function desparearTelegram() {
    await salvarConfig("telegram_chat_id", "");
    setTgChat(null);
    avisar(
      "Chat despareado. A próxima mensagem enviada ao bot fará um novo pareamento.",
    );
  }

  async function fazerExportacao() {
    try {
      const ok = await exportarBackup();
      if (ok) avisar("Backup exportado com sucesso!");
    } catch (err) {
      setErro(`Falha ao exportar backup: ${err}`);
    }
  }

  async function fazerRestauracao() {
    const escolhido = await abrirDialogo({
      multiple: false,
      title: "Selecionar backup (.db)",
      filters: [{ name: "Banco Organiza", extensions: ["db"] }],
    });
    if (!escolhido || typeof escolhido !== "string") return;
    if (
      !confirm(
        "Restaurar este backup vai SUBSTITUIR todos os dados atuais. O app será reiniciado. Deseja continuar?",
      )
    )
      return;
    try {
      await restaurarBackup(escolhido);
      alert(
        "Backup restaurado! Feche e abra o Organiza novamente para carregar os dados.",
      );
    } catch (err) {
      setErro(`Falha ao restaurar: ${err}`);
    }
  }

  async function alternarAutostart() {
    try {
      if (autostart) {
        await disable();
        setAutostart(false);
        avisar("O Organiza não vai mais abrir com o sistema.");
      } else {
        await enable();
        setAutostart(true);
        avisar("O Organiza vai abrir junto com o sistema (em segundo plano).");
      }
    } catch (err) {
      setErro(`Não foi possível alterar o autostart: ${err}`);
    }
  }

  async function alternarManterAcordado() {
    const novo = !manterAcordado;
    setAlterandoEnergia(true);
    setErro("");
    try {
      const aplicado = await definirManterAcordado(novo);
      setManterAcordado(aplicado);
      avisar(
        aplicado
          ? "O macOS não vai colocar o Mac em repouso automático enquanto o Organiza estiver aberto."
          : "Repouso automático liberado.",
      );
    } catch (err) {
      setErro(`Não foi possível alterar o modo acordado: ${err}`);
    } finally {
      setAlterandoEnergia(false);
    }
  }

  async function salvarOrcamento(c: Categoria) {
    const centavos = parseMoeda(orcamentos[c.id] ?? "");
    if (centavos === c.orcamento_centavos) return;
    await definirOrcamento(c.id, centavos);
    await carregar();
    avisar(
      centavos > 0
        ? `Orçamento de ${c.nome} definido em ${formatarMoeda(centavos)}.`
        : `Orçamento de ${c.nome} removido.`,
    );
  }

  async function removerCategoria(c: Categoria) {
    if (
      !confirm(
        `Excluir a categoria "${c.nome}"? As contas dessa categoria ficarão sem categoria.`,
      )
    )
      return;
    await excluirCategoria(c.id);
    await carregar();
  }

  function campo(rotulo: string, chave: keyof SmtpConfig, tipo = "text", dica = "") {
    return (
      <label className="campo">
        {rotulo}
        <input
          type={tipo}
          value={smtp[chave]}
          placeholder={dica}
          onChange={(e) =>
            setSmtp({
              ...smtp,
              [chave]: chave === "port" ? Number(e.target.value) : e.target.value,
            })
          }
        />
      </label>
    );
  }

  return (
    <div>
      <div className="cabecalho-pagina">
        <div>
          <h1>Configurações</h1>
          <div className="subtitulo">Lembretes, email e categorias</div>
        </div>
      </div>

      {mensagem && (
        <div className="toast-ok">
          <CircleCheck size={16} /> {mensagem}
        </div>
      )}
      {erro && (
        <div className="aviso">
          <TriangleAlert size={16} /> {erro}
        </div>
      )}

      <div className="card" style={{ marginBottom: 14 }}>
        <h2>
          <Power size={16} color="var(--accent)" /> Inicialização
        </h2>
        <label className="caixa">
          <input type="checkbox" checked={autostart} onChange={alternarAutostart} />
          Abrir o Organiza junto com o sistema (em segundo plano, para os
          lembretes funcionarem sempre)
        </label>
        <label className="caixa">
          <input
            type="checkbox"
            checked={manterAcordado}
            disabled={alterandoEnergia}
            onChange={alternarManterAcordado}
          />
          Manter o Mac acordado para Telegram e lembretes enquanto o Organiza
          estiver aberto
        </label>
        <p style={{ color: "var(--text-soft)", margin: "8px 0 0" }}>
          Fechar a janela apenas esconde o app — os lembretes e o Telegram
          continuam ativos. Para encerrar de verdade, use Cmd+Q.
        </p>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <h2>
          <DatabaseBackup size={16} color="var(--accent)" /> Backup dos dados
        </h2>
        <p style={{ color: "var(--text-soft)", marginTop: 0 }}>
          O app guarda automaticamente uma cópia diária (os 10 backups mais
          recentes). Você também pode exportar uma cópia para onde quiser ou
          restaurar a partir de um arquivo <code>.db</code>.
        </p>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn-primario" onClick={fazerExportacao}>
            Exportar backup agora
          </button>
          <button className="btn-secundario" onClick={fazerRestauracao}>
            Restaurar de um arquivo…
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <h2>
          <Send size={16} color="var(--accent)" /> Telegram — adicionar contas
          por mensagem
        </h2>
        <p style={{ color: "var(--text-soft)", marginTop: 0 }}>
          1. No Telegram, fale com <strong>@BotFather</strong>, envie{" "}
          <code>/newbot</code> e siga as instruções. 2. Cole aqui o token
          gerado e salve. 3. Envie qualquer mensagem para o seu bot para
          parear. Depois é só mandar, por exemplo:{" "}
          <em>"conta de agua 12 dezembro 250 reais"</em>.
        </p>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="password"
            placeholder="Token do bot (ex: 123456789:ABC...)"
            value={tgToken}
            onChange={(e) => setTgToken(e.target.value)}
          />
          <button
            className="btn-primario"
            onClick={salvarTelegram}
            disabled={tgTestando}
            style={{ flexShrink: 0 }}
          >
            {tgTestando ? "Verificando…" : "Salvar e testar"}
          </button>
        </div>
        {tgChat && (
          <p style={{ marginBottom: 0 }}>
            <span className="badge paga">Pareado com o chat {tgChat}</span>{" "}
            <button className="link-acao" onClick={desparearTelegram}>
              Desparear
            </button>
          </p>
        )}
        {tgToken && !tgChat && (
          <p style={{ marginBottom: 0 }}>
            <span className="badge pendente">
              Aguardando primeira mensagem para parear
            </span>
          </p>
        )}
        {tgChat && (
          <label
            className="campo"
            style={{ marginTop: 12, maxWidth: 280 }}
          >
            Resumo diário no Telegram (deixe vazio para desativar)
            <input
              type="time"
              value={tgResumoHora}
              onChange={(e) => salvarResumoHora(e.target.value)}
            />
            <span style={{ fontWeight: 400, color: "var(--text-soft)", fontSize: 12 }}>
              Toda manhã o bot envia as contas que vencem no dia e as atrasadas.
            </span>
          </label>
        )}
        {tgToken && <StatusTelegram />}
      </div>

      <div className="grade-dashboard">
        <form className="card" onSubmit={salvarTudo}>
          <h2>
            <Mail size={16} color="var(--accent)" /> Email de lembrete (SMTP)
          </h2>
          <p style={{ color: "var(--text-soft)", marginTop: 0 }}>
            Para Gmail use <code>smtp.gmail.com</code>, porta 587 e uma{" "}
            <strong>senha de app</strong> (não a senha normal da conta).
          </p>
          <div className="form-grid">
            {campo("Servidor SMTP", "host", "text", "smtp.gmail.com")}
            {campo("Porta", "port", "number", "587")}
            {campo("Usuário", "user", "text", "voce@gmail.com")}
            {campo("Senha", "password", "password")}
            {campo("Remetente (de)", "from", "text", "voce@gmail.com")}
            {campo("Destinatário (para)", "to", "text", "voce@gmail.com")}
            <label className="campo">
              Avisar com quantos dias de antecedência?
              <input
                type="number"
                min={0}
                max={30}
                value={diasAviso}
                onChange={(e) => setDiasAviso(Number(e.target.value))}
              />
            </label>
          </div>
          <div className="acoes">
            <button
              type="button"
              className="btn-secundario"
              onClick={testarEmail}
              disabled={testando || !smtp.host || !smtp.to}
            >
              {testando ? "Enviando…" : "Enviar email de teste"}
            </button>
            <button type="submit" className="btn-primario">
              Salvar configurações
            </button>
          </div>
        </form>

        <div className="card">
          <h2>
            <Tags size={16} color="var(--accent)" /> Categorias
          </h2>
          <form onSubmit={adicionarCategoria} style={{ marginBottom: 14 }}>
            <div className="seletor-tipo" style={{ marginBottom: 10 }}>
              <button
                type="button"
                className={novoTipo === "despesa" ? "ativo despesa" : ""}
                onClick={() => setNovoTipo("despesa")}
              >
                Despesa
              </button>
              <button
                type="button"
                className={novoTipo === "receita" ? "ativo receita" : ""}
                onClick={() => setNovoTipo("receita")}
              >
                Receita
              </button>
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <input
                value={novaCategoria}
                onChange={(e) => setNovaCategoria(e.target.value)}
                placeholder="Nova categoria…"
              />
              <input
                type="color"
                value={novaCor}
                onChange={(e) => setNovaCor(e.target.value)}
                style={{ width: 48, padding: 4, height: 38, flexShrink: 0 }}
                title="Cor da categoria"
              />
              <button type="submit" className="btn-primario">
                Adicionar
              </button>
            </div>
            <div className="seletor-icones">
              {Object.keys(ICONES_CATEGORIA).map((slug) => (
                <button
                  type="button"
                  key={slug}
                  className={`opcao-icone ${novoIcone === slug ? "selecionado" : ""}`}
                  onClick={() => setNovoIcone(slug)}
                  title={slug}
                >
                  <IconeCategoria
                    nome={slug}
                    size={16}
                    cor={novoIcone === slug ? novaCor : "var(--text-soft)"}
                  />
                </button>
              ))}
            </div>
          </form>
          <p style={{ color: "var(--text-soft)", marginTop: 0 }}>
            Defina um orçamento mensal nas categorias de despesa para
            acompanhar o consumo no Dashboard (deixe vazio para não
            acompanhar).
          </p>
          {(["despesa", "receita"] as const).map((tipoGrupo) => (
            <div key={tipoGrupo}>
              <div className="titulo-grupo">
                {tipoGrupo === "despesa"
                  ? "Categorias de despesa"
                  : "Categorias de receita"}
              </div>
              <div className="lista-itens">
                {categorias
                  .filter((c) => c.tipo === tipoGrupo)
                  .map((c) => {
                    const editando = editandoCategoriaId === c.id;
                    return (
                      <div
                        className={`item-linha categoria-linha ${editando ? "editando" : ""}`}
                        key={c.id}
                      >
                        {editando ? (
                          <div className="categoria-editor">
                            <div className="categoria-editor-topo">
                              <div
                                className="icone-cat"
                                style={{ background: `${categoriaEditCor}22` }}
                              >
                                <IconeCategoria
                                  nome={categoriaEditIcone}
                                  cor={categoriaEditCor}
                                />
                              </div>
                              <input
                                value={categoriaEditNome}
                                onChange={(e) =>
                                  setCategoriaEditNome(e.target.value)
                                }
                                autoFocus
                              />
                              <input
                                type="color"
                                value={categoriaEditCor}
                                onChange={(e) =>
                                  setCategoriaEditCor(e.target.value)
                                }
                                title="Cor da categoria"
                              />
                            </div>
                            <div className="seletor-icones compacto">
                              {Object.keys(ICONES_CATEGORIA).map((slug) => (
                                <button
                                  type="button"
                                  key={slug}
                                  className={`opcao-icone ${categoriaEditIcone === slug ? "selecionado" : ""}`}
                                  onClick={() => setCategoriaEditIcone(slug)}
                                  title={slug}
                                >
                                  <IconeCategoria
                                    nome={slug}
                                    size={16}
                                    cor={
                                      categoriaEditIcone === slug
                                        ? categoriaEditCor
                                        : "var(--text-soft)"
                                    }
                                  />
                                </button>
                              ))}
                            </div>
                            <div className="categoria-editor-acoes">
                              <button
                                type="button"
                                className="btn-mini btn-secundario"
                                onClick={cancelarEdicaoCategoria}
                              >
                                <X size={13} /> Cancelar
                              </button>
                              <button
                                type="button"
                                className="btn-mini btn-primario"
                                onClick={() => salvarCategoria(c)}
                              >
                                <Check size={13} /> Salvar
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div
                              className="icone-cat"
                              style={{ background: `${c.cor}22` }}
                            >
                              <IconeCategoria nome={c.icone} cor={c.cor} />
                            </div>
                            <div className="info">
                              <div className="titulo">{c.nome}</div>
                            </div>
                            {c.tipo === "despesa" && (
                              <input
                                className="campo-orcamento"
                                placeholder="Orçamento"
                                inputMode="decimal"
                                value={orcamentos[c.id] ?? ""}
                                onChange={(e) =>
                                  setOrcamentos({
                                    ...orcamentos,
                                    [c.id]: e.target.value,
                                  })
                                }
                                onBlur={() => salvarOrcamento(c)}
                              />
                            )}
                            <button
                              type="button"
                              className="btn-mini btn-secundario"
                              onClick={() => iniciarEdicaoCategoria(c)}
                            >
                              <Pencil size={13} /> Editar
                            </button>
                            <button
                              type="button"
                              className="btn-mini btn-perigo"
                              onClick={() => removerCategoria(c)}
                            >
                              Excluir
                            </button>
                          </>
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
