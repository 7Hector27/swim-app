export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-4xl font-bold tracking-tight">Swim App</h1>
      <p className="text-gray-500">Ready to build.</p>
      <div className="p-8 bg-red-500 tablet:bg-blue-500 desktop:bg-green-500">Breakpoint test</div>
    </main>
  );
}
