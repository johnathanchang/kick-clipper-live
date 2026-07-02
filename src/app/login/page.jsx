import { AuthShell } from "../saas-ui.jsx";

export const metadata = {
  title: "Login · Kick Clipper",
};

export default function LoginPage() {
  return <AuthShell mode="login" />;
}
