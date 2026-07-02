import Link from "next/link";

import { ClipCard, EmptyState, MetricCard, SaasShell, StatePanel, recentClips } from "../saas-ui.jsx";

export const metadata = {
  title: "Dashboard · Kick Clipper",
};

export default function DashboardPage() {
  return (
    <SaasShell
      eyebrow="Creator command center"
      title="Dashboard"
      description="Monitor clip output, remaining exports, and the next viral moment to package."
    >
      <section className="dashboard-layout">
        <div className="dashboard-main">
          <div className="metric-grid">
            <MetricCard label="Plan" value="Creator Pro" detail="Renewing monthly · 4K renders enabled" />
            <MetricCard label="Exports remaining" value="18" detail="Resets in 12 days" />
            <MetricCard label="Clips posted" value="27" detail="+8 this week" />
            <MetricCard label="Tracked views" value="184K" detail="Across ready clips" />
          </div>

          <section className="saas-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Recent clips</span>
                <h2>Keep the posting queue moving.</h2>
              </div>
              <Link className="secondary-button" href="/clips">View all</Link>
            </div>
            <div className="clip-list">
              {recentClips.map((clip) => <ClipCard clip={clip} key={clip.title} />)}
            </div>
          </section>
        </div>

        <aside className="dashboard-side">
          <Link className="primary-button create-clip-cta" href="/">Create New Clip</Link>
          <section className="saas-panel plan-panel">
            <span className="eyebrow">Plan status</span>
            <h2>Creator Pro</h2>
            <div className="usage-meter" aria-label="18 exports remaining out of 30">
              <span style={{ width: "60%" }} />
            </div>
            <p>12 of 30 exports used this cycle. Upgrade when your clipping team scales up.</p>
          </section>
          <StatePanel state="loading" title="Loading state" body="Clip analytics load in this compact panel while reports refresh." />
          <StatePanel state="error" title="Error state" body="If a render fails, the dashboard surfaces the action needed without hiding your queue." />
        </aside>
      </section>

      <EmptyState
        title="No drafts waiting"
        body="When a new upload is saved but not exported, it will appear here so you can finish it later."
      />
    </SaasShell>
  );
}
