interface Props {
  className?: string;
}

export default function Skeleton({ className = "" }: Props) {
  return (
    <div
      aria-hidden="true"
      className={`bg-surface-soft rounded animate-pulse motion-reduce:animate-none ${className}`}
    />
  );
}
