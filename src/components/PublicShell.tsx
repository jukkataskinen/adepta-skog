import Link from "next/link";
import { Brand } from "@/components/Brand";

/**
 * Julkisten sivujen kehys (ohjeet ja tietosuoja): ylätunniste ja alatunniste,
 * jossa on linkki tietosuojaan. Sivuilla ei ole asiakastietoja.
 */
export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-cloud">
      <header className="border-b border-line bg-paper">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link href="/ohjeet" aria-label="Ohjeiden etusivu">
            <Brand size={24} />
          </Link>
          <nav className="flex items-center gap-5 text-sm font-semibold">
            <Link href="/ohjeet" className="text-ink/70 hover:text-ink">
              Toiminnot
            </Link>
            <Link href="/tyopoyta" className="rounded-lg bg-ink px-3 py-1.5 text-paper hover:bg-ink/85">
              Sovellukseen
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">{children}</main>
      <footer className="border-t border-line bg-paper">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-5 text-sm text-ink/60 sm:px-6">
          <span>Skog · Adepta Oy</span>
          <nav className="flex gap-5">
            <Link href="/ohjeet" className="hover:text-ink">
              Ohjeet
            </Link>
            <Link href="/tietosuoja" className="hover:text-ink">
              Tietosuoja
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
