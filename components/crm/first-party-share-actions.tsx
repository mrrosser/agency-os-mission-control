"use client";

import { useState } from "react";
import { shareFirstPartyCard, type FirstPartyShareActionData } from "@/lib/crm/share-cards";

/** Public client entry: no authenticated workspace or internal sync metadata imports. */
export function FirstPartyShareActions({ card }: { card: FirstPartyShareActionData }) {
  const [status, setStatus] = useState("");
  const [manualCopy, setManualCopy] = useState(false);

  async function share(preferNativeShare: boolean) {
    const result = await shareFirstPartyCard(card, {
      share: typeof navigator.share === "function" ? navigator.share.bind(navigator) : undefined,
      clipboard: navigator.clipboard,
    }, preferNativeShare);
    setManualCopy(result === "manual");
    setStatus({
      shared: "Live intake link shared.",
      copied: "Live intake link copied.",
      cancelled: "Share cancelled. Nothing was sent.",
      manual: "Copy the link below, or open the live page.",
    }[result]);
  }

  return (
    <>
      <div className="crm-share-actions contact-card-actions">
        <a href={card.vcardPath} download>Save Marcus&apos;s contact</a>
        <button type="button" onClick={() => void share(true)}>Share live link</button>
        <button type="button" onClick={() => void share(false)}>Copy live link</button>
        <a href={card.qrPath} download={`${card.brand}-qr.png`}>Download QR</a>
      </div>
      <p role="status" aria-live="polite">{status}</p>
      {manualCopy ? (
        <label style={{ display: "block", margin: "12px 0", fontSize: "13px" }}>
          Live intake URL
          <input aria-label={`${card.name} live intake URL`} readOnly value={card.liveUrl}
            onFocus={(event) => event.currentTarget.select()}
            style={{ width: "100%", padding: "12px", marginTop: "6px", color: "#211c25", background: "#fff", borderRadius: "8px" }} />
        </label>
      ) : null}
    </>
  );
}
