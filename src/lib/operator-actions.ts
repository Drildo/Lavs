import { createHmac, randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { getOpenLabSnapshot } from '@/lib/openclaw-adapters'

const execFileAsync = promisify(execFile)

const WORKSPACE_ROOT = '/Users/openclaw/.openclaw/workspace'
const OPENLAB_ROOT = join(WORKSPACE_ROOT, 'openlab')
const OPERATOR_ROOT = join(OPENLAB_ROOT, '.openlab-operator')
const ACTION_RUNS_ROOT = join(OPERATOR_ROOT, 'action-runs')
const SNAPSHOT_ROOT = join(OPERATOR_ROOT, 'snapshots')
const CONFIRMATION_SECRET = createHmac('sha256', `${OPENLAB_ROOT}:${process.env.USER ?? 'openclaw'}`).update('openlab-operator-actions').digest('hex')
const CONFIRMATION_TTL_MS = 5 * 60 * 1000
const COMMAND_TIMEOUT_MS = 15 * 1000

export type OperatorActionId = 'refresh_snapshot' | 'run_local_health_check'
export type OperatorConfirmationState = 'idle' | 'needs_confirmation' | 'confirmed' | 'completed' | 'failed'

export interface OperatorActionDefinition {
  id: OperatorActionId
  label: string
  summary: string
  confirmationLabel: string
  writeScope: string[]
  safetyBoundaries: string[]
  provenance: string[]
}

export interface OperatorActionRunRecord {
  runId: string
  actionId: OperatorActionId
  actionLabel: string
  state: 'completed' | 'failed'
  requestedAt: string
  confirmedAt: string
  completedAt: string
  requestedBy: string
  origin: string
  summary: string
  details: string[]
  writeTargets: string[]
  evidence: string[]
  command?: { program: string; args: string[]; exitCode: number | null }
}

export interface OperatorActionPrepareResult {
  state: 'needs_confirmation'
  confirmationToken: string
  expiresAt: string
  action: OperatorActionDefinition
}

export interface OperatorActionExecuteResult {
  state: 'completed' | 'failed'
  run: OperatorActionRunRecord
}

const ACTION_DEFINITIONS: Record<OperatorActionId, OperatorActionDefinition> = {
  refresh_snapshot: {
    id: 'refresh_snapshot',
    label: 'Refresh local snapshot artifact',
    summary: 'Recompute the current OpenLab snapshot and write a timestamped JSON artifact inside openlab/.openlab-operator/snapshots only.',
    confirmationLabel: 'Confirm snapshot refresh',
    writeScope: ['openlab/.openlab-operator/snapshots/latest.json', 'openlab/.openlab-operator/snapshots/*.json', 'openlab/.openlab-operator/action-runs/*.json'],
    safetyBoundaries: [
      'Reads local OpenLab sources only, no network calls beyond localhost-backed snapshot readers.',
      'Writes are confined to the openlab/.openlab-operator directory.',
      'Does not mutate workspace source files, cron state, memory, or external services.',
    ],
    provenance: ['Includes generatedAt, actor, origin, and source evidence in the saved artifact.'],
  },
  run_local_health_check: {
    id: 'run_local_health_check',
    label: 'Run local gateway health check',
    summary: 'Runs a bounded local health probe using openclaw gateway status and records the exact command, exit code, and captured output in an action run log.',
    confirmationLabel: 'Confirm local health check',
    writeScope: ['openlab/.openlab-operator/action-runs/*.json'],
    safetyBoundaries: [
      'Executes a single allowlisted local command: openclaw gateway status.',
      'No restart, stop, or external write path is available.',
      'Writes only the resulting audit record under openlab/.openlab-operator/action-runs.',
    ],
    provenance: ['Stores exact command arguments, timestamps, actor, origin, and output excerpts.'],
  },
}

export function listOperatorActions(): OperatorActionDefinition[] {
  return Object.values(ACTION_DEFINITIONS)
}

export async function listRecentOperatorRuns(limit = 6): Promise<OperatorActionRunRecord[]> {
  try {
    const filenames = (await readdir(ACTION_RUNS_ROOT)).filter((name) => name.endsWith('.json')).sort().reverse().slice(0, limit)
    const runs = await Promise.all(filenames.map(async (filename) => {
      const raw = await readFile(join(ACTION_RUNS_ROOT, filename), 'utf8')
      return JSON.parse(raw) as OperatorActionRunRecord
    }))
    return runs.sort((left, right) => right.completedAt.localeCompare(left.completedAt))
  } catch {
    return []
  }
}

export function prepareOperatorAction(actionId: string): OperatorActionPrepareResult {
  const action = ACTION_DEFINITIONS[actionId as OperatorActionId]
  if (!action) {
    throw new Error('Unknown action')
  }

  const expiresAt = new Date(Date.now() + CONFIRMATION_TTL_MS).toISOString()
  const payload = `${action.id}::${expiresAt}`
  const signature = createHmac('sha256', CONFIRMATION_SECRET).update(payload).digest('hex')

  return {
    state: 'needs_confirmation',
    confirmationToken: `${payload}::${signature}`,
    expiresAt,
    action,
  }
}

export async function executeOperatorAction(actionId: string, confirmationToken: string): Promise<OperatorActionExecuteResult> {
  const action = ACTION_DEFINITIONS[actionId as OperatorActionId]
  if (!action) {
    throw new Error('Unknown action')
  }

  validateConfirmationToken(action.id, confirmationToken)
  await ensureOperatorDirectories()

  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${action.id}-${randomUUID().slice(0, 8)}`
  const requestedAt = new Date().toISOString()
  const confirmedAt = requestedAt

  try {
    const run = action.id === 'refresh_snapshot'
      ? await runSnapshotRefresh(runId, requestedAt, confirmedAt)
      : await runLocalHealthCheck(runId, requestedAt, confirmedAt)

    await persistRunRecord(run)
    return { state: run.state, run }
  } catch (error) {
    const failedRun: OperatorActionRunRecord = {
      runId,
      actionId: action.id,
      actionLabel: action.label,
      state: 'failed',
      requestedAt,
      confirmedAt,
      completedAt: new Date().toISOString(),
      requestedBy: 'openlab-ui',
      origin: 'localhost operator action',
      summary: error instanceof Error ? error.message : 'Operator action failed',
      details: ['Execution stopped before completing the bounded action.'],
      writeTargets: [relativeOpenLabPath(ACTION_RUNS_ROOT)],
      evidence: [],
    }
    await persistRunRecord(failedRun)
    return { state: 'failed', run: failedRun }
  }
}

async function runSnapshotRefresh(runId: string, requestedAt: string, confirmedAt: string): Promise<OperatorActionRunRecord> {
  const snapshot = await getOpenLabSnapshot()
  const stampedAt = new Date().toISOString()
  const historyPath = join(SNAPSHOT_ROOT, `${runId}.json`)
  const latestPath = join(SNAPSHOT_ROOT, 'latest.json')
  const artifact = {
    runId,
    actionId: 'refresh_snapshot',
    generatedAt: stampedAt,
    requestedAt,
    confirmedAt,
    requestedBy: 'openlab-ui',
    origin: 'localhost operator action',
    source: '/api/openlab/actions',
    snapshot,
  }

  const payload = JSON.stringify(artifact, null, 2)
  await writeFile(historyPath, payload, 'utf8')
  await writeFile(latestPath, payload, 'utf8')

  return {
    runId,
    actionId: 'refresh_snapshot',
    actionLabel: ACTION_DEFINITIONS.refresh_snapshot.label,
    state: 'completed',
    requestedAt,
    confirmedAt,
    completedAt: stampedAt,
    requestedBy: 'openlab-ui',
    origin: 'localhost operator action',
    summary: `Snapshot refreshed with ${snapshot.tasks.length} task(s), ${snapshot.monitoring.length} monitor card(s), and ${snapshot.alerts.length} alert(s).`,
    details: [
      `Snapshot generated at ${snapshot.generatedAt}.`,
      'Artifact saved as both latest.json and a timestamped history file for provenance.',
      'No source documents were modified during refresh.',
    ],
    writeTargets: [relativeOpenLabPath(latestPath), relativeOpenLabPath(historyPath), relativeOpenLabPath(ACTION_RUNS_ROOT)],
    evidence: [
      `generatedAt=${snapshot.generatedAt}`,
      `tasks=${snapshot.tasks.length}`,
      `monitoring=${snapshot.monitoring.length}`,
      `alerts=${snapshot.alerts.length}`,
    ],
  }
}

async function runLocalHealthCheck(runId: string, requestedAt: string, confirmedAt: string): Promise<OperatorActionRunRecord> {
  const command = {
    program: 'openclaw',
    args: ['gateway', 'status'],
  }

  try {
    const { stdout, stderr } = await execFileAsync(command.program, command.args, {
      cwd: OPENLAB_ROOT,
      timeout: COMMAND_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    })
    const completedAt = new Date().toISOString()
    const combinedOutput = [stdout.trim(), stderr.trim()].filter(Boolean)
    const detail = combinedOutput[0] ?? 'openclaw gateway status returned no output.'

    return {
      runId,
      actionId: 'run_local_health_check',
      actionLabel: ACTION_DEFINITIONS.run_local_health_check.label,
      state: 'completed',
      requestedAt,
      confirmedAt,
      completedAt,
      requestedBy: 'openlab-ui',
      origin: 'localhost operator action',
      summary: detail.split(/\r?\n/)[0]?.slice(0, 220) ?? 'Local gateway status completed.',
      details: combinedOutput.length ? combinedOutput.flatMap((chunk) => chunk.split(/\r?\n/).slice(0, 6)) : ['Gateway status command completed without textual output.'],
      writeTargets: [relativeOpenLabPath(ACTION_RUNS_ROOT)],
      evidence: ['Command executed locally with a 15s timeout.', 'No service restart or mutation command was exposed.'],
      command: {
        ...command,
        exitCode: 0,
      },
    }
  } catch (error) {
    const failure = error as Error & {
      stdout?: string
      stderr?: string
      code?: number | string
      signal?: string | null
      killed?: boolean
    }
    const completedAt = new Date().toISOString()
    const combinedOutput = [failure.stdout?.trim(), failure.stderr?.trim(), failure.message].filter(Boolean) as string[]
    const exitCode = typeof failure.code === 'number' ? failure.code : null

    return {
      runId,
      actionId: 'run_local_health_check',
      actionLabel: ACTION_DEFINITIONS.run_local_health_check.label,
      state: 'failed',
      requestedAt,
      confirmedAt,
      completedAt,
      requestedBy: 'openlab-ui',
      origin: 'localhost operator action',
      summary: combinedOutput[0]?.split(/\r?\n/)[0]?.slice(0, 220) ?? 'Local gateway status failed.',
      details: combinedOutput.length
        ? combinedOutput.flatMap((chunk) => chunk.split(/\r?\n/).slice(0, 6))
        : ['Gateway status command failed without textual output.'],
      writeTargets: [relativeOpenLabPath(ACTION_RUNS_ROOT)],
      evidence: compactStrings([
        'Command executed locally with a 15s timeout.',
        failure.signal ? `signal=${failure.signal}` : undefined,
        failure.killed ? 'process killed before normal exit' : undefined,
        typeof failure.code === 'string' ? `code=${failure.code}` : undefined,
      ]),
      command: {
        ...command,
        exitCode,
      },
    }
  }
}

function validateConfirmationToken(actionId: OperatorActionId, token: string) {
  const [tokenActionId, expiresAt, signature] = token.split('::')
  if (!tokenActionId || !expiresAt || !signature) {
    throw new Error('Invalid confirmation token')
  }
  if (tokenActionId !== actionId) {
    throw new Error('Confirmation token does not match action')
  }

  const payload = `${tokenActionId}::${expiresAt}`
  const expected = createHmac('sha256', CONFIRMATION_SECRET).update(payload).digest('hex')
  if (expected !== signature) {
    throw new Error('Confirmation token signature mismatch')
  }

  if (Date.parse(expiresAt) < Date.now()) {
    throw new Error('Confirmation token expired')
  }
}

async function ensureOperatorDirectories() {
  await mkdir(ACTION_RUNS_ROOT, { recursive: true })
  await mkdir(SNAPSHOT_ROOT, { recursive: true })
}

async function persistRunRecord(run: OperatorActionRunRecord) {
  await ensureOperatorDirectories()
  await writeFile(join(ACTION_RUNS_ROOT, `${run.runId}.json`), `${JSON.stringify(run, null, 2)}\n`, 'utf8')
}

function relativeOpenLabPath(path: string) {
  return path.replace(`${WORKSPACE_ROOT}/`, '')
}

function compactStrings(items: Array<string | undefined>) {
  return items.filter(Boolean) as string[]
}
