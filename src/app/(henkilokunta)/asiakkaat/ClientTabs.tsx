import { Tabs } from "@/components/ui";

export type ClientTab = "tiedot" | "kirjanpito" | "kirjanpito-maatalous" | "investoinnit" | "maatalous" | "alv" | "verosuunnitelma" | "raportti";

/**
 * Asiakkaan välilehdet. Vuosi kulkee välilehdeltä toiselle. Pelkän metsäasiakkaan
 * välilehdet ovat ennallaan. Kun asiakkaalla on metsä- ja maataloutta, kirjanpito
 * on kahtena välilehtenä (Metsätalouden ja Maatalouden kirjanpito), jotta
 * maatalouden kirjanpitoon pääsee suoraan. Pelkällä maatalousasiakkaalla
 * Kirjanpito on maatalouden kirjanpito. Lomakkeen 2 tiedot ovat välilehdellä
 * Lomake 2 (ennen Maatalous), jotta se ei sekoitu kirjanpitoon.
 */
export function ClientTabs({
  clientId,
  active,
  year,
  agriculture = false,
  forestry = true,
}: {
  clientId: string;
  active: ClientTab;
  year?: number | null;
  agriculture?: boolean;
  forestry?: boolean;
}) {
  const q = year ? `?vuosi=${year}` : "";
  const both = agriculture && forestry;
  return (
    <Tabs
      active={active}
      items={[
        { key: "tiedot", label: "Tiedot", href: `/asiakkaat/${clientId}` },
        ...(both
          ? [
              { key: "kirjanpito", label: "Metsätalouden kirjanpito", href: `/asiakkaat/${clientId}/kirjanpito${q}` },
              { key: "kirjanpito-maatalous", label: "Maatalouden kirjanpito", href: `/asiakkaat/${clientId}/kirjanpito${q ? `${q}&` : "?"}toiminta=maatalous` },
            ]
          : [{ key: "kirjanpito", label: "Kirjanpito", href: `/asiakkaat/${clientId}/kirjanpito${q}` }]),
        { key: "investoinnit", label: "Investoinnit", href: `/asiakkaat/${clientId}/investoinnit${q}` },
        ...(agriculture || active === "maatalous" ? [{ key: "maatalous", label: "Lomake 2", href: `/asiakkaat/${clientId}/maatalous${q}` }] : []),
        { key: "alv", label: "Arvonlisävero", href: `/asiakkaat/${clientId}/alv${q}` },
        { key: "verosuunnitelma", label: "Verosuunnitelma", href: `/asiakkaat/${clientId}/verosuunnitelma${q}` },
        { key: "raportti", label: "Veroraportti ja arkisto", href: `/asiakkaat/${clientId}/raportti${q}` },
      ]}
    />
  );
}
