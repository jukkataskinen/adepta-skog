import { PublicShell } from "@/components/PublicShell";

/** Tietosuojasivu on julkinen, jotta sen voi lukea ennen kirjautumista. */
export default function PrivacyLayout({ children }: { children: React.ReactNode }) {
  return <PublicShell>{children}</PublicShell>;
}
