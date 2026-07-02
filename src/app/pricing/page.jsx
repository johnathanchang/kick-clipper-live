import Link from "next/link";

import { SaasShell } from "../saas-ui.jsx";

export const metadata = {
  title: "Pricing · Kick Clipper",
};

const plans = [
  ["Starter", "$0", "5 exports monthly", "For testing the workflow"],
  ["Creator", "$19", "50 exports monthly", "For consistent solo clippers"],
  ["Team", "$49", "200 exports monthly", "For clip teams and agencies"],
];

export default function PricingPage() {
  return (
    <SaasShell
      eyebrow="Freemium plans"
      title="Start free, upgrade when clips start moving."
      description="Simple pricing for creators who need clean exports, branding, and a faster path to monetized posting."
    >
      <section className="pricing-grid">
        {plans.map(([name, price, allowance, detail]) => (
          <article className={`pricing-card ${name === "Creator" ? "pricing-card-featured" : ""}`} key={name}>
            <span className="eyebrow">{name}</span>
            <h2>{price}<small>/mo</small></h2>
            <p>{allowance}</p>
            <strong>{detail}</strong>
            <ul>
              <li>Vertical reel exports</li>
              <li>Kick branding bar</li>
              <li>Caption and emoji rendering</li>
              <li>Clip library dashboard</li>
            </ul>
            <Link className={name === "Creator" ? "primary-button" : "secondary-button"} href="/signup">
              {name === "Starter" ? "Start Free" : "Choose Plan"}
            </Link>
          </article>
        ))}
      </section>
    </SaasShell>
  );
}
