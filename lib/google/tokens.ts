/**
 * Make an authenticated request to Google API
 * Token should be passed from the client
 */
import type { Logger } from "@/lib/logging";

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
        const error = await response.json().catch(() => ({}));
        log?.warn("google.api.error", {
            endpoint,
            status: response.status,
            statusText: response.statusText,
        });
        throw new Error(
            error.error?.message || `Google API request failed: ${response.statusText}`
        );
    }

    log?.info("google.api.success", { endpoint, status: response.status });
    return response.json();
}
