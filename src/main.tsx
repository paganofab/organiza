import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter, Route, Routes } from "react-router-dom";
import App from "./App";
import Dashboard from "./pages/Dashboard";
import Contas from "./pages/Contas";
import Calendario from "./pages/Calendario";
import Relatorios from "./pages/Relatorios";
import FluxoCaixa from "./pages/FluxoCaixa";
import Lembretes from "./pages/Lembretes";
import Configuracoes from "./pages/Configuracoes";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <HashRouter>
      <Routes>
        <Route element={<App />}>
          <Route index element={<Dashboard />} />
          <Route path="contas" element={<Contas />} />
          <Route path="calendario" element={<Calendario />} />
          <Route path="lembretes" element={<Lembretes />} />
          <Route path="relatorios" element={<Relatorios />} />
          <Route path="fluxo" element={<FluxoCaixa />} />
          <Route path="configuracoes" element={<Configuracoes />} />
        </Route>
      </Routes>
    </HashRouter>
  </React.StrictMode>,
);
