export type SectionId =
  | "paintings-2026"
  | "paintings-2025"
  | "paintings-2021-2024"
  | "paintings-before-2021"
  | "abstracts"
  | "portraits"
  | "commissions"
  | "bio"
  | "contact";

export interface NavLink {
  kind: "link";
  id: SectionId | "home";
  href: string;
  label: string;
}

export interface NavGroup {
  kind: "group";
  id: string;
  label: string;
  defaultOpen?: boolean;
  children: { id: SectionId; href: string; label: string }[];
}

export type NavItem = NavLink | NavGroup;

export const navItems: NavItem[] = [
  {
    kind: "group",
    id: "paintings",
    label: "Paintings",
    defaultOpen: false,
    children: [
      { id: "paintings-2026", href: "/paintings-2026", label: "2026" },
      { id: "paintings-2025", href: "/paintings-2025", label: "2025" },
      { id: "paintings-2021-2024", href: "/paintings-2021-2024", label: "2021–2024" },
      { id: "paintings-before-2021", href: "/paintings-before-2021", label: "2020 and earlier" },
    ],
  },
  { kind: "link", id: "abstracts", href: "/abstracts", label: "Abstracts" },
  { kind: "link", id: "portraits", href: "/portraits", label: "Portraits" },
  { kind: "link", id: "commissions", href: "/commissions", label: "Commissions" },
  { kind: "link", id: "bio", href: "/bio", label: "About" },
  { kind: "link", id: "contact", href: "/contact", label: "Contact" },
];

export const sectionTitles: Record<SectionId, string> = {
  "paintings-2026": "Paintings, 2026",
  "paintings-2025": "Paintings, 2025",
  "paintings-2021-2024": "Paintings, 2021–2024",
  "paintings-before-2021": "Paintings, 2020 and earlier",
  abstracts: "Abstracts",
  portraits: "Portraits",
  commissions: "Commissions",
  bio: "About",
  contact: "Contact",
};
