import { Auth0Client } from "@auth0/nextjs-auth0/server";

/**
 * Auth0-asiakas. Asetukset ympäristömuuttujista: AUTH0_DOMAIN,
 * AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET, AUTH0_SECRET, APP_BASE_URL.
 * Vain kirjanpitotoimiston henkilökunta kirjautuu. Itserekisteröinti on
 * suljettu Auth0:ssa: käyttäjä lisätään Asetuksissa tai skriptillä.
 */
export const auth0 = new Auth0Client({
  authorizationParameters: { ui_locales: "fi" },
});
