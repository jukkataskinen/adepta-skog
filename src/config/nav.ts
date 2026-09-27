import type { IconName } from "@/components/NavIcon";
import type { OrgRole } from "@/lib/auth/current-user";

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  roles?: OrgRole[];
}

/** Päivittäinen työ. Kirjanpito ja raportit lisätään vaiheissa 4–6 (PLAN.md). */
export const STAFF_NAV: NavItem[] = [
  { href: "/tyopoyta", label: "Työpöytä", icon: "home" },
  { href: "/asiakkaat", label: "Asiakkaat", icon: "users" },
];

/** Toimiston asetukset ja ohjeet. */
export const STAFF_NAV_ORG: NavItem[] = [
  { href: "/asetukset", label: "Asetukset", icon: "gear", roles: ["owner"] },
  { href: "/kehitystoiveet", label: "Kehitystoiveet", icon: "bolt" },
  { href: "/ohjeet", label: "Ohjeet", icon: "info" },
];
