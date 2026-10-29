import { Toaster as Sonner } from "sonner";

// Theme follows the OS setting (no next-themes in this app).
const Toaster = ({ ...props }) => (
  <Sonner
    theme="system"
    className="toaster group"
    style={{
      "--normal-bg": "var(--popover)",
      "--normal-text": "var(--popover-foreground)",
      "--normal-border": "var(--border)",
    }}
    {...props}
  />
);

export { Toaster };
