import * as React from "react";
import { cn } from "@/lib/utils";

export type AfroGlyphVariant =
  | "mission"
  | "overview"
  | "identity"
  | "operations"
  | "inbox"
  | "calendar"
  | "integrations"
  | "vault"
  | "drive"
  | "chat"
  | "voice"
  | "video"
  | "source"
  | "score"
  | "enrich"
  | "script"
  | "outreach"
  | "followup"
  | "booking"
  | "receipt"
  | "activity"
  | "people"
  | "trend"
  | "network";

type AfroGlyphProps = React.SVGProps<SVGSVGElement> & {
  variant?: AfroGlyphVariant;
};

function GlyphPath({ variant }: { variant: AfroGlyphVariant }) {
  switch (variant) {
    case "chat":
      return (
        <>
          <path d="M6 6.2h12a2.8 2.8 0 0 1 2.8 2.8v4.8A2.8 2.8 0 0 1 18 16.6H10l-3.8 3v-3H6A2.8 2.8 0 0 1 3.2 13.8V9A2.8 2.8 0 0 1 6 6.2Z" />
          <path d="M7.6 10.2h8.8M7.6 12.6h6" />
        </>
      );
    case "voice":
      return (
        <>
          <rect x="9" y="4.4" width="6" height="9.6" rx="3" />
          <path d="M6.6 11.2v.8a5.4 5.4 0 0 0 10.8 0v-.8" />
          <path d="M12 17.4v2.8" />
          <path d="M9.2 20.2h5.6" />
        </>
      );
    case "video":
      return (
        <>
          <rect x="4.2" y="7.2" width="12.2" height="9.6" rx="2.2" />
          <path d="M16.4 10.2 20.8 8v8l-4.4-2.2v-3.6Z" />
          <path d="M8.2 9.6h4.2" />
        </>
      );
    case "overview":
      return (
        <>
          <rect x="4" y="4" width="6.4" height="6.4" rx="1.2" />
          <rect x="13.6" y="4" width="6.4" height="6.4" rx="1.2" />
          <rect x="4" y="13.6" width="6.4" height="6.4" rx="1.2" />
          <rect x="13.6" y="13.6" width="6.4" height="6.4" rx="1.2" />
        </>
      );
    case "identity":
      return (
        <>
          <path d="M8.2 6.2 12 3.8l3.8 2.4" />
          <circle cx="12" cy="10" r="2.8" />
          <path d="M6.2 19.2a6.4 6.4 0 0 1 11.6 0" />
        </>
      );
    case "operations":
      return (
        <>
          <path d="M12 3.6 20.4 12 12 20.4 3.6 12 12 3.6Z" />
          <path d="M8.6 12h6.8M12 8.6v6.8" />
        </>
      );
    case "inbox":
      return (
        <>
          <rect x="3.6" y="5.4" width="16.8" height="13.2" rx="2.2" />
          <path d="m4.2 8 7.8 5.6L19.8 8" />
          <path d="M8.4 16h7.2" />
        </>
      );
    case "source":
      return (
        <>
          <circle cx="12" cy="12" r="7.2" />
          <path d="M12 12l4-2.2" />
          <circle cx="12" cy="12" r="1" />
          <path d="M12 4.8v2.2M19.2 12H17M12 19.2V17M4.8 12H7" />
        </>
      );
    case "score":
      return (
        <>
          <path d="M5.2 14.8a7.6 7.6 0 0 1 13.6 0" />
          <path d="M12 12l3.6-2.4" />
          <circle cx="12" cy="12" r="1.1" />
          <path d="M8 14.8h8" />
        </>
      );
    case "enrich":
      return (
        <>
          <path d="M12 4.8l1.2 3.2 3.2 1.2-3.2 1.2-1.2 3.2-1.2-3.2-3.2-1.2 3.2-1.2L12 4.8Z" />
          <path d="M6.2 14.6l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7.7-1.9Z" />
        </>
      );
    case "script":
      return (
        <>
          <path d="M7 4.6h8l3 3v11.8a2.2 2.2 0 0 1-2.2 2.2H7a2.2 2.2 0 0 1-2.2-2.2V6.8A2.2 2.2 0 0 1 7 4.6Z" />
          <path d="M15 4.6v3h3" />
          <path d="M8 12h8M8 15h6" />
        </>
      );
    case "outreach":
      return (
        <>
          <rect x="3.6" y="6" width="16.8" height="12.6" rx="2.2" />
          <path d="m4.2 8.4 7.8 5.2 7.8-5.2" />
          <path d="M14.4 9.2h4.2v4.2" />
          <path d="M18.6 9.2l-5.4 5.4" />
        </>
      );
    case "followup":
      return (
        <>
          <path d="M7.2 4.8 9 6.6c.6.6.7 1.5.2 2.2l-1 1.4c1.3 2.4 3.2 4.3 5.6 5.6l1.4-1c.7-.5 1.6-.4 2.2.2l1.8 1.8c.7.7.6 1.9-.3 2.4-1.5.9-3.3 1.3-5.1.7-3.1-1-6.4-4.3-7.4-7.4-.6-1.8-.2-3.6.7-5.1.5-.9 1.7-1 2.4-.3Z" />
        </>
      );
    case "booking":
      return (
        <>
          <rect x="4" y="5" width="16" height="15" rx="2.4" />
          <path d="M4 9.5h16M8 3.8v3.6M16 3.8v3.6" />
          <path d="m9.2 15.2 1.3 1.3 3.2-3.2" />
        </>
      );
    case "receipt":
      return (
        <>
          <path d="M7 4.8h10v15.4l-1.8-1.2-1.8 1.2-1.8-1.2-1.8 1.2-1.8-1.2-1.8 1.2V4.8Z" />
          <path d="M9 8h6M9 11h6M9 14h4" />
        </>
      );
    case "calendar":
      return (
        <>
          <rect x="4" y="5" width="16" height="15" rx="2.4" />
          <path d="M4 9.5h16M8 3.8v3.6M16 3.8v3.6" />
          <circle cx="9" cy="13" r="1" />
          <circle cx="12" cy="13" r="1" />
          <circle cx="15" cy="13" r="1" />
          <circle cx="9" cy="16" r="1" />
          <circle cx="12" cy="16" r="1" />
          <circle cx="15" cy="16" r="1" />
        </>
      );
    case "integrations":
      return (
        <>
          <circle cx="7" cy="8" r="2.2" />
          <circle cx="17" cy="8" r="2.2" />
          <circle cx="12" cy="17" r="2.2" />
          <path d="M8.8 9.3 10.6 14M15.2 9.3 13.4 14M9.2 8h5.6" />
        </>
      );
    case "vault":
      return (
        <>
          <path d="M12 3.8 18.6 6.6v5.8c0 4-2.6 6.7-6.6 7.8-4-1.1-6.6-3.8-6.6-7.8V6.6L12 3.8Z" />
          <circle cx="12" cy="11.2" r="1.3" />
          <path d="M12 12.5v2.4" />
        </>
      );
    case "drive":
      return (
        <>
          <path d="M4.8 8.6h6.1l1.6-2h6.7a2.3 2.3 0 0 1 2.3 2.3v8.7a2.3 2.3 0 0 1-2.3 2.3H7.1a2.3 2.3 0 0 1-2.3-2.3V8.6Z" />
          <path d="M4.8 10.4h16.7" />
        </>
      );
    case "activity":
      return (
        <>
          <path d="M3.8 12h3.5l1.8-3.6 3 7.2 2.1-4.2h5.9" />
          <path d="M4.2 6.4a8.8 8.8 0 0 1 15.6 0M4.2 17.6a8.8 8.8 0 0 0 15.6 0" />
        </>
      );
    case "people":
      return (
        <>
          <circle cx="8.5" cy="9.2" r="2.4" />
          <circle cx="15.5" cy="9.2" r="2.4" />
          <path d="M4.8 18.8a4.8 4.8 0 0 1 7.4-3.7M19.2 18.8a4.8 4.8 0 0 0-7.4-3.7" />
        </>
      );
    case "trend":
      return (
        <>
          <path d="m4 16 5.2-5.2 3.2 3.2L20 6.4" />
          <path d="M14.8 6.4H20v5.2" />
        </>
      );
    case "network":
      return (
        <>
          <circle cx="12" cy="12" r="8.4" />
          <path d="M3.8 12h16.4M12 3.8c2.5 2.1 3.8 5 3.8 8.2s-1.3 6.1-3.8 8.2M12 3.8c-2.5 2.1-3.8 5-3.8 8.2s1.3 6.1 3.8 8.2" />
        </>
      );
    case "mission":
    default:
      return (
        <>
          <path d="m12 3.6 3.9 5.1L12 17l-3.9-8.3L12 3.6Z" />
          <circle cx="12" cy="9.4" r="1.2" />
          <path d="m8.8 14.8-2.4 2.8M15.2 14.8l2.4 2.8M10.3 16.4 12 20.4l1.7-4" />
        </>
      );
  }
}

export function AfroGlyph({ variant = "mission", className, ...props }: AfroGlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("h-5 w-5", className)}
      {...props}
    >
      <GlyphPath variant={variant} />
    </svg>
  );
}
