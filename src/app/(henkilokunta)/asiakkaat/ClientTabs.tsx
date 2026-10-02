import { Tabs } from "@/components/ui";

export type ClientTab = "tiedot" | "kirjanpito" | "investoinnit" | "maatalous" | "alv" | "verosuunnitelma" | "raportti";

/**
 * Asiakkaan välilehdet. Vuosi kulkee välilehdeltä toiselle. Maatalous-välilehti
 * näkyy vain maatalousasiakkaalle, jotta pelkän metsäasiakkaan näkymä on ennallaan.
 */
export function ClientTabs({ clientId, active, year, agriculture = false }: { clientId: string; active: ClientTab; year?: number | null; agriculture?: boolean }) {
  const q = year ? `?vuosi=${year}` : "";
  return (
    <Tabs
      active={active}
      items={[
        { key: "tiedot", label: "Tiedot", href: `/asiakkaat/${clientId}` },
        { key: "kirjanpito", label: "Kirjanpito", href: `/asiakkaat/${clientId}/kirjanpito${q}` },
        { key: "investoinnit", label: "Investoinnit", href: `/asiakkaat/${clientId}/investoinnit${q}` },
        ...(agriculture || active === "maatalous" ? [{ key: "maatalous", label: "Maatalous", href: `/asiakkaat/${clientId}/maatalous${q}` }] : []),
        { key: "alv", label: "Arvonlisävero", href: `/asiakkaat/${clientId}/alv${q}` },
        { key: "verosuunnitelma", label: "Verosuunnitelma", href: `/asiakkaat/${clientId}/verosuunnitelma${q}` },
        { key: "raportti", label: "Veroraportti ja arkisto", href: `/asiakkaat/${clientId}/raportti${q}` },
      ]}
    />
  );
}
