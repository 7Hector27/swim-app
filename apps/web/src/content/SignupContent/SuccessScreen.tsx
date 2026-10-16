export default function SuccessScreen() {
  return (
    <div className="flex flex-col flex-1">
      <main className="flex-1 flex items-center justify-center px-page py-16">
        <div className="w-full max-w-sm text-center">
          <h1 className="text-heading mb-4">Check your email</h1>
          <p className="text-text-secondary">
            We sent a confirmation link to your email address. Click it to
            activate your account.
          </p>
        </div>
      </main>
    </div>
  );
}
