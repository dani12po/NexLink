import { redirect } from 'next/navigation'

export default function BridgePage() {
  redirect('/dapp?tab=bridge')
}
