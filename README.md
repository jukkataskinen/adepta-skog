# Skog

Metsätalouden kirjanpito- ja verosuunnitteluohjelma kirjanpitotoimistolle. Rakennusohje: [CLAUDE.md](CLAUDE.md), suunnitelma: [PLAN.md](PLAN.md).

```
npm install
cp .env.example .env.local
npm run db:seed:demo
npm run dev
```

Kehityksessä kanta on paikallinen PGlite (`.data/pglite`) ja kirjautuminen valitaan listasta (`AUTH_MODE=dev`).

Vanha sovellus on `legacy/`-kansiossa laskentasääntöjen lähteenä (DECISIONS 26.9.2026).
