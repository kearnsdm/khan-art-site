import worksData from "./works.json";
import type { SectionId } from "./sections";

export interface Work {
  slug: string;
  title: string;
  year: number;
  section: SectionId;
  featured: boolean;
  sourceFolder: string;
  primaryImage: string;
  primaryImageAlt: string;
  additionalImages: string[];
}

export const works: Work[] = worksData.works as Work[];

export function worksBySection(section: SectionId): Work[] {
  return works.filter((w) => w.section === section);
}

export function featuredWorks(): Work[] {
  return works.filter((w) => w.featured);
}

export function workBySlug(slug: string): Work | undefined {
  return works.find((w) => w.slug === slug);
}
