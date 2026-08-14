import { GOOGLE_BUSINESS_PROFILES } from "@/lib/google/business-profiles";

export type GoogleOAuthCallbackFeedback = {
  kind: "success" | "error";
  title: string;
  description: string;
  showHelpLink: boolean;
  supportId?: string;
};

type SearchParamsReader = Pick<URLSearchParams, "get">;

const ERROR_COPY: Readonly<
  Record<string, Pick<GoogleOAuthCallbackFeedback, "description" | "showHelpLink">>
> = {
  access_denied: {
    description:
      "The connection was canceled. Try again and choose the Google account intended for this organization.",
    showHelpLink: false,
  },
  temporarily_unavailable: {
    description:
      "Google is temporarily unavailable. Wait a moment, then start a fresh connection.",
    showHelpLink: false,
  },
  provider_error: {
    description:
      "Google could not complete the request. Wait a moment, then start a fresh connection.",
    showHelpLink: false,
  },
  connection_session_invalid: {
    description:
      "This browser could not verify the connection session, or the session expired. Start again in the same browser from the intended organization profile.",
    showHelpLink: false,
  },
  connection_superseded: {
    description:
      "A newer connection attempt replaced this one. Continue with the newest attempt or start again from the intended organization profile.",
    showHelpLink: false,
  },
  token_exchange_failed: {
    description:
      "Google authorization could not be confirmed. Start a fresh connection from the intended organization profile.",
    showHelpLink: false,
  },
  scope_not_allowed: {
    description:
      "Google returned permissions outside this profile's approved connection. Try again and review the consent screen before continuing.",
    showHelpLink: true,
  },
  account_identity_failed: {
    description:
      "The Google account identity could not be verified for this profile. Start again and choose the intended account.",
    showHelpLink: false,
  },
  account_already_connected: {
    description:
      "That Google account is already assigned to the other organization profile. Choose a different Google account so RT.Solutions and Rosser Gallery remain isolated.",
    showHelpLink: false,
  },
  profile_replacement_requires_disconnect: {
    description:
      "This organization profile is connected to a different Google account. Disconnect that profile first, then start a fresh connection with the intended account.",
    showHelpLink: false,
  },
  credential_storage_failed: {
    description:
      "Authorization finished, but the secure connection could not be saved. Try once more; contact support if it continues.",
    showHelpLink: false,
  },
  configuration_error: {
    description:
      "Google connection setup is temporarily unavailable because the service configuration is incomplete. Contact support before retrying.",
    showHelpLink: true,
  },
};

export const GOOGLE_OAUTH_CALLBACK_PARAMS = [
  "google",
  "googleError",
  "googleErrorDescription",
  "googleBusiness",
  "googleProfile",
  "googleCorrelation",
  "correlationId",
] as const;

function resolveCallbackProfile(searchParams: SearchParamsReader) {
  const businessId = searchParams.get("googleBusiness");
  const profileId = searchParams.get("googleProfile");

  return GOOGLE_BUSINESS_PROFILES.find(
    (profile) =>
      profile.businessId === businessId && profile.profileId === profileId
  );
}

function resolveSupportId(searchParams: SearchParamsReader): string | undefined {
  const value = searchParams.get("googleCorrelation") || "";
  return /^[A-Za-z0-9_-]{8,128}$/.test(value) ? value : undefined;
}

export function getGoogleOAuthCallbackFeedback(
  searchParams: SearchParamsReader
): GoogleOAuthCallbackFeedback | null {
  const result = searchParams.get("google");
  if (result !== "connected" && result !== "error") return null;

  const profile = resolveCallbackProfile(searchParams);
  const subject = profile ? `${profile.label} Google connection` : "Google connection";

  if (result === "connected") {
    return {
      kind: "success",
      title: `${subject} completed`,
      description: profile
        ? `${profile.label} is connected only to its ${profile.profileId} workspace profile.`
        : "The account is connected. Review each organization profile below before using Google tools.",
      showHelpLink: false,
    };
  }

  const code = searchParams.get("googleError") || "";
  const trustedCopy = Object.prototype.hasOwnProperty.call(ERROR_COPY, code)
    ? ERROR_COPY[code]
    : undefined;
  const copy = trustedCopy || {
    description:
      "The connection could not be completed. Start a fresh connection from the intended organization profile.",
    showHelpLink: true,
  };
  const feedback: GoogleOAuthCallbackFeedback = {
    kind: "error",
    title: `${subject} was not completed`,
    description: copy.description,
    showHelpLink: copy.showHelpLink,
  };
  const supportId = resolveSupportId(searchParams);
  return supportId ? { ...feedback, supportId } : feedback;
}

export function hasGoogleOAuthCallbackParams(searchParams: SearchParamsReader): boolean {
  return GOOGLE_OAUTH_CALLBACK_PARAMS.some((key) => searchParams.get(key) !== null);
}

export function buildGoogleOAuthCleanUrl(currentUrl: URL): string {
  const cleanUrl = new URL(currentUrl.toString());
  for (const key of GOOGLE_OAUTH_CALLBACK_PARAMS) {
    cleanUrl.searchParams.delete(key);
  }
  return `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`;
}
