import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  pathnameMock,
  authProviderMock,
  telemetryReporterMock,
  errorBoundaryMock,
  toasterMock,
  betaFeedbackMock,
} = vi.hoisted(() => ({
  pathnameMock: vi.fn(),
  authProviderMock: vi.fn(({ children }: { children: React.ReactNode }) => children),
  telemetryReporterMock: vi.fn(() => null),
  errorBoundaryMock: vi.fn(({ children }: { children: React.ReactNode }) => children),
  toasterMock: vi.fn(() => null),
  betaFeedbackMock: vi.fn(() => null),
}));

vi.mock("next/navigation", () => ({ usePathname: pathnameMock }));
vi.mock("@/components/providers/auth-provider", () => ({ AuthProvider: authProviderMock }));
vi.mock("@/components/providers/telemetry-reporter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/providers/telemetry-reporter")>()),
  TelemetryReporter: telemetryReporterMock,
}));
vi.mock("@/components/providers/error-boundary", () => ({ default: errorBoundaryMock }));
vi.mock("sonner", () => ({ Toaster: toasterMock }));
vi.mock("@/components/feedback/BetaFeedback", () => ({ BetaFeedback: betaFeedbackMock }));

import { RootProviders } from "@/components/providers/root-providers";
import { telemetryPageUrl } from "@/components/providers/telemetry-reporter";

describe("preference capability page provider isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(["/preferences", "/preferences/"])(
    "mounts no authenticated chrome or telemetry on %s",
    (pathname) => {
      pathnameMock.mockReturnValue(pathname);

      expect(
        renderToStaticMarkup(
          createElement(RootProviders, null, createElement("p", null, "Preference page"))
        )
      ).toContain("Preference page");
      expect(authProviderMock).not.toHaveBeenCalled();
      expect(telemetryReporterMock).not.toHaveBeenCalled();
      expect(errorBoundaryMock).not.toHaveBeenCalled();
      expect(toasterMock).not.toHaveBeenCalled();
      expect(betaFeedbackMock).not.toHaveBeenCalled();
    }
  );

  it("keeps the authenticated provider stack on dashboard routes", () => {
    pathnameMock.mockReturnValue("/dashboard/crm");

    renderToStaticMarkup(
      createElement(RootProviders, null, createElement("p", null, "Dashboard"))
    );

    expect(authProviderMock).toHaveBeenCalledOnce();
    expect(telemetryReporterMock).toHaveBeenCalledOnce();
    expect(errorBoundaryMock).toHaveBeenCalledOnce();
    expect(toasterMock).toHaveBeenCalledOnce();
    expect(betaFeedbackMock).toHaveBeenCalledOnce();
  });

  it("never includes URL query parameters or fragments in telemetry", () => {
    const location = new URL(
      "https://leadflow-review.web.app/preferences?unexpected=1#token=raw-capability"
    );

    expect(telemetryPageUrl(location)).toBe(
      "https://leadflow-review.web.app/preferences"
    );
  });
});
