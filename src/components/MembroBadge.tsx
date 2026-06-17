import type { Membro } from "../lib/types";

interface Props {
  membro: Membro | null | undefined;
  mostrarFamilia?: boolean;
}

export function MembroBadge({ membro, mostrarFamilia = false }: Props) {
  if (!membro && !mostrarFamilia) return null;

  return (
    <span
      className="badge-membro"
      style={
        membro
          ? {
              borderColor: `${membro.cor}55`,
              background: `${membro.cor}18`,
              color: membro.cor,
            }
          : undefined
      }
    >
      {membro?.nome ?? "Família"}
    </span>
  );
}
