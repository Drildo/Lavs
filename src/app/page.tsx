import { OpenLabAppShell } from '@/components/openlab/openlab-app-shell'
import { getOpenLabSnapshot } from '@/lib/openclaw-adapters'

export default async function HomePage() {
  const snapshot = await getOpenLabSnapshot()

  return <OpenLabAppShell snapshot={snapshot} />
}
