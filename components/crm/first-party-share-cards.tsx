"use client";

import {
  FIRST_PARTY_SHARE_CARDS,
  buildFirstPartyShareActionData,
} from "@/lib/crm/share-cards";
import { SHARE_CARD_PRIVATE_SYNC_STATUS } from "@/lib/crm/share-card-private-metadata";
import { FirstPartyShareActions } from "@/components/crm/first-party-share-actions";

export function FirstPartyShareCards() {
  return (
    <section aria-label="First-party business share cards">
      <p style={{ margin: "18px 0", color: "#c4b8ca", fontSize: "13px", lineHeight: 1.7 }}>
        Open a public card to share your contact details and socials. These QR images and shared links continue to open the existing live intake pages.
      </p>
      <div className="crm-share-grid">
        {FIRST_PARTY_SHARE_CARDS.map((card) => (
          <article className="crm-share-card" key={card.brand}>
            <h2>{card.name}</h2>
            <p>{card.person} · {card.role}</p>
            {/* Plain img preserves an offline, downloadable QR without image-optimizer routing. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={card.qrPath} width={492} height={492} alt={`${card.name} QR code opening ${card.liveUrl}`} />
            <p>QR destination: <a href={card.liveUrl} target="_blank" rel="noopener noreferrer" style={{ overflowWrap: "anywhere", textDecoration: "underline" }}>{card.liveUrl}</a></p>
            <FirstPartyShareActions card={buildFirstPartyShareActionData(card)} />
            <div className="crm-share-actions">
              <a href={card.liveUrl} target="_blank" rel="noopener noreferrer">{card.liveAction}</a>
              <a href={card.candidatePath} target="_blank" rel="noopener noreferrer">Open public contact card</a>
            </div>
            <p className="crm-share-status">{SHARE_CARD_PRIVATE_SYNC_STATUS[card.brand]}</p>
          </article>
        ))}
      </div>
      <p style={{ margin: "18px 0", fontSize: "13px", color: "#c4b8ca" }}>
        Scanning, sharing, or saving a contact does not collect the visitor&apos;s details or enroll anyone in email updates. Visitors choose whether to submit a form; newsletter permission stays separate for each business.
      </p>
    </section>
  );
}
