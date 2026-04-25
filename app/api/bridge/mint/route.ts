/**
 * app/api/bridge/mint/route.ts
 * BridgeKit mengelola mint langsung dari browser.
 * Route ini tidak digunakan — return 410 Gone.
 */
export async function POST() {
  return Response.json(
    { error: 'Tidak digunakan — BridgeKit handle mint dari browser' },
    { status: 410 },
  )
}
