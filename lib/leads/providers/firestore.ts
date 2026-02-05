import "server-only";

import type { Logger } from "@/lib/logging";
import type { LeadCandidate } from "@/lib/leads/types";
import { getAdminDb } from "@/lib/firebase-admin";

interface FirestoreLeadParams {
    uid: string;
    limit: number;
    log?: Logger;
}

export async function fetchFirestoreLeads(params: FirestoreLeadParams): Promise<LeadCandidate[]> {
    const { uid, limit, log } = params;
    const snapshot = await getAdminDb()
        .collection("leads")
        .where("userId", "==", uid)
        .orderBy("createdAt", "desc")
        .limit(limit)
        .get();

    log?.info("lead.source.firestore.fetched", { count: snapshot.size });

    return snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
            id: doc.id,
            companyName: data.company || data.companyName || "Unknown",
            founderName: data.name || data.founderName,
            email: data.email,
            phone: data.phone,
            website: data.website,
            location: data.location,
            industry: data.industry,
            source: "firestore" as const,
            enriched: Boolean(data.website || data.phone),
        };
    });
}
