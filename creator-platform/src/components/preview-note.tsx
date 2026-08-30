import { FlaskConical } from "lucide-react";

export function PreviewNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="preview-note" role="status">
      <FlaskConical aria-hidden="true" size={15} strokeWidth={1.8} />
      <span>{children}</span>
    </div>
  );
}
