import {
  BookOpen,
  Box,
  Briefcase,
  ChartColumn,
  Cloud,
  Code,
  Cpu,
  Database,
  FlaskConical,
  Folder,
  Gamepad2,
  GitBranch,
  Globe,
  House,
  Image,
  Lightbulb,
  type LucideIcon,
  Music,
  Package,
  Palette,
  Rocket,
  Server,
  Smartphone,
  Terminal,
  Wrench,
} from "lucide-react";

export const DEFAULT_PROJECT_ICON = "folder";

export type ProjectIconOption = { name: string; Icon: LucideIcon };

/** Lista curada: o serviço só confere o formato do nome, não a existência do ícone. */
export const PROJECT_ICONS: readonly ProjectIconOption[] = [
  { name: "folder", Icon: Folder },
  { name: "code", Icon: Code },
  { name: "terminal", Icon: Terminal },
  { name: "globe", Icon: Globe },
  { name: "rocket", Icon: Rocket },
  { name: "book-open", Icon: BookOpen },
  { name: "box", Icon: Box },
  { name: "package", Icon: Package },
  { name: "database", Icon: Database },
  { name: "server", Icon: Server },
  { name: "cloud", Icon: Cloud },
  { name: "cpu", Icon: Cpu },
  { name: "git-branch", Icon: GitBranch },
  { name: "wrench", Icon: Wrench },
  { name: "flask-conical", Icon: FlaskConical },
  { name: "chart-column", Icon: ChartColumn },
  { name: "briefcase", Icon: Briefcase },
  { name: "house", Icon: House },
  { name: "lightbulb", Icon: Lightbulb },
  { name: "palette", Icon: Palette },
  { name: "image", Icon: Image },
  { name: "music", Icon: Music },
  { name: "gamepad-2", Icon: Gamepad2 },
  { name: "smartphone", Icon: Smartphone },
];

const ICONS_BY_NAME = new Map(PROJECT_ICONS.map((option) => [option.name, option.Icon]));

/** Devolve o componente pelo nome; nome desconhecido cai em `Folder`. */
export function getProjectIcon(name: string): LucideIcon {
  return ICONS_BY_NAME.get(name) ?? Folder;
}
