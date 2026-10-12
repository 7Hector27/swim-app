import { SHOW_PLACEHOLDERS } from "@/config/placeholders";

interface Props {
  children: React.ReactNode;
  label?: string;
  block?: boolean;
}

const badgeClass = "rounded-full bg-surface-soft border border-border text-text-secondary text-[10px] font-semibold px-1.5 leading-5 whitespace-nowrap";

export default function Placeholder({ children, label = "Coming soon", block = false }: Props) {
  if (!SHOW_PLACEHOLDERS) return <>{children}</>;

  if (block) {
    return (
      <div inert aria-hidden="true" className="relative">
        {children}
        <span className={`absolute -top-3 right-3 z-10 ${badgeClass}`}>{label}</span>
      </div>
    );
  }

  return (
    <span inert aria-hidden="true" className="inline-flex items-center gap-1.5">
      {children}
      <span className={badgeClass}>{label}</span>
    </span>
  );
}
