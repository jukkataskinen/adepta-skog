import { createHash } from "node:crypto";

/**
 * Tuotujen rivien alkuperä. Tuodut rivit tunnistetaan sarakkeella legacy_id
 * (uuid), jotta uusintatuonti synkronoi eikä tuplaa (migraatio 0002).
 *
 * Vanhan Skog-kannan tunnisteet ovat satunnaisia (versio 4). Tilitukin riveille
 * muodostetaan pysyvä tunniste nimiavaruudesta (versio 5, RFC 4122): sama vienti
 * saa joka ajossa saman tunnisteen. Versionumero erottaa lähteet, joten
 * vanhan kannan synkronointi ei poista Tilitukista tuotuja rivejä eikä
 * päinvastoin, eikä migraatiota tarvita (DECISIONS 5.10.2026).
 */

/** Tilitukin nimiavaruus (satunnainen, kiinteä). */
const TILITUKI_NAMESPACE = "8d6f0c1e-4b7a-4f53-9a51-2f3c7d0b6e21";

function uuidV5(name: string, namespace: string): string {
  const ns = Buffer.from(namespace.replace(/-/g, ""), "hex");
  const hash = createHash("sha1").update(Buffer.concat([ns, Buffer.from(name, "utf8")])).digest();
  const b = hash.subarray(0, 16);
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Tilitukista tuodun rivin pysyvä tunniste, esim. tilitukiId("entry", "9", "0000000123-4"). */
export function tilitukiId(kind: "client" | "entry" | "asset" | "adjustment", ...parts: string[]): string {
  return uuidV5([kind, ...parts].join("/"), TILITUKI_NAMESPACE);
}

/** Onko tunniste Tilitukista (versio 5)? */
export function isTilitukiId(id: string | null | undefined): boolean {
  return !!id && id.length === 36 && id[14] === "5";
}

/** SQL-ehto: legacy_id on vanhasta Skog-kannasta eikä Tilitukista. */
export const LEGACY_SKOG_ID_SQL = "substr(legacy_id::text, 15, 1) <> '5'";
/** SQL-ehto: legacy_id on Tilitukista. */
export const TILITUKI_ID_SQL = "substr(legacy_id::text, 15, 1) = '5'";
