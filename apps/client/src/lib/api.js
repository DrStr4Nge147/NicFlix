export async function apiFetch(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...options.headers
    },
    ...options
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${response.status}`);
  }

  return response.json();
}

export function posterUrl(item) {
  return item?.poster_path || null;
}

export function backdropUrl(item) {
  return item?.backdrop_path || item?.poster_path || null;
}

