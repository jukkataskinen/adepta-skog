import { PublicShell } from "@/components/PublicShell";

/**
 * Ohjeet ovat julkisia: etusivu esittelee toiminnot myös myyntitilanteessa
 * ilman kirjautumista. Sivuilla ei ole asiakastietoja.
 */
export default function HelpLayout({ children }: { children: React.ReactNode }) {
  return <PublicShell>{children}</PublicShell>;
}
