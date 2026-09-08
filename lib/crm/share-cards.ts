export const SHARE_CARD_BRANDS = ["rosser-gallery", "rt-solutions"] as const;
export type ShareCardBrand = (typeof SHARE_CARD_BRANDS)[number];

export interface FirstPartyShareCard {
  brand: ShareCardBrand;
  name: string;
  person: string;
  role: string;
  description: string;
  email: string;
  website: string;
  liveUrl: string;
  liveAction: string;
  messageUrl: string;
  qrPath: string;
  vcardPath: string;
  candidatePath: string;
  socials: ReadonlyArray<{ label: string; href: string }>;
}

/** Exact public fields allowed across the share-action client boundary. */
export type FirstPartyShareActionData = Pick<
  FirstPartyShareCard,
  "brand" | "name" | "person" | "liveUrl" | "qrPath" | "vcardPath"
>;

export function buildFirstPartyShareActionData(card: FirstPartyShareCard): FirstPartyShareActionData {
  // Construct a new allowlisted object rather than forwarding/spreading a card.
  return {
    brand: card.brand,
    name: card.name,
    person: card.person,
    liveUrl: card.liveUrl,
    qrPath: card.qrPath,
    vcardPath: card.vcardPath,
  };
}

export const FIRST_PARTY_SHARE_CARDS: readonly FirstPartyShareCard[] = [
  {
    brand: "rosser-gallery",
    name: "Rosser Gallery",
    person: "Marcus Rosser",
    role: "Artist, educator & founder",
    description: "Art, hands-on making, and community in New Orleans.",
    email: "mrosser@rossergallery.com",
    website: "https://rossergallery.com/",
    liveUrl: "https://rossergallery.com/qr",
    liveAction: "Explore & join gallery updates",
    messageUrl: "https://rossergallery.com/contact/",
    qrPath: "/media/contact-cards/rosser-gallery-qr.png",
    vcardPath: "/contacts/marcus-rosser-gallery.vcf",
    candidatePath: "/connect/rosser-gallery",
    socials: [
      { label: "Gallery Instagram", href: "https://www.instagram.com/rossergallery/" },
      { label: "Gallery Facebook", href: "https://www.facebook.com/profile.php?id=431715610021973" },
      { label: "Marcus on Instagram · personal", href: "https://www.instagram.com/mr_rosser/" },
      { label: "Marcus on LinkedIn · personal", href: "https://www.linkedin.com/in/marcuslrosser" },
    ],
  },
  {
    brand: "rt-solutions",
    name: "RT Solutions",
    person: "Marcus Rosser",
    role: "Founder & technology consultant",
    description: "Practical AI, software, and technology support for your next project.",
    email: "info@rt.solutions",
    website: "https://rt.solutions/",
    liveUrl: "https://rt.solutions/contact",
    liveAction: "Start a project conversation",
    messageUrl: "https://rt.solutions/contact",
    qrPath: "/media/contact-cards/rt-solutions-qr.png",
    vcardPath: "/contacts/marcus-rt-solutions.vcf",
    candidatePath: "/connect/rt-solutions",
    socials: [
      { label: "Marcus on LinkedIn · personal", href: "https://www.linkedin.com/in/marcuslrosser" },
      { label: "Marcus on Instagram · personal", href: "https://www.instagram.com/mr_rosser/" },
    ],
  },
];

export function getFirstPartyShareCard(brand: string): FirstPartyShareCard | undefined {
  return FIRST_PARTY_SHARE_CARDS.find((card) => card.brand === brand);
}

export function escapeVCardText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\r\n|\r|\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,");
}

export function buildFirstPartyVCard(card: FirstPartyShareCard): string {
  return [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${escapeVCardText(card.person)}`,
    "N:Rosser;Marcus;;;",
    `ORG:${escapeVCardText(card.name)}`,
    `TITLE:${escapeVCardText(card.role)}`,
    `EMAIL;TYPE=INTERNET,WORK:${card.email}`,
    `URL:${card.website}`,
    "NOTE:Saving this contact does not subscribe you to email updates.",
    "END:VCARD",
    "",
  ].join("\r\n");
}

export interface ShareCardBrowser {
  share?: (data: { title: string; text: string; url: string }) => Promise<void>;
  clipboard?: { writeText: (text: string) => Promise<void> };
}

export async function shareFirstPartyCard(
  card: Pick<FirstPartyShareActionData, "name" | "person" | "liveUrl">,
  browser: ShareCardBrowser,
  preferNativeShare = true,
): Promise<"shared" | "copied" | "cancelled" | "manual"> {
  if (preferNativeShare && browser.share) {
    try {
      await browser.share({ title: card.name, text: `${card.person} · ${card.name}`, url: card.liveUrl });
      return "shared";
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return "cancelled";
    }
  }
  if (browser.clipboard) {
    try {
      await browser.clipboard.writeText(card.liveUrl);
      return "copied";
    } catch {
      // A visible, selectable URL remains available when clipboard access fails.
    }
  }
  return "manual";
}
