// Vercel/Next behind proxy: use x-forwarded-for. Fallback to x-real-ip.
export function getClientIp(req) {
  const xff = req.headers.get("x-forwarded-for") || "";
  // x-forwarded-for may be "client, proxy1, proxy2"
  const first = xff.split(",")[0].trim();
  const xr = (req.headers.get("x-real-ip") || "").trim();
  return first || xr || "0.0.0.0";
}
