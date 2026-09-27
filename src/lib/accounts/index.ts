/**
 * Kirjautumistunnukset Auth0:ssa. Itserekisteröinti on suljettu, joten
 * kutsutulle käyttäjälle luodaan tunnus tässä ja hän saa linkin, jolla hän
 * asettaa salasanan. Tilat (AUTH0_ADMIN_MODE):
 *   mock    oletus: Auth0:aan ei kutsuta; käyttäjä kirjautuu tunnuksella,
 *           joka on luotu muuta kautta (esim. Auth0:n hallinnasta)
 *   auth0   Auth0 Management API. Oma kone-kone-sovellus, jolla on oikeudet
 *           read:users, create:users ja create:user_tickets (AUTH0_MGMT_CLIENT_ID,
 *           AUTH0_MGMT_CLIENT_SECRET). Tietokantayhteys AUTH0_DB_CONNECTION.
 * Sähköpostiosoitetta ei kirjoiteta lokiin eikä virheviestiin.
 */

export interface AccountResult {
  /** Tunnus luotiin nyt. Jos tunnus oli jo, käyttäjä kirjautuu vanhalla salasanallaan. */
  created: boolean;
  /** Linkki salasanan asettamiseen, jos tunnus luotiin. */
  setPasswordUrl: string | null;
}

export interface AccountProvisioner {
  mode: "mock" | "auth0";
  ensureAccount(input: { email: string; fullName: string | null; returnUrl: string }): Promise<AccountResult>;
}

export class AccountError extends Error {}

export function mockAccounts(): AccountProvisioner & { calls: number } {
  const state = {
    mode: "mock" as const,
    calls: 0,
    async ensureAccount() {
      state.calls++;
      return { created: false, setPasswordUrl: null };
    },
  };
  return state;
}

function auth0Accounts(domain: string, clientId: string, clientSecret: string, connection: string): AccountProvisioner {
  const base = `https://${domain}`;
  async function call<T>(path: string, init: RequestInit & { token?: string }): Promise<T> {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}) },
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => null)) as (T & { message?: string }) | null;
    // Auth0:n virheviesti voi sisältää osoitteen, joten siitä näytetään vain tila.
    if (!res.ok || !body) throw new AccountError(`Auth0 hylkäsi pyynnön (${res.status}).`);
    return body;
  }

  return {
    mode: "auth0",
    async ensureAccount({ email, fullName, returnUrl }) {
      const { access_token: token } = await call<{ access_token: string }>("/oauth/token", {
        method: "POST",
        body: JSON.stringify({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret, audience: `${base}/api/v2/` }),
      });
      const existing = await call<{ user_id: string }[]>(`/api/v2/users-by-email?email=${encodeURIComponent(email)}`, { method: "GET", token });
      if (existing.length > 0) return { created: false, setPasswordUrl: null };

      // Satunnainen salasana, jota kukaan ei tiedä: käyttäjä asettaa oman linkistä.
      const password = `${crypto.randomUUID()}Aa1!${crypto.randomUUID()}`;
      const user = await call<{ user_id: string }>("/api/v2/users", {
        method: "POST",
        token,
        body: JSON.stringify({ connection, email, password, email_verified: false, verify_email: false, ...(fullName ? { name: fullName } : {}) }),
      });
      // Linkki tulee kutsutun omaan sähköpostiin, joten sen käyttö varmentaa osoitteen.
      // Varmennettu osoite tarvitaan, jotta kirjautuminen yhdistyy kutsuun (resolve-user.ts).
      const ticket = await call<{ ticket: string }>("/api/v2/tickets/password-change", {
        method: "POST",
        token,
        body: JSON.stringify({ user_id: user.user_id, result_url: returnUrl, ttl_sec: 7 * 24 * 3600, mark_email_as_verified: true }),
      });
      return { created: true, setPasswordUrl: ticket.ticket };
    },
  };
}

export function accountProvisioner(): AccountProvisioner {
  const mode = process.env.AUTH0_ADMIN_MODE ?? "mock";
  if (mode === "mock") return mockAccounts();
  if (mode === "auth0") {
    const domain = process.env.AUTH0_DOMAIN;
    const id = process.env.AUTH0_MGMT_CLIENT_ID;
    const secret = process.env.AUTH0_MGMT_CLIENT_SECRET;
    if (!domain || !id || !secret) throw new AccountError("Auth0-hallinnan avaimet puuttuvat (AUTH0_DOMAIN, AUTH0_MGMT_CLIENT_ID, AUTH0_MGMT_CLIENT_SECRET).");
    return auth0Accounts(domain.replace(/^https?:\/\//, "").replace(/\/$/, ""), id, secret, process.env.AUTH0_DB_CONNECTION ?? "Username-Password-Authentication");
  }
  throw new AccountError(`Tunnustilaa "${mode}" ei ole toteutettu.`);
}
