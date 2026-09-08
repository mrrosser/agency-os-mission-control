import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FirstPartyShareActions } from "@/components/crm/first-party-share-actions";
import { buildFirstPartyShareActionData, getFirstPartyShareCard } from "@/lib/crm/share-cards";
import "./contact-card.css";

type Props = { params: Promise<{ brand: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const card = getFirstPartyShareCard((await params).brand);
  return { title: card ? `${card.person} | ${card.name}` : "Contact card not found", robots: { index: false, follow: false } };
}

export default async function PublicContactCard({ params }: Props) {
  const card = getFirstPartyShareCard((await params).brand);
  if (!card) notFound();

  return (
    <main className={`public-contact-card ${card.brand}`}>
      <article>
        <p className="contact-card-kicker">{card.name} · New Orleans</p>
        <a className="contact-card-wordmark" href={card.website}>{card.name}</a>
        <h1>{card.person}</h1>
        <p className="contact-card-role">{card.role}</p>
        <p className="contact-card-description">{card.description}</p>
        <div className="contact-card-primary">
          <a href={card.liveUrl}>{card.liveAction}</a>
          {card.messageUrl !== card.liveUrl ? <a href={card.messageUrl}>Send a message</a> : null}
          <a href={`mailto:${card.email}`}>Email {card.name}</a>
        </div>
        <section aria-label="Save or share this contact">
          <FirstPartyShareActions card={buildFirstPartyShareActionData(card)} />
          <p className="contact-card-permission">Saving this contact is just for your address book. No details are sent to us, and it does not subscribe you to a newsletter.</p>
        </section>
        <nav className="contact-card-socials" aria-label={`${card.name} and Marcus social links`}>
          {card.socials.map((social) => <a key={social.href} href={social.href} target="_blank" rel="noopener noreferrer">{social.label}<span aria-hidden="true"> ↗</span><span className="sr-only"> (opens in a new tab)</span></a>)}
        </nav>
        <section className="contact-card-qr" aria-label="QR code for the current live intake page">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={card.qrPath} width={492} height={492} alt={`Scan to open ${card.liveUrl}`} />
          <div><h2>Continue on the live website</h2><p>This QR opens the current {card.brand === "rosser-gallery" ? "gallery community page, where you can choose email updates" : "RT Solutions inquiry form"}.</p><a href={card.liveUrl}>{card.liveUrl}</a></div>
        </section>
        <p className="contact-card-permission">{card.brand === "rosser-gallery" ? "Gallery email updates require your choice on the signup form. Sending a message is separate from newsletter signup." : "A project inquiry is for responding to your request. It does not enroll you in RT Solutions or gallery newsletters."}</p>
        <footer><a href={card.website}>Visit {card.name}</a><span>Connect directly · on your terms</span></footer>
      </article>
    </main>
  );
}
