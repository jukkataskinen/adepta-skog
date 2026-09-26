import type { IconName } from "@/components/NavIcon";
import type { OrgRole } from "@/lib/auth/current-user";

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  roles?: OrgRole[];
}

/** Päivittäinen työ. Asiakkaat, kirjanpito ja raportit lisätään vaiheissa 3–6 (PLAN.md). */
export const STAFF_NAV: NavItem[] = [{ href: "/tyopoyta", label: "Työpöytä", icon: "home" }];

/** Toimiston asetukset ja ohjeet. */
export const STAFF_NAV_ORG: NavItem[] = [
  { href: "/asetukset", label: "Asetukset", icon: "gear", roles: ["owner"] },
  { href: "/ohjeet", label: "Ohjeet", icon: "info" },
];
