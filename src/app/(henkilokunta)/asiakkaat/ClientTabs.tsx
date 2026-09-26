import { Tabs } from "@/components/ui";

export type ClientTab = "tiedot" | "kirjanpito" | "alv" | "verosuunnitelma" | "raportti";

/** Asiakkaan välilehdet. Vuosi kulkee välilehdeltä toiselle. */
export function ClientTabs({ clientId, active, year }: { clientId: string; active: ClientTab; year?: number | null }) {
  const q = year ? `?vuosi=${year}` : "";
  return (
    <Tabs
      active={active}
      items={[
        { key: "tiedot", label: "Tiedot", href: `/asiakkaat/${clientId}` },
        { key: "kirjanpito", label: "Kirjanpito", href: `/asiakkaat/${clientId}/kirjanpito${q}` },
        { key: "alv", label: "Arvonlisävero", href: `/asiakkaat/${clientId}/alv${q}` },
        { key: "verosuunnitelma", label: "Verosuunnitelma", href: `/asiakkaat/${clientId}/verosuunnitelma${q}` },
        { key: "raportti", label: "Veroraportti ja arkisto", href: `/asiakkaat/${clientId}/raportti${q}` },
      ]}
    />
  );
}
