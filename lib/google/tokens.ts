/**
 * Make an authenticated request to Google API
 * Token should be passed from the client
 */
import type { Logger } from "@/lib/logging";
import { ApiError } from "@/lib/api/handler";

function oneLineSnippet(text: string, maxChars: number): string {
    const normalized = (text || "").replace(/\\s+/g, " ").trim();
    return normalized.length > maxChars ? `${normalized.slice(0, maxChars)}...` : normalized;
}

function tryParseJson(text: string): unknown | null {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

export async function callGoogleAPI<T>(
    endpoint: string,
    accessToken: string,
    options: RequestInit = {},
    log?: Logger
): Promise<T> {
    log?.info("google.api.request", { endpoint, method: options.method || "GET" });

    const response = await fetch(endpoint, {
        ...options,
        headers: {
            ...options.headers,
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
        },
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        const parsed = errorText ? tryParseJson(errorText) : null;
        const errorObj = parsed && typeof parsed === "object" ? (parsed as any) : null;
        const upstreamMessage =
            errorObj?.error?.message ||
            (errorText ? oneLineSnippet(errorText, 220) : "") ||
            response.statusText ||
            "Google API request failed";

        log?.warn("google.api.error", {
            endpoint,
            status: response.status,
            statusText: response.statusText,
        });

        // Map upstream errors to something actionable in the UI.
        // These are user-specific OAuth failures, not server faults.
        if (response.status === 401 || response.status === 403) {
            throw new ApiError(403, upstreamMessage);
        }

        if (response.status === 429) {
            throw new ApiError(429, upstreamMessage);
        }

        // Everything else: treat as upstream dependency error.
        throw new ApiError(502, upstreamMessage);
    }

    log?.info("google.api.success", { endpoint, status: response.status });
    return response.json();
}
