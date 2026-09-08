"use client";

/** Deliberately independent of providers, auth, fonts, and the Firebase module. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#0c111b", color: "#f6f3ee", fontFamily: "system-ui, sans-serif" }}>
        <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: "24px", boxSizing: "border-box" }}>
          <section role="alert" style={{ width: "100%", maxWidth: "480px", padding: "32px", border: "1px solid #354052", borderRadius: "24px", boxSizing: "border-box" }}>
            <p style={{ fontSize: "13px", letterSpacing: ".12em", color: "#bcd7cc" }}>MISSION CONTROL</p>
            <h1 style={{ fontSize: "28px", lineHeight: 1.2 }}>Let’s get your workspace back.</h1>
            <p style={{ color: "#c6cbd3", lineHeight: 1.6 }}>
              Something interrupted the app while it was opening. Reload the page to try again.
              If this keeps happening, the app needs a configuration check.
            </p>
            <button onClick={() => window.location.reload()} style={{ minHeight: "48px", padding: "12px 20px", background: "#c9eadb", color: "#101820", font: "inherit", border: 0, borderRadius: "12px", cursor: "pointer", marginRight: "12px", marginBottom: "12px" }}>Reload workspace</button>
            <button onClick={reset} style={{ minHeight: "48px", padding: "12px 20px", background: "transparent", color: "#f6f3ee", font: "inherit", border: "1px solid #667183", borderRadius: "12px", cursor: "pointer" }}>Try again</button>
          </section>
        </main>
      </body>
    </html>
  );
}
