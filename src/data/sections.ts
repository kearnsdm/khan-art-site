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
  /** If true, this item always renders at the bottom of the side nav. */
  pinBottom?: boolean;
}

export interface NavGroup {
  kind: "group";
  id: string;
  label: string;
  defaultOpen?: boolean;
  children: { id: SectionId; href: string; label: string }[];
  /** If true, this item always renders at the bottom of the side nav. */
  pinBottom?: boolean;
}

/**
 * Multiple links rendered on a single row, separated by pipe characters.
 * Used to keep paired items like About/Contact visually compact.
 */
export interface NavCombo {
  kind: "combo";
  id: string;
  links: { id: SectionId; href: string; label: string }[];
  pinBottom?: boolean;
}

export type NavItem = NavLink | NavGroup | NavCombo;

/**
 * Hardcoded nav items.
 *
 * The "Works" group (year-based) is rendered directly inside SideNav
 * with children driven by src/data/year-groups.json. Tag-based items
 * with `inNav: true` get injected after the Works group. About | Contact
 * pinned at the bottom.
 */
export const navItems: NavItem[] = [
  {
    kind: "combo",
    id: "about-contact",
    pinBottom: true,
    links: [
      // Both links go to the same combined page; the Contact link jumps
      // straight to the #contact section via the URL fragment.
      { id: "bio", href: "/about", label: "About" },
      { id: "contact", href: "/about#contact", label: "Contact" },
    ],
  },
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
