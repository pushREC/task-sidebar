export function SkeletonRow() {
  return (
    <div className="skeleton-row" aria-hidden="true">
      <div className="skeleton-circle" />
      <div className="skeleton-text">
        <div className="skeleton-line skeleton-line--title" />
        <div className="skeleton-line skeleton-line--meta" />
      </div>
    </div>
  );
}

export function SkeletonList({ count = 5 }: { count?: number }) {
  return (
    <div className="skeleton-list">
      {Array.from({ length: count }, (_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  );
}
