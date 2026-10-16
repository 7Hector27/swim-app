export default function AgeBlockedScreen() {
  return (
    <div className="flex flex-col flex-1">
      <main className="flex-1 flex items-center justify-center px-page py-16">
        <div className="w-full max-w-sm text-center">
          <h1 className="text-heading mb-4">Not available</h1>
          <p className="text-text-secondary">
            Ask a parent or guardian to create an account.
          </p>
        </div>
      </main>
    </div>
  );
}
