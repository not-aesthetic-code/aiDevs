export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function geocodeCity(city: string): Promise<{ lat: number; lon: number } | null> {
  const q = encodeURIComponent(`${city.trim()}, Poland`);
  const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1`, {
    headers: { "User-Agent": "findhim-task/1.0" },
  });
  if (!res.ok) return null;
  const arr = (await res.json()) as Array<{ lat?: string; lon?: string }>;
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const lat = parseFloat(arr[0].lat ?? "0");
  const lon = parseFloat(arr[0].lon ?? "0");
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}
