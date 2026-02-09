export interface IntegrityResult {
    valid: boolean;
    error?: string;
}

/**
 * Validates lead data before persistence to prevent regression or bad data.
 */
export function validateLeadData(data: unknown): IntegrityResult {
    const obj = (data && typeof data === "object" ? (data as Record<string, unknown>) : {}) as Record<
        string,
        unknown
    >;
    const email = obj.email;

    if (typeof email !== "string" || !email.includes("@")) {
        return { valid: false, error: "Invalid Email Format: Leads must have a valid email." };
    }

    const score = obj.score;
    if (typeof score === "number" && (score < 0 || score > 100)) {
        return { valid: false, error: "Range Violation: Lead score must be between 0 and 100." };
    }
    return { valid: true };
}

/**
 * Ensures a user has permission to modify a specific resource (Enterprise check).
 */
export function verifyOwnership(resourceId: string, userUid: string, ownerUid: string): IntegrityResult {
    if (userUid !== ownerUid) {
        return { valid: false, error: "Permission Denied: Unauthorized attempt to modify resource " + resourceId };
    }
    return { valid: true };
}

/**
 * Prevents sensitive API keys from being logged (Sanitization).
 */
export function sanitizeLogPayload(payload: Record<string, unknown>): Record<string, unknown> {
    const sensitiveKeys = ["api_key", "secret", "password", "token"];
    const sanitized = { ...payload };

    for (const key of Object.keys(sanitized)) {
        if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk))) {
            sanitized[key] = "[REDACTED]";
        }
    }
    return sanitized;
}
