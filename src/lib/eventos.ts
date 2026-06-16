import { useEffect, useRef } from "react";

/**
 * Barramento simples de atualização: quando dados mudam por fora da página
 * atual (ex: uma conta chega via Telegram), emitimos este evento para que a
 * tela visível se recarregue e o app mostre um aviso.
 */
export const EVENTO_ATUALIZAR = "organiza:atualizar";

export function emitirAtualizacao(resumo?: string) {
  window.dispatchEvent(new CustomEvent(EVENTO_ATUALIZAR, { detail: resumo }));
}

/**
 * Re-executa `cb` quando algo muda por fora da tela:
 * - evento interno (conta chegou via Telegram);
 * - a janela do app volta ao foco ou fica visível novamente.
 *
 * O foco/visibilidade é a rede de segurança principal: o fluxo típico é
 * adicionar a conta pelo celular e depois trazer o app para frente — nesse
 * momento recarregamos, mesmo que o evento interno tenha se perdido.
 */
export function useAtualizacaoExterna(cb: () => void) {
  const cbRef = useRef(cb);
  cbRef.current = cb;

  useEffect(() => {
    const recarregar = () => cbRef.current();
    const aoVisivel = () => {
      if (document.visibilityState === "visible") cbRef.current();
    };
    window.addEventListener(EVENTO_ATUALIZAR, recarregar);
    window.addEventListener("focus", recarregar);
    document.addEventListener("visibilitychange", aoVisivel);
    return () => {
      window.removeEventListener(EVENTO_ATUALIZAR, recarregar);
      window.removeEventListener("focus", recarregar);
      document.removeEventListener("visibilitychange", aoVisivel);
    };
  }, []);
}
