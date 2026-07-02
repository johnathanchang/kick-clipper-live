import { SaasShell, featureCards } from "../saas-ui.jsx";

export const metadata = {
  title: "Features · Kick Clipper",
};

export default function FeaturesPage() {
  return (
    <SaasShell
      eyebrow="Viral editing system"
      title="Everything built around making stream moments perform."
      description="Kick Clipper combines creator branding, vertical formatting, caption systems, and export controls in one workflow."
    >
      <section className="features-grid saas-feature-grid">
        {featureCards.map((feature) => (
          <article className="feature-card" key={feature.title}>
            <h3>{feature.title}</h3>
            <p>{feature.body}</p>
          </article>
        ))}
      </section>
    </SaasShell>
  );
}
