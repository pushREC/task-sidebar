import type { ComponentType } from "react";

interface EmptyStateProps {
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  title: string;
  hint?: string;
}

export function EmptyState({ icon: Icon, title, hint }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">
        <Icon size={24} strokeWidth={1.5} />
      </div>
      <div className="empty-state-title">{title}</div>
      {hint && <div className="empty-state-hint">{hint}</div>}
    </div>
  );
}
