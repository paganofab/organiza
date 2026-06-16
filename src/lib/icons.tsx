import {
  Banknote,
  BookOpen,
  Briefcase,
  Bus,
  Car,
  Coffee,
  CreditCard,
  Droplets,
  Dumbbell,
  Fuel,
  Gamepad2,
  Gift,
  GraduationCap,
  HeartPulse,
  Home,
  Music,
  PartyPopper,
  PawPrint,
  PiggyBank,
  Pill,
  Plane,
  Receipt,
  Shirt,
  ShoppingCart,
  Smartphone,
  Tag,
  Tv,
  Utensils,
  Wifi,
  Zap,
  type LucideIcon,
} from "lucide-react";

/** Ícones disponíveis para categorias. O nome (slug) é o que vai pro banco. */
export const ICONES_CATEGORIA: Record<string, LucideIcon> = {
  home: Home,
  zap: Zap,
  droplets: Droplets,
  wifi: Wifi,
  "credit-card": CreditCard,
  car: Car,
  "heart-pulse": HeartPulse,
  "graduation-cap": GraduationCap,
  "party-popper": PartyPopper,
  tv: Tv,
  receipt: Receipt,
  tag: Tag,
  "shopping-cart": ShoppingCart,
  utensils: Utensils,
  coffee: Coffee,
  gift: Gift,
  plane: Plane,
  bus: Bus,
  fuel: Fuel,
  "paw-print": PawPrint,
  dumbbell: Dumbbell,
  shirt: Shirt,
  briefcase: Briefcase,
  "piggy-bank": PiggyBank,
  banknote: Banknote,
  pill: Pill,
  music: Music,
  "gamepad-2": Gamepad2,
  "book-open": BookOpen,
  smartphone: Smartphone,
};

interface Props {
  nome: string | null | undefined;
  size?: number;
  cor?: string;
}

/** Renderiza o ícone de uma categoria pelo slug salvo no banco (fallback: Tag). */
export function IconeCategoria({ nome, size = 17, cor }: Props) {
  const Icone = (nome && ICONES_CATEGORIA[nome]) || Tag;
  return <Icone size={size} color={cor} strokeWidth={2} />;
}
