import { Tabs } from "@/components/ui";

/** Asiakkaan välilehdet. Arvonlisävero, verosuunnitelma, veroraportti ja arkisto lisätään vaiheissa 5–6. */
export function ClientTabs({ clientId, active }: { clientId: string; active: "tiedot" | "kirjanpito" }) {
  return (
    <Tabs
      active={active}
      items={[
        { key: "tiedot", label: "Tiedot", href: `/asiakkaat/${clientId}` },
        { key: "kirjanpito", label: "Kirjanpito", href: `/asiakkaat/${clientId}/kirjanpito` },
      ]}
    />
  );
}
