interface FieldErrorProps {
  id: string;
  message: string | undefined;
}

export default function FieldError({ id, message }: FieldErrorProps) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-danger text-xs mt-1">
      {message}
    </p>
  );
}
