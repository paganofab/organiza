import { ReactNode } from "react";

interface Props {
  titulo: string;
  aberto: boolean;
  aoFechar: () => void;
  children: ReactNode;
}

export default function Modal({ titulo, aberto, aoFechar, children }: Props) {
  if (!aberto) return null;
  return (
    <div
      className="modal-fundo"
      onClick={(e) => {
        if (e.target === e.currentTarget) aoFechar();
      }}
    >
      <div className="modal">
        <h2>{titulo}</h2>
        {children}
      </div>
    </div>
  );
}
