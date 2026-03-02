type ErrorWithCode = {
  code?: unknown;
  message?: unknown;
};

export type AuthErrorDetails = {
  message: string;
  code?: string;
  helpHref?: string;
  helpLabel?: string;
};

const DEFAULT_ERROR_MESSAGE = "Failed to sign in. Please try again.";
const DEFAULT_CANONICAL_LOGIN_URL = "https://leadflow-review.web.app/login";

function readErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const candidate = (error as ErrorWithCode).code;
  return typeof candidate === "string" ? candidate : undefined;
}

function readErrorMessage(error: unknown): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const candidate = (error as ErrorWithCode).message;
  return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined;
}

export function buildAuthErrorDetails(
  error: unknown,
  options?: { canonicalLoginUrl?: string }
): AuthErrorDetails {
  const canonicalLoginUrl = options?.canonicalLoginUrl ?? DEFAULT_CANONICAL_LOGIN_URL;
  const code = readErrorCode(error);
  const fallbackMessage = readErrorMessage(error) ?? DEFAULT_ERROR_MESSAGE;

  if (!code) {
    return {
      message: fallbackMessage,
    };
  }

  if (code === "auth/unauthorized-domain") {
    return {
      code,
      message:
        "Google sign-in is blocked on this domain. Use the official Mission Control login URL or add this host in Firebase Authentication authorized domains.",
      helpHref: canonicalLoginUrl,
      helpLabel: "Open official login",
    };
  }

  if (code === "auth/popup-blocked") {
    return {
      code,
      message: "Sign-in popup was blocked by your browser. Allow popups and try again.",
    };
  }

  if (code === "auth/popup-closed-by-user") {
    return {
      code,
      message: "Sign-in popup closed before completion. Please try again and keep the popup open.",
    };
  }

  if (code === "auth/cancelled-popup-request") {
    return {
      code,
      message: "A sign-in attempt is already in progress. Please wait a moment and try again.",
    };
  }

  return {
    code,
    message: fallbackMessage,
  };
}
