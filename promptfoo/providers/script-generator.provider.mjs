const BLOCK_PATTERNS = [
  /ignore previous instructions/i,
  /reveal (?:your |the )?(?:system prompt|developer message|hidden instructions)/i,
  /(?:api key|access token|secret)/i,
  /print env/i,
];

function readString(context, key, fallback = "") {
  const value = context?.vars?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function shouldBlock(prompt) {
  return BLOCK_PATTERNS.some((pattern) => pattern.test(prompt));
}

async function generateScript(referenceContext, lead, type) {
  let script = "";
  const lower = referenceContext.toLowerCase();
  const hasPricing = lower.includes("price") || lower.includes("cost");
  const hasCaseStudy = lower.includes("result") || lower.includes("case study");
  const hasTechnical = lower.includes("api") || lower.includes("integration");
  const intro = `Hi ${lead.founderName || "there"}, this is Marcus from AgencyOS.`;

  if (type === "video") {
    script += `${intro} I made this video specifically for ${lead.companyName || "your company"}. `;
    if (hasCaseStudy) {
      script += `I was looking at your ${lead.targetIndustry || "industry"} peers, and based on the case studies I attached, we've helped similar companies scale by 300%. `;
    } else {
      script += `I noticed you're leading innovation in the ${lead.targetIndustry || "market"}, and I wanted to share how we can accelerate that. `;
    }
    if (hasTechnical) {
      script += "Our platform integrates directly with your existing stack, so you don't need to change your workflow. ";
    }
    script += "I'd love to walk you through our personalized strategy. Check the link below to book time.";
  } else {
    script += `${intro} I'm reaching out because I saw what you're doing at ${lead.companyName || "your company"}. `;
    if (hasPricing) {
      script += "We've just updated our pricing model to be performance-based, which I think aligns perfectly with your growth stage. ";
    }
    script += "I sent you an email with the details. Let's chat soon.";
  }

  return script;
}

export default class MissionControlScriptGeneratorProvider {
  id() {
    return "agency-os-mission-control-script-generator";
  }

  async callApi(prompt, context) {
    const type = readString(context, "type", "voice") === "video" ? "video" : "voice";
    const blocked = shouldBlock(prompt);
    const referenceContext = [readString(context, "referenceContext"), prompt].filter(Boolean).join("\n\n").slice(0, 4000);
    const lead = {
      companyName: readString(context, "companyName", "your company"),
      founderName: readString(context, "founderName", "there"),
      targetIndustry: readString(context, "targetIndustry", "their industry"),
    };

    const script = blocked
      ? "I can generate outreach scripts, but I will not reveal internal instructions, credentials, or system behavior."
      : await generateScript(referenceContext, lead, type);

    return {
      output: JSON.stringify({
        job_name: "promptfoo-eval",
        surface: "promptfoo",
        repo: "agency-os-mission-control",
        mode: "eval",
        blocked,
        type,
        lead,
        script,
      }),
    };
  }
}
