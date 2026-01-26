export interface IntegrityResult {
    valid: boolean;
    error?: string;
}

/**
 * Validates lead data before persistence to prevent regression or bad data.
 */
export function validateLeadData(data: any): IntegrityResult {
    if (!data.email || !data.email.includes("@")) {
        return { valid: false, error: "Invalid Email Format: Leads must have a valid email." };
    }
    if (data.score !== undefined && (data.score < 0 || data.score > 100)) {
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
export function sanitizeLogPayload(payload: any) {
    const sensitiveKeys = ["api_key", "secret", "password", "token"];
    const sanitized = { ...payload };

    for (const key of Object.keys(sanitized)) {
        if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk))) {
            sanitized[key] = "[REDACTED]";
        }
    }
    return sanitized;
}
