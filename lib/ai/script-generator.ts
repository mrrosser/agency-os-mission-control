export class ScriptGenerator {
    /**
     * Generates a context-aware script for outreach
     * @param context Content from Knowledge Base files
     * @param lead Lead information
     * @param type 'voice' or 'video'
     */
    static async generate(context: string, lead: any, type: 'voice' | 'video' = 'voice'): Promise<string> {
        // In a real production app, this would call OpenAI/Anthropic API
        // For this demo, we use a sophisticated template engine that simulates "AI" understanding

        let script = "";

        // Extract key themes from context (simulated RAG)
        const hasPricing = context.toLowerCase().includes("price") || context.toLowerCase().includes("cost");
        const hasCaseStudy = context.toLowerCase().includes("result") || context.toLowerCase().includes("case study");
        const hasTechnical = context.toLowerCase().includes("api") || context.toLowerCase().includes("integration");

        const intro = `Hi ${lead.founderName}, this is Marcus from AgencyOS.`;

        if (type === 'video') {
            script += `${intro} I made this video specifically for ${lead.companyName}. `;

            if (hasCaseStudy) {
                script += `I was looking at your ${lead.targetIndustry || 'industry'} peers, and based on the case studies I attached, we've helped similar companies scale by 300%. `;
            } else {
                script += `I noticed you're leading innovation in the ${lead.targetIndustry || 'market'}, and I wanted to share how we can accelerate that. `;
            }

            if (hasTechnical) {
                script += `Our platform integrates directly with your existing stack, so you don't need to change your workflow. `;
            }

            script += `I'd love to walk you through our personalized strategy. Check the link below to book time.`;

        } else {
            // Voice message (shorter, punchier)
            script += `${intro} I'm reaching out because I saw what you're doing at ${lead.companyName}. `;

            if (hasPricing) {
                script += `We've just updated our pricing model to be performance-based, which I think aligns perfectly with your growth stage. `;
            }

            script += `I sent you an email with the details. Let's chat soon.`;
        }

        return script;
    }
}
