import Link from "next/link";

import { ClipCard, EmptyState, SaasShell, StatePanel, recentClips } from "../saas-ui.jsx";

export const metadata = {
  title: "My Clips · Kick Clipper",
};

export default function ClipsPage() {
  return (
    <SaasShell
      eyebrow="Clip library"
      title="My Clips"
      description="Review ready exports, drafts, and renders that need attention before posting."
    >
      <section className="saas-panel">
        <div className="clips-toolbar">
          <input aria-label="Search clips" placeholder="Search clips, platform, or status" type="search" />
          <Link className="primary-button" href="/">Create New Clip</Link>
        </div>
        <div className="clip-list clip-list-library">
          {recentClips.map((clip) => <ClipCard clip={clip} key={clip.title} />)}
        </div>
      </section>

      <div className="state-grid">
        <StatePanel state="loading" title="Loading library" body="Skeleton rows keep the page stable while clips sync." />
        <StatePanel state="error" title="Render needs attention" body="Failed clips show a focused retry path instead of disappearing." />
      </div>

      <EmptyState
        title="No archived clips yet"
        body="Archived exports will live here once your team starts cycling older posts out of the active queue."
        actionHref="/"
        actionLabel="Upload First Clip"
      />
    </SaasShell>
  );
}
