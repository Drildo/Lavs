import { NextResponse } from 'next/server'
import { executeOperatorAction, listOperatorActions, listRecentOperatorRuns, prepareOperatorAction } from '@/lib/operator-actions'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  const [actions, recentRuns] = await Promise.all([
    Promise.resolve(listOperatorActions()),
    listRecentOperatorRuns(),
  ])

  return NextResponse.json({
    actions,
    recentRuns,
    generatedAt: new Date().toISOString(),
  }, {
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    },
  })
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      actionId?: string
      mode?: 'prepare' | 'confirm'
      confirmationToken?: string
    }

    if (!body.actionId || !body.mode) {
      return NextResponse.json({ error: 'actionId and mode are required' }, { status: 400 })
    }

    if (body.mode === 'prepare') {
      return NextResponse.json(prepareOperatorAction(body.actionId))
    }

    if (body.mode === 'confirm') {
      if (!body.confirmationToken) {
        return NextResponse.json({ error: 'confirmationToken is required for confirm mode' }, { status: 400 })
      }

      return NextResponse.json(await executeOperatorAction(body.actionId, body.confirmationToken))
    }

    return NextResponse.json({ error: 'Unsupported mode' }, { status: 400 })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Operator action failed',
    }, { status: 400 })
  }
}
