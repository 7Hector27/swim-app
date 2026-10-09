interface FieldErrorProps {
  message: string | undefined;
}

export default function FieldError({ message }: FieldErrorProps) {
  if (!message) return null;
  return <p className="text-danger text-xs mt-1">{message}</p>;
}
