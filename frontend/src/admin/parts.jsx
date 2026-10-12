// Small shared admin components.

// Status: reserved colors, always with an icon + label.
const STATUS = {
  good:     { color: '#0ca30c', icon: '●' },
  warning:  { color: '#fab219', icon: '◐' },
  critical: { color: '#d03b3b', icon: '✕' },
  neutral:  { color: 'var(--muted)', icon: '○' },
};
export function StatusBadge({ tone, children }) {
  const s = STATUS[tone] || STATUS.neutral;
  return (
    <span className="inline-flex items-center gap-1 text-xs font-bold" style={{ color: 'var(--text)' }}>
      <span aria-hidden="true" style={{ color: s.color }}>{s.icon}</span>{children}
    </span>
  );
}

export function ErrorNote({ error }) {
  if (!error) return null;
  return <div role="alert" className="text-sm font-semibold" style={{ color: 'var(--danger)' }}>{error}</div>;
}

export function Section({ title, right, children }) {
  return (
    <section className="panel p-4 flex flex-col gap-3 min-w-0">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-sm font-extrabold">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}
