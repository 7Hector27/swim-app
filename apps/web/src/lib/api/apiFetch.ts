export async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const method = (init?.method ?? "GET").toUpperCase();
    let path = url;
    try {
      path = new URL(url).pathname;
    } catch {
      // not a fully-qualified URL
    }
    console.warn(`[api] ${method} ${path} → ${response.status}`);
  }
  return response;
}
