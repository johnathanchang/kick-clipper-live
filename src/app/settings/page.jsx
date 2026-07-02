import { SaasShell } from "../saas-ui.jsx";

export const metadata = {
  title: "Settings · Kick Clipper",
};

export default function SettingsPage() {
  return (
    <SaasShell
      eyebrow="Workspace controls"
      title="Settings"
      description="Manage creator defaults, plan usage, export behavior, and notification preferences."
    >
      <section className="settings-grid-saas">
        <form className="saas-panel settings-form">
          <span className="eyebrow">Profile</span>
          <label>
            <span>Workspace name</span>
            <input defaultValue="Clavicular Clips" type="text" />
          </label>
          <label>
            <span>Default Kick link</span>
            <input defaultValue="kick.com/clavicular" type="text" />
          </label>
          <button className="primary-button" type="button">Save Profile</button>
        </form>

        <form className="saas-panel settings-form">
          <span className="eyebrow">Export defaults</span>
          <label>
            <span>Caption style</span>
            <select defaultValue="classic">
              <option value="classic">Classic viral caption</option>
              <option value="clean">Clean white text</option>
              <option value="dark">Dark caption chip</option>
            </select>
          </label>
          <label>
            <span>Default platform</span>
            <select defaultValue="tiktok">
              <option value="tiktok">TikTok / Reels / Shorts</option>
              <option value="shorts">YouTube Shorts</option>
            </select>
          </label>
          <button className="secondary-button" type="button">Update Defaults</button>
        </form>

        <section className="saas-panel danger-panel">
          <span className="eyebrow">Billing</span>
          <h2>Creator Pro</h2>
          <p>18 exports remaining. Your plan renews automatically at the end of the cycle.</p>
          <button className="secondary-button" type="button">Manage Billing</button>
        </section>
      </section>
    </SaasShell>
  );
}
