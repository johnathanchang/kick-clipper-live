import Link from "next/link";

export const recentClips = [
  {
    title: "Chat lost it after the clutch",
    status: "Ready",
    platform: "TikTok",
    views: "42.8K",
    created: "2h ago",
  },
  {
    title: "Streamer rage bait payoff",
    status: "Rendering",
    platform: "Shorts",
    views: "Pending",
    created: "Yesterday",
  },
  {
    title: "Perfect timing laugh clip",
    status: "Draft",
    platform: "Reels",
    views: "18.4K",
    created: "Jun 30",
  },
];

export const featureCards = [
  {
    title: "Retention-first captions",
    body: "Large mobile-readable captions, emoji support, and fast styling keep viewers locked into the moment.",
  },
  {
    title: "Kick watermark branding",
    body: "Creator links stay visible in the exported reel with a clean Kick-style bar built for clipping programs.",
  },
  {
    title: "Vertical crop planning",
    body: "Landscape stream moments become 9:16 clips with safe crop defaults for TikTok, Shorts, and Reels.",
  },
  {
    title: "Safe-zone aware layout",
    body: "Caption placement avoids bottom UI, watermark, and engagement zones that can block watchable content.",
  },
  {
    title: "Export-ready renders",
    body: "Captions, emoji, crop, and branding are burned into the final MP4 so creators can post immediately.",
  },
  {
    title: "Clipper workflow controls",
    body: "Go back to edit, download the finished clip, or reset into a fresh clipping session without friction.",
  },
];

export function SaasShell({ children, eyebrow = "Creator dashboard", title, description }) {
  return (
    <div className="saas-shell">
      <header className="saas-header">
        <Link className="saas-brand" href="/">Kick Clipper</Link>
        <nav className="saas-nav" aria-label="SaaS navigation">
          <Link href="/dashboard">Dashboard</Link>
          <Link href="/clips">My Clips</Link>
          <Link href="/features">Features</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/settings">Settings</Link>
        </nav>
        <div className="saas-header-actions">
          <Link className="ghost-button" href="/login">Login</Link>
          <Link className="primary-button" href="/">Create New Clip</Link>
        </div>
      </header>

      {(title || description) && (
        <section className="saas-hero">
          <span className="eyebrow">{eyebrow}</span>
          {title && <h1>{title}</h1>}
          {description && <p>{description}</p>}
        </section>
      )}

      <main>{children}</main>
    </div>
  );
}

export function MetricCard({ label, value, detail }) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

export function ClipCard({ clip }) {
  return (
    <article className="clip-card">
      <div className="clip-thumb" aria-hidden="true">
        <span>{clip.platform}</span>
      </div>
      <div>
        <h3>{clip.title}</h3>
        <p>{clip.created} · {clip.views} views</p>
      </div>
      <span className={`status-pill status-${clip.status.toLowerCase()}`}>{clip.status}</span>
    </article>
  );
}

export function StatePanel({ state, title, body }) {
  return (
    <article className={`state-panel state-${state}`}>
      <strong>{title}</strong>
      <p>{body}</p>
    </article>
  );
}

export function EmptyState({ title, body, actionHref = "/", actionLabel = "Create New Clip" }) {
  return (
    <section className="empty-state">
      <span className="empty-state-icon" aria-hidden="true">+</span>
      <h2>{title}</h2>
      <p>{body}</p>
      <Link className="primary-button" href={actionHref}>{actionLabel}</Link>
    </section>
  );
}

export function AuthShell({ mode }) {
  const isSignup = mode === "signup";

  return (
    <div className="auth-shell">
      <Link className="saas-brand" href="/">Kick Clipper</Link>
      <section className="auth-panel">
        <span className="eyebrow">{isSignup ? "Start clipping" : "Welcome back"}</span>
        <h1>{isSignup ? "Create your creator workspace." : "Log in to your clip dashboard."}</h1>
        <p>
          {isSignup
            ? "Track exports, manage clips, and keep your viral editing workflow in one place."
            : "Jump back into recent clips, remaining exports, and monetization-ready renders."}
        </p>
        <form className="auth-form">
          {isSignup && (
            <label>
              <span>Creator name</span>
              <input placeholder="Clavicular Clips" type="text" />
            </label>
          )}
          <label>
            <span>Email</span>
            <input placeholder="creator@example.com" type="email" />
          </label>
          <label>
            <span>Password</span>
            <input placeholder="Password" type="password" />
          </label>
          <button className="primary-button" type="button">
            {isSignup ? "Create Account" : "Login"}
          </button>
        </form>
        <p className="auth-switch">
          {isSignup ? "Already have an account?" : "New to Kick Clipper?"}{" "}
          <Link href={isSignup ? "/login" : "/signup"}>{isSignup ? "Login" : "Sign up"}</Link>
        </p>
      </section>
    </div>
  );
}
