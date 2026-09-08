export const CRM_WORKSPACES = ["people", "outreach", "share", "activity", "assistant"] as const;
export type CrmWorkspace = (typeof CRM_WORKSPACES)[number];
export type CrmBrandFilter = "all" | "rt_solutions" | "rosser_nft_gallery";

export function filterCrmPeople<T extends {
  companyName: string;
  founderName?: string;
  email?: string;
  phone?: string;
  businessUnit: string;
}>(people: T[], query: string, brand: CrmBrandFilter): T[] {
  const needle = query.trim().toLocaleLowerCase();
  return people.filter((person) => {
    if (brand !== "all" && person.businessUnit !== brand) return false;
    return !needle || [person.companyName, person.founderName, person.email, person.phone]
      .filter(Boolean).join(" ").toLocaleLowerCase().includes(needle);
  });
}

export function nextCrmWorkspace(current: CrmWorkspace, key: string): CrmWorkspace {
  if (key === "Home") return CRM_WORKSPACES[0];
  if (key === "End") return CRM_WORKSPACES[CRM_WORKSPACES.length - 1];
  const delta = key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : 0;
  return CRM_WORKSPACES[(CRM_WORKSPACES.indexOf(current) + delta + CRM_WORKSPACES.length) % CRM_WORKSPACES.length];
}
