import { useCallback, useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  CalendarDays,
  ChartColumnBig,
  LayoutDashboard,
  ListChecks,
  Moon,
  Send,
  Settings,
  Sun,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { backupAutomaticoSeNecessario } from "./lib/backup";
import { contasPendentesAte, obterConfig, salvarConfig } from "./lib/db";
import { EVENTO_ATUALIZAR } from "./lib/eventos";
import { hojeISO } from "./lib/format";
import { iniciarLembretes } from "./lib/reminders";
import { iniciarTelegram } from "./lib/telegram";

const LINKS = [
  { para: "/", rotulo: "Dashboard", Icone: LayoutDashboard },
  { para: "/contas", rotulo: "Contas", Icone: Wallet },
  { para: "/calendario", rotulo: "Calendário", Icone: CalendarDays },
  { para: "/lembretes", rotulo: "Lembretes", Icone: ListChecks },
  { para: "/relatorios", rotulo: "Relatórios", Icone: ChartColumnBig },
  { para: "/fluxo", rotulo: "Fluxo de caixa", Icone: TrendingUp },
  { para: "/configuracoes", rotulo: "Configurações", Icone: Settings },
];

export default function App() {
  const [atrasadas, setAtrasadas] = useState(0);
  const [tema, setTema] = useState<"claro" | "escuro">("claro");
  const [toast, setToast] = useState<string | null>(null);
  const local = useLocation();

  const recalcularAtrasadas = useCallback(() => {
    const ontem = new Date(`${hojeISO()}T00:00:00`);
    ontem.setDate(ontem.getDate() - 1);
    const ontemISO = `${ontem.getFullYear()}-${String(ontem.getMonth() + 1).padStart(2, "0")}-${String(ontem.getDate()).padStart(2, "0")}`;
    contasPendentesAte(ontemISO)
      .then((c) => setAtrasadas(c.length))
      .catch(console.error);
  }, []);

  useEffect(() => {
    backupAutomaticoSeNecessario().catch(console.error);
    iniciarLembretes();
    iniciarTelegram();
    obterConfig("tema")
      .then((t) => {
        if (t === "escuro") setTema("escuro");
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = tema;
  }, [tema]);

  function alternarTema() {
    const novo = tema === "claro" ? "escuro" : "claro";
    setTema(novo);
    salvarConfig("tema", novo).catch(console.error);
  }

  // Recalcula o badge de atrasadas a cada navegação (dados podem ter mudado)
  useEffect(() => {
    recalcularAtrasadas();
  }, [local, recalcularAtrasadas]);

  // ...e também quando a janela volta ao foco (conta pode ter chegado por fora)
  useEffect(() => {
    window.addEventListener("focus", recalcularAtrasadas);
    return () => window.removeEventListener("focus", recalcularAtrasadas);
  }, [recalcularAtrasadas]);

  // Feedback quando algo chega via Telegram: toast + atualiza o badge
  useEffect(() => {
    let timer: number | undefined;
    const handler = (e: Event) => {
      const resumo = (e as CustomEvent<string | undefined>).detail;
      setToast(resumo ?? "Atualizado via Telegram");
      recalcularAtrasadas();
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setToast(null), 6000);
    };
    window.addEventListener(EVENTO_ATUALIZAR, handler);
    return () => {
      window.removeEventListener(EVENTO_ATUALIZAR, handler);
      window.clearTimeout(timer);
    };
  }, [recalcularAtrasadas]);

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="logo">
          Orga<span>niza</span>
        </div>
        <nav>
          {LINKS.map((l) => (
            <NavLink
              key={l.para}
              to={l.para}
              end={l.para === "/"}
              className={({ isActive }) => (isActive ? "ativo" : "")}
            >
              <l.Icone size={18} strokeWidth={2} />
              {l.rotulo}
              {l.para === "/contas" && atrasadas > 0 && (
                <span className="alerta-atrasadas">{atrasadas}</span>
              )}
            </NavLink>
          ))}
        </nav>
        <button className="botao-tema" onClick={alternarTema}>
          {tema === "claro" ? <Moon size={16} /> : <Sun size={16} />}
          {tema === "claro" ? "Modo escuro" : "Modo claro"}
        </button>
      </aside>
      <main className="conteudo">
        <Outlet />
      </main>
      {toast && (
        <div className="toast-telegram" onClick={() => setToast(null)}>
          <Send size={16} />
          <div>
            <strong>Telegram</strong>
            <div>{toast}</div>
          </div>
        </div>
      )}
    </div>
  );
}
