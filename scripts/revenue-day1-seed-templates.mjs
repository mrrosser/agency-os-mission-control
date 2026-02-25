import { initializeApp, applicationDefault, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const projectId = String(process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "leadflow-review").trim();
const uid = String(
  process.env.REVENUE_AUTOMATION_UID ||
    process.env.REVENUE_DAY1_UID ||
    process.env.VOICE_ACTIONS_DEFAULT_UID ||
    process.env.SQUARE_WEBHOOK_DEFAULT_UID ||
    ""
).trim();

if (!uid) {
  console.error("Missing REVENUE_AUTOMATION_UID (or REVENUE_DAY1_UID/VOICE_ACTIONS_DEFAULT_UID/SQUARE_WEBHOOK_DEFAULT_UID)");
  process.exit(1);
}

if (getApps().length === 0) {
  initializeApp({
    credential: applicationDefault(),
    projectId,
  });
}

const db = getFirestore();

const templates = [
  {
    templateId: "rts-south-day1",
    name: "RT Solutions South SMB Web Modernization",
    clientName: "RT Solutions",
    params: {
      query:
        "small businesses without a modern website or with outdated website experiences",
      industry: "small business services",
      location: "New Orleans, Louisiana",
      limit: 25,
      minScore: 45,
      sources: ["googlePlaces", "firestore"],
      includeEnrichment: true,
      businessUnit: "rt_solutions",
      offerCode: "RTS-QUICK-WEBSITE-SPRINT",
      budget: {
        maxCostUsd: 4,
        maxPages: 8,
        maxRuntimeSec: 90,
      },
    },
    outreach: {
      businessKey: "rts",
      useSMS: false,
      useAvatar: true,
      useOutboundCall: false,
      draftFirst: true,
    },
  },
  {
    templateId: "rng-south-day1",
    name: "Rosser Gallery South Events + Commission Pipeline",
    clientName: "Rosser NFT Gallery",
    params: {
      query:
        "event venues, cultural institutions, hospitality groups, and private hosts interested in custom sculpture, preservation, or art event experiences",
      industry: "events and cultural organizations",
      location: "New Orleans, Louisiana",
      limit: 20,
      minScore: 40,
      sources: ["googlePlaces", "firestore"],
      includeEnrichment: true,
      businessUnit: "rosser_nft_gallery",
      offerCode: "RNG-COMMISSION-SCULPTURE",
      budget: {
        maxCostUsd: 3,
        maxPages: 6,
        maxRuntimeSec: 75,
      },
    },
    outreach: {
      businessKey: "rng",
      useSMS: false,
      useAvatar: true,
      useOutboundCall: false,
      draftFirst: true,
    },
  },
  {
    templateId: "aicf-south-day1",
    name: "AI CoFoundry South Automation Discovery",
    clientName: "AI CoFoundry",
    params: {
      query:
        "small and midsize teams seeking AI workflow automation, training, and implementation support",
      industry: "professional services and operations teams",
      location: "New Orleans, Louisiana",
      limit: 20,
      minScore: 45,
      sources: ["googlePlaces", "firestore"],
      includeEnrichment: true,
      businessUnit: "ai_cofoundry",
      offerCode: "AICF-DISCOVERY",
      budget: {
        maxCostUsd: 3,
        maxPages: 6,
        maxRuntimeSec: 75,
      },
    },
    outreach: {
      businessKey: "aicf",
      useSMS: false,
      useAvatar: false,
      useOutboundCall: false,
      draftFirst: true,
    },
  },
];

for (const template of templates) {
  const ref = db
    .collection("identities")
    .doc(uid)
    .collection("lead_run_templates")
    .doc(template.templateId);
  await ref.set(
    {
      ...template,
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

console.log("Day1 templates upserted", {
  projectId,
  uid,
  count: templates.length,
  templateIds: templates.map((item) => item.templateId),
});
