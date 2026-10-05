"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Activity } from "@/lib/tax/rules";
import type { EntrySuggestion } from "@/lib/ledger/posting-memory-load";

/** Viive kirjoittamisen jälkeen ennen hakua: nopea syöttö ei tee pyyntöä joka merkistä. */
export const POSTING_DEBOUNCE_MS = 350;

export interface PostingHint {
  /** Rivin avain (taulukko) tai lomakkeen tunniste. */
  key: string;
  items: EntrySuggestion[];
}

/**
 * Tiliöintiehdotukset selitteelle palvelimelta (/api/tiliointi/ehdotus,
 * DECISIONS 6.10.2026). Haku viiveellä, ja vanha pyyntö perutaan, kun selite
 * muuttuu. Hook ei koskaan muuta kenttiä: käyttäjä valitsee ehdotuksen erikseen.
 */
export function usePostingSuggestions(clientId: string, activity: Activity | null) {
  const [hint, setHint] = useState<PostingHint | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abort = useRef<AbortController | null>(null);

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    abort.current?.abort();
    abort.current = null;
    setHint(null);
  }, []);

  const request = useCallback(
    (key: string, description: string, date: string, amountGross: number | null) => {
      if (timer.current) clearTimeout(timer.current);
      abort.current?.abort();
      // Alle kolmen kirjaimen selite ei vielä erota mitään.
      if ((description.match(/\p{L}/gu) ?? []).length < 3) {
        setHint(null);
        return;
      }
      timer.current = setTimeout(async () => {
        const controller = new AbortController();
        abort.current = controller;
        try {
          const res = await fetch("/api/tiliointi/ehdotus", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ clientId, description, date, amountGross, activity }),
            signal: controller.signal,
          });
          if (!res.ok) return setHint(null);
          const data = (await res.json()) as { ok: boolean; suggestions?: EntrySuggestion[] };
          if (controller.signal.aborted) return;
          setHint(data.ok && data.suggestions?.length ? { key, items: data.suggestions } : null);
        } catch {
          // Peruttu tai verkkovirhe: ehdotus jää näyttämättä, syöttö jatkuu normaalisti.
        }
      }, POSTING_DEBOUNCE_MS);
    },
    [clientId, activity],
  );

  useEffect(() => clear, [clear]);
  return { hint, request, clear };
}
