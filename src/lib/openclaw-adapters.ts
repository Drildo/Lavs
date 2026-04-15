import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { readFile, readdir, stat } from 'node:fs/promises'
import { basename, extname, join, relative } from 'node:path'

const execFileAsync = promisify(execFile)

export type OpenLabTaskStatus = 'backlog' | 'planned' | 'in_progress' | 'review' | 'done'
export type OpenLabTaskPriority = 'low' | 'medium' | 'high' | 'urgent'
export type OpenLabHealthStatus = 'healthy' | 'warning' | 'critical' | 'offline' | 'placeholder'
export type OpenLabEvidenceMode = 'live' | 'mixed' | 'manual'
export type OpenLabSourceKind = 'live' | 'real' | 'inferred' | 'placeholder'

export interface OpenLabTaskEvent {
  label: string
  value: string
  tone?: 'neutral' | 'good' | 'warn' | 'bad'
}

export interface OpenLabTask {
  id: string
  title: string
  team: string
  status: OpenLabTaskStatus
  priority: OpenLabTaskPriority
  owner?: string
  dueLabel?: string
  estimate?: string
  tags?: string[]
  source: 'openclaw-task-run' | 'coordination'
  summary?: string
  detail?: string
  sessionLabel?: string
  sessionKey?: string
  runId?: string
  runtime?: string
  createdAt?: string
  updatedAt?: string
  events?: OpenLabTaskEvent[]
}

export interface OpenLabCalendarItem {
  id: string
  title: string
  lane: string
  date: string
  time: string
  duration: string
  source: 'calendar' | 'cron' | 'task'
  system?: 'openclaw' | 'hermes'
  detail?: string
}

export interface OpenLabMetric {
  label: string
  value: string
}

export interface OpenLabMonitorCard {
  id: string
  title: string
  status: OpenLabHealthStatus
  summary: string
  detail: string
  metrics: OpenLabMetric[]
  evidence: string[]
  live: boolean
}

export interface OpenLabAlert {
  id: string
  title: string
  level: 'info' | 'warning' | 'critical'
  source: string
  timeLabel: string
  detail: string
  live: boolean
}

export interface OpenLabAgentCard {
  id: string
  name: string
  role: string
  team: string
  status: 'active' | 'monitoring' | 'idle' | 'attention' | 'manual'
  summary: string
  detail: string
  lastSeen?: string
  channel?: string
  evidenceMode: OpenLabEvidenceMode
  metrics: OpenLabMetric[]
}

export interface OpenLabProjectCard {
  id: string
  name: string
  lane: string
  summary: string
  detail: string
  sourceKind: OpenLabSourceKind
  status: 'active' | 'watching' | 'archived'
  updatedAt?: string
  updatedLabel: string
  evidence: string[]
  metrics: OpenLabMetric[]
  tags: string[]
}

export interface OpenLabMemoryCard {
  id: string
  title: string
  kind: 'memory-core' | 'daily-note' | 'incident' | 'vault-note'
  summary: string
  detail: string
  sourceKind: OpenLabSourceKind
  updatedAt?: string
  updatedLabel: string
  evidence: string[]
  tags: string[]
}

export interface OpenLabDocCard {
  id: string
  title: string
  section: string
  summary: string
  detail: string
  sourceKind: OpenLabSourceKind
  updatedAt?: string
  updatedLabel: string
  pathLabel: string
  evidence: string[]
  tags: string[]
}

export interface OpenLabOfficeFeedItem {
  id: string
  title: string
  detail: string
  timeLabel: string
  tone: 'neutral' | 'good' | 'warn' | 'bad'
  source: string
}

export interface OpenLabOfficeSeat {
  id: string
  label: string
  occupant: string
  status: 'active' | 'focus' | 'watching' | 'offline'
  detail: string
  evidence: string
}

export interface OpenLabOfficeZone {
  id: string
  name: string
  state: string
  summary: string
  metric: string
  tone: 'neutral' | 'good' | 'warn' | 'bad'
}

export interface OpenLabOfficeSnapshot {
  seats: OpenLabOfficeSeat[]
  zones: OpenLabOfficeZone[]
  feed: OpenLabOfficeFeedItem[]
  rituals: Array<{ label: string; value: string; detail: string }>
}

export interface OpenLabToolProposal {
  id: string
  name: string
  kind: 'panel' | 'operator-tool' | 'automation'
  readiness: 'ready' | 'candidate' | 'placeholder'
  summary: string
  operatorValue: string
  rationale: string
  recommendedInputs: string[]
  dataSources: string[]
  relatedSurfaces: string[]
  nextStep: string
}

export interface OpenLabToolBuilderSnapshot {
  proposals: OpenLabToolProposal[]
  activeWorkflow: {
    title: string
    summary: string
    signals: string[]
    surfaces: string[]
  }
}

export interface OpenLabSnapshot {
  tasks: OpenLabTask[]
  calendarItems: OpenLabCalendarItem[]
  adapters: {
    openClawTasks: { status: 'live' | 'partial' | 'placeholder'; detail: string }
    hermesSchedules: { status: 'live' | 'partial' | 'placeholder'; detail: string }
  }
  monitoring: OpenLabMonitorCard[]
  alerts: OpenLabAlert[]
  agents: OpenLabAgentCard[]
  projects: OpenLabProjectCard[]
  memories: OpenLabMemoryCard[]
  docs: OpenLabDocCard[]
  office: OpenLabOfficeSnapshot
  toolBuilder: OpenLabToolBuilderSnapshot
  generatedAt: string
}

type OpenClawTaskRunRow = {
  task_id: string
  runtime: string
  owner_key: string
  child_session_key: string | null
  agent_id: string | null
  run_id: string | null
  label: string | null
  task: string
  status: string
  delivery_status: string
  created_at: number
  started_at: number | null
  ended_at: number | null
  last_event_at: number | null
  progress_summary: string | null
  terminal_summary: string | null
  terminal_outcome: string | null
  requester_session_key: string | null
  task_kind: string | null
}

type SessionIndex = Record<string, {
  updatedAt?: number
  origin?: { label?: string; surface?: string }
  lastChannel?: string
  status?: string
}>

type CoordinationTask = {
  task_id: string
  title: string
  owner?: string
  status?: string
  priority?: string
  notes?: string
  next_action?: string
  updated_at?: string
}

type OpenClawCronJob = {
  id: string
  agentId?: string
  name: string
  enabled: boolean
  schedule?: { kind?: string; expr?: string; tz?: string }
  state?: { nextRunAtMs?: number; lastRunAtMs?: number; lastStatus?: string; consecutiveErrors?: number }
}

type HermesCronJob = {
  id: string
  name: string
  enabled: boolean
  state?: string
  schedule?: { kind?: string; minutes?: number; display?: string }
  schedule_display?: string
  next_run_at?: string
  last_run_at?: string
  last_status?: string
  paused_reason?: string | null
}

type GatewayStatus = {
  raw: string
  running: boolean
  rpcOk: boolean
  loopbackOnly: boolean
  port?: string
  pid?: string
  logFile?: string
}

type ChromeStatus = {
  reachable: boolean
  browser?: string
  protocolVersion?: string
  wsUrl?: string
  targetCount: number
  savedSessions: string[]
}

type MemoryStatus = {
  memoryExists: boolean
  vaultExists: boolean
  todaysMemoryExists: boolean
  memoryUpdatedAt?: number
  todayUpdatedAt?: number
  recentIncidentFiles: string[]
}

type MarkdownPreview = {
  path: string
  title: string
  summary: string
  detail: string
  tags: string[]
  updatedAt?: number
  exists: boolean
}

const WORKSPACE_ROOT = '/Users/openclaw/.openclaw/workspace'
const OPENCLAW_TASKS_DB = '/Users/openclaw/.openclaw/tasks/runs.sqlite'
const OPENCLAW_SESSIONS = '/Users/openclaw/.openclaw/agents/main/sessions/sessions.json'
const OPENCLAW_CRON = '/Users/openclaw/.openclaw/cron/jobs.json'
const HERMES_CRON = '/Users/openclaw/.hermes/cron/jobs.json'
const COORDINATION_TASKS = '/Users/openclaw/.openclaw/workspace/coordination/tasks.json'
const MEMORY_FILE = '/Users/openclaw/.openclaw/workspace/MEMORY.md'
const MEMORY_DIR = '/Users/openclaw/.openclaw/workspace/memory'
const INCIDENTS_DIR = '/Users/openclaw/.openclaw/workspace/memory/incidents'
const OBSIDIAN_VAULT = '/Users/openclaw/.openclaw/workspace/obsidian-vault'
const BROWSER_AUTOMATION_SESSIONS = '/Users/openclaw/.openclaw/workspace/skills/browser-automation/state/sessions'

export async function getOpenLabSnapshot(): Promise<OpenLabSnapshot> {
  const [taskRuns, sessionIndex, coordinationTasks, openClawCronJobs, hermesCronJobs, gatewayStatus, chromeStatus, memoryStatus, projects, memories, docs] = await Promise.all([
    readOpenClawTaskRuns(),
    readJson<SessionIndex>(OPENCLAW_SESSIONS, {}),
    readJson<{ tasks?: CoordinationTask[] }>(COORDINATION_TASKS, { tasks: [] }),
    readJson<{ jobs?: OpenClawCronJob[] }>(OPENCLAW_CRON, { jobs: [] }),
    readJson<{ jobs?: HermesCronJob[] }>(HERMES_CRON, { jobs: [] }),
    readGatewayStatus(),
    readChromeStatus(),
    readMemoryStatus(),
    buildProjectCards(),
    buildMemoryCards(),
    buildDocCards(),
  ])

  const liveTasks = buildLiveTasks(taskRuns, sessionIndex)
  const fallbackTasks = liveTasks.length === 0 ? buildCoordinationTasks(coordinationTasks.tasks ?? []) : []
  const tasks = liveTasks.length > 0 ? liveTasks : fallbackTasks
  const calendarItems = buildCalendarItems(openClawCronJobs.jobs ?? [], hermesCronJobs.jobs ?? [])
  const monitoring = buildMonitoringCards({
    gatewayStatus,
    chromeStatus,
    memoryStatus,
    openClawCronJobs: openClawCronJobs.jobs ?? [],
    hermesCronJobs: hermesCronJobs.jobs ?? [],
    taskRuns,
    sessionIndex,
  })
  const alerts = await buildAlerts(taskRuns, openClawCronJobs.jobs ?? [], hermesCronJobs.jobs ?? [])
  const agents = buildAgentCards({ taskRuns, sessionIndex, openClawCronJobs: openClawCronJobs.jobs ?? [], hermesCronJobs: hermesCronJobs.jobs ?? [], chromeStatus })
  const office = buildOfficeSnapshot({ tasks, calendarItems, monitoring, alerts, agents, projects, docs, memories })
  const toolBuilder = buildToolBuilderSnapshot({ tasks, calendarItems, projects, docs, memories, monitoring, office })

  return {
    tasks,
    calendarItems,
    adapters: {
      openClawTasks: {
        status: liveTasks.length > 0 ? 'live' : fallbackTasks.length > 0 ? 'partial' : 'placeholder',
        detail: liveTasks.length > 0
          ? `Live from ${OPENCLAW_TASKS_DB} and sessions.json`
          : fallbackTasks.length > 0
            ? 'Fell back to coordination/tasks.json because live task runs were unavailable'
            : 'No local task sources available yet',
      },
      hermesSchedules: {
        status: calendarItems.some((item) => item.system === 'hermes') ? 'live' : 'partial',
        detail: calendarItems.some((item) => item.system === 'hermes')
          ? 'Live from ~/.hermes/cron/jobs.json with OpenClaw cron merged in'
          : 'Only OpenClaw cron currently available',
      },
    },
    monitoring,
    alerts,
    agents,
    projects,
    memories,
    docs,
    office,
    toolBuilder,
    generatedAt: new Date().toISOString(),
  }
}

async function readOpenClawTaskRuns(): Promise<OpenClawTaskRunRow[]> {
  const sql = `
    select
      task_id,
      runtime,
      owner_key,
      child_session_key,
      agent_id,
      run_id,
      label,
      task,
      status,
      delivery_status,
      created_at,
      started_at,
      ended_at,
      last_event_at,
      progress_summary,
      terminal_summary,
      terminal_outcome,
      requester_session_key,
      task_kind
    from task_runs
    where runtime != 'cli'
    order by created_at desc
    limit 24;
  `

  try {
    const { stdout } = await execFileAsync('sqlite3', ['-json', OPENCLAW_TASKS_DB, sql])
    return JSON.parse(stdout || '[]') as OpenClawTaskRunRow[]
  } catch {
    return []
  }
}

async function readGatewayStatus(): Promise<GatewayStatus> {
  try {
    const { stdout } = await execFileAsync('openclaw', ['gateway', 'status'])
    return {
      raw: stdout,
      running: /Runtime:\s+running/i.test(stdout),
      rpcOk: /RPC probe:\s+ok/i.test(stdout),
      loopbackOnly: /Loopback-only gateway/i.test(stdout) || /bind=loopback/i.test(stdout),
      port: stdout.match(/port=(\d+)/i)?.[1] || stdout.match(/Listening:\s+[0-9.]+:(\d+)/i)?.[1],
      pid: stdout.match(/pid\s+(\d+)/i)?.[1],
      logFile: stdout.match(/File logs:\s+(.+)/)?.[1]?.trim(),
    }
  } catch (error) {
    return {
      raw: error instanceof Error ? error.message : 'gateway status unavailable',
      running: false,
      rpcOk: false,
      loopbackOnly: false,
    }
  }
}

async function readChromeStatus(): Promise<ChromeStatus> {
  const savedSessions = await readDirectoryFilenames(BROWSER_AUTOMATION_SESSIONS)

  try {
    const versionRes = await fetch('http://127.0.0.1:9222/json/version', { cache: 'no-store' })
    if (!versionRes.ok) {
      return { reachable: false, targetCount: 0, savedSessions }
    }

    const versionJson = await versionRes.json() as Record<string, string>
    let targetCount = 0

    try {
      const targetsRes = await fetch('http://127.0.0.1:9222/json/list', { cache: 'no-store' })
      if (targetsRes.ok) {
        const targets = await targetsRes.json() as Array<Record<string, unknown>>
        targetCount = Array.isArray(targets) ? targets.length : 0
      }
    } catch {
      targetCount = 0
    }

    return {
      reachable: true,
      browser: versionJson.Browser,
      protocolVersion: versionJson['Protocol-Version'],
      wsUrl: versionJson.webSocketDebuggerUrl,
      targetCount,
      savedSessions,
    }
  } catch {
    return { reachable: false, targetCount: 0, savedSessions }
  }
}

async function readMemoryStatus(): Promise<MemoryStatus> {
  const today = new Date().toISOString().slice(0, 10)
  const todayPath = `${MEMORY_DIR}/${today}.md`
  const [memoryStats, vaultStats, todayStats, incidentFiles] = await Promise.all([
    safeStat(MEMORY_FILE),
    safeStat(OBSIDIAN_VAULT),
    safeStat(todayPath),
    readDirectoryFilenames(INCIDENTS_DIR),
  ])

  return {
    memoryExists: Boolean(memoryStats),
    vaultExists: Boolean(vaultStats?.isDirectory()),
    todaysMemoryExists: Boolean(todayStats),
    memoryUpdatedAt: memoryStats?.mtimeMs,
    todayUpdatedAt: todayStats?.mtimeMs,
    recentIncidentFiles: incidentFiles.sort().slice(-4),
  }
}

async function buildProjectCards(): Promise<OpenLabProjectCard[]> {
  const candidates = [
    { name: 'OpenLab', lane: 'Workspace', files: [join(WORKSPACE_ROOT, 'openlab', 'package.json'), join(WORKSPACE_ROOT, 'openlab', 'src', 'components', 'openlab', 'openlab-app-shell.tsx')], preview: join(WORKSPACE_ROOT, 'openlab', 'src', 'app', 'page.tsx') },
    { name: 'Dating Pack Project', lane: 'Revenue', files: [join(WORKSPACE_ROOT, 'dating-pack-project', 'SESSION_LOG.md'), join(WORKSPACE_ROOT, 'dating-pack-project', 'README.md')], preview: join(WORKSPACE_ROOT, 'dating-pack-project', 'BRIEFING.md') },
    { name: 'Sugardaddy BG', lane: 'Primary business', files: [join(WORKSPACE_ROOT, 'sugardaddy.bg', 'SESSION_LOG.md'), join(WORKSPACE_ROOT, 'sugardaddy.bg', 'README.md')], preview: join(WORKSPACE_ROOT, 'sugardaddy.bg', 'README.md') },
    { name: 'Yonic Studios', lane: 'Commission', files: [join(WORKSPACE_ROOT, 'projects', 'yonic-studios', 'SESSION_LOG.md'), join(WORKSPACE_ROOT, 'obsidian-vault', 'projects', 'yonic-studios.md')], preview: join(WORKSPACE_ROOT, 'projects', 'yonic-studios', 'SESSION_LOG.md') },
    { name: 'Prediction Market Bot', lane: 'Experiment', files: [join(WORKSPACE_ROOT, 'obsidian-vault', 'projects', 'prediction-market-bot', 'README.md'), join(WORKSPACE_ROOT, 'obsidian-vault', 'projects', 'prediction-market-bot', 'architecture.md')], preview: join(WORKSPACE_ROOT, 'obsidian-vault', 'projects', 'prediction-market-bot', 'README.md') },
  ]

  const cards = await Promise.all(candidates.map(async (candidate) => {
    const existingFiles = await filterExistingPaths(candidate.files)
    const preview = await readMarkdownPreview(candidate.preview)
    const updatedAt = Math.max(preview.updatedAt ?? 0, ...(await Promise.all(existingFiles.map(async (file) => (await safeStat(file))?.mtimeMs ?? 0)))) || undefined
    const sourceKind: OpenLabSourceKind = existingFiles.length > 0 ? 'real' : 'placeholder'
    const status = determineProjectStatus(candidate.name, preview.summary)

    return {
      id: slugify(candidate.name),
      name: candidate.name,
      lane: candidate.lane,
      summary: preview.summary,
      detail: preview.detail,
      sourceKind,
      status,
      updatedAt: updatedAt ? new Date(updatedAt).toISOString() : undefined,
      updatedLabel: formatRelative(updatedAt),
      evidence: existingFiles.length > 0 ? existingFiles.map(toWorkspacePath) : [toWorkspacePath(candidate.preview)],
      metrics: compactMetrics([
        { label: 'Evidence files', value: String(existingFiles.length) },
        { label: 'Last update', value: formatRelative(updatedAt) },
        { label: 'Source', value: sourceKind },
      ]),
      tags: compact([candidate.lane.toLowerCase(), ...preview.tags.slice(0, 3)]),
    } satisfies OpenLabProjectCard
  }))

  return cards.sort(sortByUpdatedLabel)
}

async function buildMemoryCards(): Promise<OpenLabMemoryCard[]> {
  const memoryFiles = [
    MEMORY_FILE,
    join(MEMORY_DIR, `${new Date().toISOString().slice(0, 10)}.md`),
    join(MEMORY_DIR, '2026-04-14.md'),
    join(INCIDENTS_DIR, '2026-04-13.md'),
    join(OBSIDIAN_VAULT, 'open-loops', '_index.md'),
    join(OBSIDIAN_VAULT, '2026-04-15.md'),
  ]

  const cards = await Promise.all(memoryFiles.map(async (file) => {
    const preview = await readMarkdownPreview(file)
    const relPath = toWorkspacePath(file)
    const kind = inferMemoryKind(file)
    return {
      id: slugify(relPath),
      title: preview.title,
      kind,
      summary: preview.summary,
      detail: preview.detail,
      sourceKind: preview.exists ? 'real' : 'placeholder',
      updatedAt: preview.updatedAt ? new Date(preview.updatedAt).toISOString() : undefined,
      updatedLabel: formatRelative(preview.updatedAt),
      evidence: [relPath],
      tags: compact([kind, ...preview.tags.slice(0, 3)]),
    } satisfies OpenLabMemoryCard
  }))

  return cards.filter((card, index, array) => array.findIndex((item) => item.id === card.id) === index).sort(sortByUpdatedLabel)
}

async function buildDocCards(): Promise<OpenLabDocCard[]> {
  const docFiles = [
    join(WORKSPACE_ROOT, 'docs', 'hermes-qa-canonicalization-runbook.md'),
    join(WORKSPACE_ROOT, 'docs', 'provider-route-drift-guard-runbook.md'),
    join(WORKSPACE_ROOT, 'SYSTEM_OVERVIEW.md'),
    join(WORKSPACE_ROOT, 'OPERATOR_CHEATSHEET.md'),
    join(OBSIDIAN_VAULT, 'Reference', 'operator-handbook.md'),
    join(OBSIDIAN_VAULT, 'Reference', 'runtime-recovery-runbook.md'),
    join(OBSIDIAN_VAULT, 'reports', '2026-04-12-deep-system-audit.md'),
    join(OBSIDIAN_VAULT, 'reports', '2026-04-11-phase-1-foundation-audit.md'),
  ]

  const cards = await Promise.all(docFiles.map(async (file) => {
    const preview = await readMarkdownPreview(file)
    const relPath = toWorkspacePath(file)
    return {
      id: slugify(relPath),
      title: preview.title,
      section: inferDocSection(file),
      summary: preview.summary,
      detail: preview.detail,
      sourceKind: preview.exists ? 'real' : 'placeholder',
      updatedAt: preview.updatedAt ? new Date(preview.updatedAt).toISOString() : undefined,
      updatedLabel: formatRelative(preview.updatedAt),
      pathLabel: relPath,
      evidence: [relPath],
      tags: compact([inferDocSection(file).toLowerCase(), ...preview.tags.slice(0, 3)]),
    } satisfies OpenLabDocCard
  }))

  return cards.filter((card) => card.sourceKind !== 'placeholder').sort(sortByUpdatedLabel)
}

function buildLiveTasks(rows: OpenClawTaskRunRow[], sessions: SessionIndex): OpenLabTask[] {
  return rows.map((row) => {
    const session = (row.child_session_key ? sessions[row.child_session_key] : undefined) ?? (row.requester_session_key ? sessions[row.requester_session_key] : undefined)
    const status = mapRunStatus(row.status)
    const title = row.label || summarizeTaskText(row.task)
    const summary = row.progress_summary || row.terminal_summary || summarizeTaskText(row.task)
    const detail = row.task
    const updatedMs = row.last_event_at ?? row.ended_at ?? row.started_at ?? row.created_at
    const createdIso = toIso(row.created_at)
    const updatedIso = toIso(updatedMs)
    const timeLabel = formatRelative(updatedMs)

    return {
      id: row.task_id.slice(0, 8).toUpperCase(),
      title,
      team: inferTeam(row, session?.lastChannel),
      status,
      priority: inferPriority(row.status, row.runtime, row.delivery_status),
      owner: prettifyOwner(row.owner_key, session?.origin?.label),
      dueLabel: timeLabel,
      estimate: row.runtime,
      tags: compact([
        row.runtime,
        row.delivery_status !== 'not_applicable' ? row.delivery_status : undefined,
        session?.lastChannel,
      ]),
      source: 'openclaw-task-run',
      summary,
      detail,
      sessionLabel: session?.origin?.label,
      sessionKey: row.child_session_key ?? row.requester_session_key ?? undefined,
      runId: row.run_id ?? undefined,
      runtime: row.runtime,
      createdAt: createdIso,
      updatedAt: updatedIso,
      events: compactEvents([
        { label: 'Status', value: row.status, tone: statusTone(row.status) },
        updatedIso ? { label: 'Updated', value: updatedIso } : null,
        row.started_at ? { label: 'Started', value: toIso(row.started_at)! } : null,
        row.ended_at ? { label: 'Ended', value: toIso(row.ended_at)! } : null,
        row.terminal_outcome ? { label: 'Outcome', value: row.terminal_outcome } : null,
        row.run_id ? { label: 'Run ID', value: row.run_id } : null,
        row.child_session_key ? { label: 'Session', value: row.child_session_key } : null,
      ]),
    }
  })
}

function buildCoordinationTasks(tasks: CoordinationTask[]): OpenLabTask[] {
  return tasks.slice(0, 12).map((task) => ({
    id: task.task_id,
    title: task.title,
    team: 'Coordination',
    status: mapCoordinationStatus(task.status),
    priority: mapCoordinationPriority(task.priority),
    owner: task.owner,
    dueLabel: task.updated_at ? formatRelative(Date.parse(task.updated_at)) : 'No recent update',
    tags: ['coordination'],
    source: 'coordination',
    summary: task.notes,
    detail: task.next_action,
    updatedAt: task.updated_at,
    events: compactEvents([
      task.status ? { label: 'Status', value: task.status } : null,
      task.priority ? { label: 'Priority', value: task.priority } : null,
      task.updated_at ? { label: 'Updated', value: task.updated_at } : null,
    ]),
  }))
}

function buildCalendarItems(openClawJobs: OpenClawCronJob[], hermesJobs: HermesCronJob[]): OpenLabCalendarItem[] {
  const openClawItems = openClawJobs
    .filter((job) => job.enabled && job.state?.nextRunAtMs)
    .map((job) => fromDateLike({
      id: `oc-${job.id}`,
      title: job.name,
      lane: 'OpenClaw',
      source: 'cron' as const,
      system: 'openclaw' as const,
      dateLike: job.state?.nextRunAtMs,
      duration: inferDuration(job.schedule?.kind, job.schedule?.expr),
      detail: [job.schedule?.expr, job.schedule?.tz, job.state?.lastStatus].filter(Boolean).join(' • '),
    }))

  const hermesItems = hermesJobs
    .filter((job) => job.enabled && job.next_run_at)
    .map((job) => fromDateLike({
      id: `hm-${job.id}`,
      title: job.name,
      lane: 'Hermes',
      source: 'cron' as const,
      system: 'hermes' as const,
      dateLike: job.next_run_at,
      duration: inferHermesDuration(job.schedule?.minutes, job.schedule_display),
      detail: [job.schedule_display, job.last_status].filter(Boolean).join(' • '),
    }))

  return [...openClawItems, ...hermesItems]
    .filter((item): item is OpenLabCalendarItem => Boolean(item))
    .sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`))
    .slice(0, 12)
}

function buildMonitoringCards(input: {
  gatewayStatus: GatewayStatus
  chromeStatus: ChromeStatus
  memoryStatus: MemoryStatus
  openClawCronJobs: OpenClawCronJob[]
  hermesCronJobs: HermesCronJob[]
  taskRuns: OpenClawTaskRunRow[]
  sessionIndex: SessionIndex
}): OpenLabMonitorCard[] {
  const runningTasks = input.taskRuns.filter((row) => row.status === 'running').length
  const failedTasks = input.taskRuns.filter((row) => row.status === 'failed' || row.status === 'timed_out').length
  const enabledOpenClawCron = input.openClawCronJobs.filter((job) => job.enabled)
  const enabledHermesCron = input.hermesCronJobs.filter((job) => job.enabled)
  const cronFailures = enabledOpenClawCron.filter((job) => job.state?.lastStatus && job.state.lastStatus !== 'ok').length + enabledHermesCron.filter((job) => job.last_status && job.last_status !== 'ok').length
  const latestSessionUpdate = Math.max(...Object.values(input.sessionIndex).map((session) => session.updatedAt ?? 0), 0)

  return [
    {
      id: 'gateway',
      title: 'Gateway',
      status: input.gatewayStatus.running && input.gatewayStatus.rpcOk ? 'healthy' : input.gatewayStatus.running ? 'warning' : 'offline',
      summary: input.gatewayStatus.running && input.gatewayStatus.rpcOk
        ? 'OpenClaw gateway is running and answering RPC probes.'
        : input.gatewayStatus.running
          ? 'Gateway process is up, but the RPC probe is not fully healthy.'
          : 'Gateway status could not be confirmed.',
      detail: input.gatewayStatus.running
        ? `${input.gatewayStatus.loopbackOnly ? 'Loopback-only' : 'Bound'} gateway on port ${input.gatewayStatus.port ?? 'unknown'} with latest session activity ${formatRelative(latestSessionUpdate)}.`
        : input.gatewayStatus.raw,
      metrics: compactMetrics([
        { label: 'Runtime', value: input.gatewayStatus.running ? 'running' : 'offline' },
        { label: 'RPC', value: input.gatewayStatus.rpcOk ? 'ok' : 'degraded' },
        input.gatewayStatus.port ? { label: 'Port', value: input.gatewayStatus.port } : null,
        input.gatewayStatus.pid ? { label: 'PID', value: input.gatewayStatus.pid } : null,
      ]),
      evidence: compact([
        'openclaw gateway status',
        input.gatewayStatus.logFile ? basename(input.gatewayStatus.logFile) : undefined,
      ]),
      live: input.gatewayStatus.running,
    },
    {
      id: 'memory',
      title: 'Memory',
      status: input.memoryStatus.memoryExists && input.memoryStatus.vaultExists ? 'healthy' : input.memoryStatus.memoryExists || input.memoryStatus.vaultExists ? 'warning' : 'offline',
      summary: input.memoryStatus.memoryExists && input.memoryStatus.vaultExists
        ? 'Workspace memory and Obsidian vault are both mounted locally.'
        : 'One or more local memory surfaces are missing.',
      detail: `${input.memoryStatus.todaysMemoryExists ? `Today note updated ${formatRelative(input.memoryStatus.todayUpdatedAt)}.` : 'Today note missing.'} ${input.memoryStatus.recentIncidentFiles.length} incident file(s) on record.`,
      metrics: compactMetrics([
        { label: 'MEMORY.md', value: input.memoryStatus.memoryExists ? formatRelative(input.memoryStatus.memoryUpdatedAt) : 'missing' },
        { label: 'Today', value: input.memoryStatus.todaysMemoryExists ? 'present' : 'missing' },
        { label: 'Vault', value: input.memoryStatus.vaultExists ? 'mounted' : 'missing' },
        { label: 'Incidents', value: String(input.memoryStatus.recentIncidentFiles.length) },
      ]),
      evidence: [MEMORY_FILE, OBSIDIAN_VAULT, INCIDENTS_DIR],
      live: input.memoryStatus.memoryExists || input.memoryStatus.vaultExists,
    },
    {
      id: 'chrome',
      title: 'Chrome / CDP',
      status: input.chromeStatus.reachable ? 'healthy' : input.chromeStatus.savedSessions.length > 0 ? 'warning' : 'offline',
      summary: input.chromeStatus.reachable
        ? 'Chrome DevTools is reachable on localhost:9222.'
        : 'Chrome DevTools did not answer, but local browser automation state exists.',
      detail: input.chromeStatus.reachable
        ? `${input.chromeStatus.targetCount} active target(s) exposed. Browser automation has ${input.chromeStatus.savedSessions.length} saved session profile(s).`
        : `${input.chromeStatus.savedSessions.length} saved session profile(s) were found under browser automation state.`,
      metrics: compactMetrics([
        { label: 'CDP', value: input.chromeStatus.reachable ? 'reachable' : 'offline' },
        input.chromeStatus.protocolVersion ? { label: 'Protocol', value: input.chromeStatus.protocolVersion } : null,
        { label: 'Targets', value: String(input.chromeStatus.targetCount) },
        { label: 'Saved sessions', value: String(input.chromeStatus.savedSessions.length) },
      ]),
      evidence: compact([
        'http://127.0.0.1:9222/json/version',
        input.chromeStatus.browser,
        ...input.chromeStatus.savedSessions.slice(0, 3),
      ]),
      live: input.chromeStatus.reachable,
    },
    {
      id: 'hermes',
      title: 'Hermes',
      status: enabledHermesCron.length > 0
        ? enabledHermesCron.some((job) => job.last_status && job.last_status !== 'ok') ? 'warning' : 'healthy'
        : input.hermesCronJobs.length > 0 ? 'placeholder' : 'offline',
      summary: enabledHermesCron.length > 0
        ? `${enabledHermesCron.length} Hermes job(s) enabled, including QA review coverage.`
        : input.hermesCronJobs.length > 0
          ? 'Hermes config exists but no enabled jobs were found.'
          : 'Hermes cron file not found.',
      detail: enabledHermesCron[0]
        ? `${enabledHermesCron[0].name} next runs ${formatDateTime(enabledHermesCron[0].next_run_at)}.`
        : input.hermesCronJobs[0]?.paused_reason || 'No enabled Hermes schedules available.',
      metrics: compactMetrics([
        { label: 'Jobs', value: String(input.hermesCronJobs.length) },
        { label: 'Enabled', value: String(enabledHermesCron.length) },
        { label: 'Healthy', value: String(enabledHermesCron.filter((job) => (job.last_status ?? 'ok') === 'ok').length) },
      ]),
      evidence: [HERMES_CRON],
      live: enabledHermesCron.length > 0,
    },
    {
      id: 'cron',
      title: 'Cron',
      status: cronFailures > 0 ? 'warning' : enabledOpenClawCron.length + enabledHermesCron.length > 0 ? 'healthy' : 'placeholder',
      summary: `${enabledOpenClawCron.length} OpenClaw job(s) and ${enabledHermesCron.length} Hermes job(s) are enabled locally.`,
      detail: cronFailures > 0
        ? `${cronFailures} schedule(s) show a non-ok last status and need review.`
        : 'Recent schedule state is clean based on local job files.',
      metrics: compactMetrics([
        { label: 'Enabled', value: String(enabledOpenClawCron.length + enabledHermesCron.length) },
        { label: 'Failures', value: String(cronFailures) },
        { label: 'Running tasks', value: String(runningTasks) },
        { label: 'Recent task failures', value: String(failedTasks) },
      ]),
      evidence: [OPENCLAW_CRON, HERMES_CRON],
      live: enabledOpenClawCron.length + enabledHermesCron.length > 0,
    },
  ]
}

async function buildAlerts(taskRuns: OpenClawTaskRunRow[], openClawCronJobs: OpenClawCronJob[], hermesCronJobs: HermesCronJob[]): Promise<OpenLabAlert[]> {
  const taskAlerts = taskRuns
    .filter((row) => row.status === 'failed' || row.status === 'timed_out' || row.status === 'running')
    .slice(0, 5)
    .map((row) => ({
      id: `task-${row.task_id}`,
      title: row.status === 'running' ? 'Active subagent run' : `Task run ${row.status}`,
      level: row.status === 'running' ? 'info' as const : 'warning' as const,
      source: row.runtime,
      timeLabel: formatRelative(row.last_event_at ?? row.created_at),
      detail: summarizeTaskText(row.progress_summary || row.terminal_summary || row.task),
      live: true,
    }))

  const cronAlerts = [
    ...openClawCronJobs
      .filter((job) => job.enabled && job.state?.lastStatus && job.state.lastStatus !== 'ok')
      .map((job) => ({
        id: `oc-${job.id}`,
        title: 'OpenClaw cron warning',
        level: 'warning' as const,
        source: 'openclaw cron',
        timeLabel: formatRelative(job.state?.lastRunAtMs),
        detail: `${job.name} last status: ${job.state?.lastStatus}`,
        live: true,
      })),
    ...hermesCronJobs
      .filter((job) => job.enabled && job.last_status && job.last_status !== 'ok')
      .map((job) => ({
        id: `hm-${job.id}`,
        title: 'Hermes cron warning',
        level: 'warning' as const,
        source: 'hermes cron',
        timeLabel: formatRelative(job.last_run_at ? Date.parse(job.last_run_at) : undefined),
        detail: `${job.name} last status: ${job.last_status}`,
        live: true,
      })),
  ]

  const incidentAlerts = await readIncidentAlerts()

  return [...taskAlerts, ...cronAlerts, ...incidentAlerts]
    .sort((a, b) => rankAlertLevel(b.level) - rankAlertLevel(a.level))
    .slice(0, 8)
}

function buildAgentCards(input: {
  taskRuns: OpenClawTaskRunRow[]
  sessionIndex: SessionIndex
  openClawCronJobs: OpenClawCronJob[]
  hermesCronJobs: HermesCronJob[]
  chromeStatus: ChromeStatus
}): OpenLabAgentCard[] {
  const mainSession = input.sessionIndex['agent:main:main']
  const runningSubagents = input.taskRuns.filter((row) => row.runtime === 'subagent' && row.status === 'running')
  const recentSubagentFailures = input.taskRuns.filter((row) => row.runtime === 'subagent' && (row.status === 'failed' || row.status === 'timed_out')).length
  const enabledHermes = input.hermesCronJobs.filter((job) => job.enabled)
  const enabledOpenClawCron = input.openClawCronJobs.filter((job) => job.enabled)
  const liveDiscordSessions = Object.entries(input.sessionIndex).filter(([key, session]) => key.includes(':discord:') && (Date.now() - (session.updatedAt ?? 0)) < 1000 * 60 * 60 * 24)

  return [
    {
      id: 'saemord',
      name: 'Saemord',
      role: 'Operator brain',
      team: 'OpenClaw',
      status: runningSubagents.length > 0 ? 'active' : 'idle',
      summary: runningSubagents.length > 0 ? 'Main operator has active delegated work in flight.' : 'Main operator session is idle between runs.',
      detail: mainSession?.origin?.label ? `Latest origin: ${mainSession.origin.label}.` : 'Main session metadata available from sessions.json.',
      lastSeen: formatRelative(mainSession?.updatedAt),
      channel: mainSession?.lastChannel,
      evidenceMode: 'live',
      metrics: compactMetrics([
        { label: 'Last seen', value: formatRelative(mainSession?.updatedAt) },
        { label: 'Running workers', value: String(runningSubagents.length) },
        { label: 'Discord threads', value: String(liveDiscordSessions.length) },
      ]),
    },
    {
      id: 'subagents',
      name: 'Execution workers',
      role: 'Local implementation and research workers',
      team: 'Execution',
      status: runningSubagents.length > 0 ? 'active' : recentSubagentFailures > 0 ? 'attention' : 'monitoring',
      summary: runningSubagents.length > 0 ? `${runningSubagents.length} subagent run(s) are active.` : 'No subagent currently running.',
      detail: recentSubagentFailures > 0 ? `${recentSubagentFailures} recent subagent failure or timeout event(s) detected in task_runs.` : 'Recent task_runs show clean subagent execution.',
      lastSeen: formatRelative(runningSubagents[0]?.last_event_at ?? input.taskRuns[0]?.last_event_at),
      evidenceMode: 'live',
      metrics: compactMetrics([
        { label: 'Running', value: String(runningSubagents.length) },
        { label: 'Recent failures', value: String(recentSubagentFailures) },
        { label: 'Tracked runs', value: String(input.taskRuns.filter((row) => row.runtime === 'subagent').length) },
      ]),
    },
    {
      id: 'hermes-qa',
      name: 'Hermes QA',
      role: 'Review and monitoring layer',
      team: 'Hermes',
      status: enabledHermes.length > 0 ? ((enabledHermes[0].last_status ?? 'ok') === 'ok' ? 'monitoring' : 'attention') : 'idle',
      summary: enabledHermes.length > 0 ? `${enabledHermes[0].name} is the active Hermes monitor.` : 'Hermes jobs are configured but not currently enabled.',
      detail: enabledHermes[0]?.next_run_at ? `Next run ${formatDateTime(enabledHermes[0].next_run_at)}.` : input.hermesCronJobs[0]?.paused_reason || 'No next Hermes run scheduled.',
      lastSeen: formatRelative(enabledHermes[0]?.last_run_at ? Date.parse(enabledHermes[0].last_run_at) : undefined),
      evidenceMode: enabledHermes.length > 0 ? 'live' : 'mixed',
      metrics: compactMetrics([
        { label: 'Enabled jobs', value: String(enabledHermes.length) },
        { label: 'Last status', value: enabledHermes[0]?.last_status ?? 'n/a' },
        enabledHermes[0]?.schedule_display ? { label: 'Schedule', value: enabledHermes[0].schedule_display } : null,
      ]),
    },
    {
      id: 'cron-runners',
      name: 'Cron runners',
      role: 'Scheduled automation surfaces',
      team: 'Automation',
      status: enabledOpenClawCron.length > 0 ? 'monitoring' : 'idle',
      summary: enabledOpenClawCron.length > 0 ? `${enabledOpenClawCron.length} OpenClaw scheduled job(s) are enabled.` : 'No OpenClaw schedules are enabled.',
      detail: enabledOpenClawCron[0]?.state?.nextRunAtMs ? `${enabledOpenClawCron[0].name} next runs ${formatDateTime(enabledOpenClawCron[0].state?.nextRunAtMs)}.` : 'No next scheduled OpenClaw run available.',
      lastSeen: formatRelative(enabledOpenClawCron[0]?.state?.lastRunAtMs),
      evidenceMode: enabledOpenClawCron.length > 0 ? 'live' : 'mixed',
      metrics: compactMetrics([
        { label: 'Enabled', value: String(enabledOpenClawCron.length) },
        { label: 'Total jobs', value: String(input.openClawCronJobs.length) },
        { label: 'Healthy', value: String(enabledOpenClawCron.filter((job) => (job.state?.lastStatus ?? 'ok') === 'ok').length) },
      ]),
    },
    {
      id: 'warmtea',
      name: 'WarmTea',
      role: 'Human operator and decision maker',
      team: 'Operator',
      status: 'manual',
      summary: 'Human status is not directly instrumented in OpenLab.',
      detail: 'Shown as a reference actor only. Presence, focus, and availability stay manual unless a dedicated local signal is added later.',
      evidenceMode: 'manual',
      channel: 'telegram / discord',
      metrics: compactMetrics([
        { label: 'Signals', value: 'manual only' },
        { label: 'Default channels', value: 'Telegram, Discord' },
        { label: 'Browser profile', value: input.chromeStatus.savedSessions.length > 0 ? 'Automation present' : 'not checked' },
      ]),
    },
  ]
}

function buildOfficeSnapshot(input: {
  tasks: OpenLabTask[]
  calendarItems: OpenLabCalendarItem[]
  monitoring: OpenLabMonitorCard[]
  alerts: OpenLabAlert[]
  agents: OpenLabAgentCard[]
  projects: OpenLabProjectCard[]
  docs: OpenLabDocCard[]
  memories: OpenLabMemoryCard[]
}): OpenLabOfficeSnapshot {
  const activeTask = input.tasks.find((task) => task.status === 'in_progress')
  const nextCalendar = input.calendarItems[0]
  const attentionAlert = input.alerts.find((alert) => alert.level !== 'info')
  const activeProject = input.projects.find((project) => project.status === 'active')
  const freshDoc = input.docs[0]
  const freshMemory = input.memories[0]

  return {
    seats: [
      {
        id: 'brain',
        label: 'Operator desk',
        occupant: input.agents[0]?.name ?? 'Saemord',
        status: input.agents[0]?.status === 'active' ? 'active' : 'watching',
        detail: activeTask ? activeTask.title : input.agents[0]?.summary ?? 'Waiting for the next run.',
        evidence: activeTask?.id ?? input.agents[0]?.role ?? 'OpenClaw',
      },
      {
        id: 'workers',
        label: 'Worker bench',
        occupant: input.agents[1]?.name ?? 'Execution workers',
        status: input.agents[1]?.status === 'active' ? 'focus' : input.agents[1]?.status === 'attention' ? 'watching' : 'offline',
        detail: input.agents[1]?.summary ?? 'No worker activity detected.',
        evidence: `${input.tasks.filter((task) => task.runtime === 'subagent').length} tracked worker runs`,
      },
      {
        id: 'review',
        label: 'Review rail',
        occupant: input.agents[2]?.name ?? 'Hermes QA',
        status: input.monitoring.find((card) => card.id === 'hermes')?.status === 'healthy' ? 'watching' : 'offline',
        detail: nextCalendar?.title ? `Next review: ${nextCalendar.title}` : input.agents[2]?.summary ?? 'No review window set.',
        evidence: nextCalendar?.time ?? input.agents[2]?.role ?? 'Hermes',
      },
      {
        id: 'operator',
        label: 'Human line',
        occupant: 'WarmTea',
        status: attentionAlert ? 'watching' : 'focus',
        detail: attentionAlert ? attentionAlert.title : 'No urgent blocker surfaced in local telemetry.',
        evidence: attentionAlert?.source ?? 'manual',
      },
    ],
    zones: [
      {
        id: 'runtime',
        name: 'Runtime',
        state: input.monitoring.find((card) => card.id === 'gateway')?.status ?? 'offline',
        summary: input.monitoring.find((card) => card.id === 'gateway')?.summary ?? 'No gateway state.',
        metric: `${input.tasks.filter((task) => task.status === 'in_progress').length} active task(s)`,
        tone: mapHealthTone(input.monitoring.find((card) => card.id === 'gateway')?.status),
      },
      {
        id: 'schedule',
        name: 'Schedule',
        state: nextCalendar ? `${nextCalendar.time} next` : 'quiet',
        summary: nextCalendar?.title ?? 'No upcoming scheduled block.',
        metric: `${input.calendarItems.length} scheduled block(s)`,
        tone: nextCalendar ? 'good' : 'neutral',
      },
      {
        id: 'knowledge',
        name: 'Knowledge',
        state: freshMemory ? freshMemory.updatedLabel : 'stale',
        summary: freshMemory?.title ?? 'Memory index unavailable.',
        metric: `${input.memories.filter((item) => item.sourceKind === 'real').length} live notes`,
        tone: freshMemory ? 'good' : 'warn',
      },
      {
        id: 'projects',
        name: 'Projects',
        state: activeProject?.name ?? 'No active project',
        summary: activeProject?.summary ?? 'No active project card available.',
        metric: `${input.projects.filter((item) => item.status === 'active').length} active lane(s)`,
        tone: activeProject ? 'good' : 'neutral',
      },
    ],
    feed: compact([
      activeTask ? {
        id: `office-task-${activeTask.id}`,
        title: activeTask.title,
        detail: activeTask.summary ?? 'Task in progress.',
        timeLabel: activeTask.dueLabel ?? 'live',
        tone: 'warn' as const,
        source: activeTask.team,
      } : null,
      nextCalendar ? {
        id: `office-cal-${nextCalendar.id}`,
        title: nextCalendar.title,
        detail: `${nextCalendar.lane} · ${nextCalendar.duration}`,
        timeLabel: `${nextCalendar.time}`,
        tone: 'good' as const,
        source: nextCalendar.system ?? nextCalendar.source,
      } : null,
      attentionAlert ? {
        id: `office-alert-${attentionAlert.id}`,
        title: attentionAlert.title,
        detail: attentionAlert.detail,
        timeLabel: attentionAlert.timeLabel,
        tone: attentionAlert.level === 'critical' ? 'bad' as const : 'warn' as const,
        source: attentionAlert.source,
      } : null,
      freshDoc ? {
        id: `office-doc-${freshDoc.id}`,
        title: freshDoc.title,
        detail: freshDoc.summary,
        timeLabel: freshDoc.updatedLabel,
        tone: 'neutral' as const,
        source: freshDoc.section,
      } : null,
    ]).slice(0, 4),
    rituals: [
      {
        label: 'Focus lane',
        value: activeTask?.team ?? 'OpenLab',
        detail: activeTask?.title ?? 'No active task right now.',
      },
      {
        label: 'Next checkpoint',
        value: nextCalendar ? `${nextCalendar.time}` : 'Unscheduled',
        detail: nextCalendar?.title ?? 'No upcoming cron block.',
      },
      {
        label: 'Latest note',
        value: freshMemory?.updatedLabel ?? 'Missing',
        detail: freshMemory?.title ?? 'Memory note unavailable.',
      },
    ],
  }
}

function buildToolBuilderSnapshot(input: {
  tasks: OpenLabTask[]
  calendarItems: OpenLabCalendarItem[]
  projects: OpenLabProjectCard[]
  docs: OpenLabDocCard[]
  memories: OpenLabMemoryCard[]
  monitoring: OpenLabMonitorCard[]
  office: OpenLabOfficeSnapshot
}): OpenLabToolBuilderSnapshot {
  const activeWorkflow = {
    title: inferActiveWorkflowTitle(input.tasks, input.projects),
    summary: inferWorkflowSummary(input.tasks, input.calendarItems, input.monitoring),
    signals: compact([
      input.tasks[0] ? `${input.tasks[0].status.replace('_', ' ')} task: ${input.tasks[0].title}` : null,
      input.calendarItems[0] ? `Next schedule: ${input.calendarItems[0].title} at ${input.calendarItems[0].time}` : null,
      input.office.feed[0] ? `Office feed: ${input.office.feed[0].title}` : null,
    ]),
    surfaces: ['Pulse', 'Board', 'Calendar', 'Office'],
  }

  return {
    activeWorkflow,
    proposals: [
      {
        id: 'runtime-triage-panel',
        name: 'Runtime Triage Panel',
        kind: 'panel',
        readiness: 'ready',
        summary: 'A compact operator surface that merges failing alerts, active tasks, and the next review windows into a single decision panel.',
        operatorValue: 'Cuts the context-switch loop when something slips between Pulse, Board, and Calendar.',
        rationale: 'OpenLab already has live task runs, alerts, and cron state. The missing piece is a single triage view with sharper operator ordering.',
        recommendedInputs: ['Failing task runs', 'Recent alert notes', 'Next cron windows', 'Assigned owner or channel'],
        dataSources: ['task_runs sqlite', 'sessions.json', 'cron/jobs.json', 'memory/incidents/*.md'],
        relatedSurfaces: ['Pulse', 'Task Board', 'Office'],
        nextStep: 'Promote the office feed ordering into a dedicated triage drawer with pinning and status filters.',
      },
      {
        id: 'project-brief-builder',
        name: 'Project Brief Builder',
        kind: 'operator-tool',
        readiness: 'candidate',
        summary: 'A read-only proposal flow that assembles project, memory, and doc evidence into a reusable operator brief before execution starts.',
        operatorValue: 'Makes it easier to spin up the right context packet for a project without re-reading scattered markdown every time.',
        rationale: 'Projects, docs, and memory cards are already file-backed. They can be cross-ranked into a clean briefing pack with no write path yet.',
        recommendedInputs: ['Project card', 'Latest memory note', 'Relevant runbook', 'Open tasks in lane'],
        dataSources: ['workspace projects', 'MEMORY.md', 'memory/*.md', 'docs/*.md', 'obsidian-vault'],
        relatedSurfaces: ['Projects', 'Memories', 'Docs'],
        nextStep: 'Add bundle presets for workspace, business, and incident response contexts.',
      },
      {
        id: 'custom-panel-proposer',
        name: 'Custom Panel Proposer',
        kind: 'automation',
        readiness: 'candidate',
        summary: 'A builder assistant that recommends the next internal panel to create based on repeated workflow collisions and available local data sources.',
        operatorValue: 'Turns recurring friction into a backlog of credible internal tool ideas instead of loose notes.',
        rationale: 'Office, Pulse, and Projects now expose enough structured inputs to score candidate panels by impact, data coverage, and implementation readiness.',
        recommendedInputs: ['Repeated workflow pain', 'Touched surfaces', 'Live data coverage', 'Read-only first operator outcomes'],
        dataSources: ['OpenLab snapshot', 'Office rituals', 'Project cards', 'Docs and incidents'],
        relatedSurfaces: ['Office', 'Projects', 'Docs', 'Agents'],
        nextStep: 'Keep recommendations read-only for now, then later add a spec export that can seed actual tool generation.',
      },
    ],
  }
}

async function readIncidentAlerts(): Promise<OpenLabAlert[]> {
  const files = (await readDirectoryFilenames(INCIDENTS_DIR)).sort().slice(-3)
  const alerts: OpenLabAlert[] = []

  for (const file of files) {
    try {
      const path = `${INCIDENTS_DIR}/${file}`
      const raw = await readFile(path, 'utf8')
      const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
      const titleLine = lines.find((line) => /^##\s/.test(line) || /^-\s/.test(line))
      if (!titleLine) continue
      const detailLine = lines.find((line) => /failed|SIGKILL|error|warning|incident|timed? out|CDP/i.test(line) && line !== titleLine) ?? lines[1] ?? titleLine
      alerts.push({
        id: `incident-${file}`,
        title: titleLine.replace(/^##\s*/, '').replace(/^-\s*/, ''),
        level: /SIGKILL|failed|error|timeout|timed out|CDP/i.test(`${titleLine} ${detailLine}`) ? 'critical' : 'warning',
        source: basename(path),
        timeLabel: file.replace(/\.md$/, ''),
        detail: detailLine,
        live: false,
      })
    } catch {
      continue
    }
  }

  return alerts
}

function fromDateLike(input: { id: string; title: string; lane: string; source: 'cron'; system: 'openclaw' | 'hermes'; dateLike?: number | string | null; duration: string; detail?: string }): OpenLabCalendarItem | null {
  if (!input.dateLike) return null
  const date = typeof input.dateLike === 'number' ? new Date(input.dateLike) : new Date(input.dateLike)
  if (Number.isNaN(date.getTime())) return null

  return {
    id: input.id,
    title: input.title,
    lane: input.lane,
    date: date.toISOString().slice(0, 10),
    time: formatClock(date),
    duration: input.duration,
    source: input.source,
    system: input.system,
    detail: input.detail,
  }
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(path, 'utf8')
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

async function safeStat(path: string) {
  try {
    return await stat(path)
  } catch {
    return null
  }
}

async function readDirectoryFilenames(path: string): Promise<string[]> {
  try {
    return await readdir(path)
  } catch {
    return []
  }
}

async function filterExistingPaths(paths: string[]) {
  const checks = await Promise.all(paths.map(async (path) => ((await safeStat(path)) ? path : null)))
  return checks.filter(Boolean) as string[]
}

async function readMarkdownPreview(path: string): Promise<MarkdownPreview> {
  try {
    const [raw, fileStat] = await Promise.all([readFile(path, 'utf8'), stat(path)])
    const lines = raw.split(/\r?\n/)
    const cleanLines = lines.map((line) => line.trim())
    const title = cleanLines.find((line) => /^#\s+/.test(line))?.replace(/^#\s+/, '')
      || cleanLines.find((line) => /^##\s+/.test(line))?.replace(/^##\s+/, '')
      || basename(path, extname(path)).replace(/[-_]/g, ' ')
    const prose = cleanLines.filter((line) => line && !/^#/.test(line) && !/^---$/.test(line) && !/^[_*`-]{3,}$/.test(line))
    const summary = summarizeTaskText(prose[0] || title)
    const detail = summarizeTaskText(prose.slice(1).find((line) => line !== summary) || lines.find((line) => /^###\s+/.test(line))?.replace(/^###\s+/, '') || `From ${toWorkspacePath(path)}`)
    return {
      path,
      title,
      summary,
      detail,
      tags: inferTagsFromPath(path),
      updatedAt: fileStat.mtimeMs,
      exists: true,
    }
  } catch {
    return {
      path,
      title: basename(path, extname(path)).replace(/[-_]/g, ' '),
      summary: 'Source file not found yet.',
      detail: `Expected at ${toWorkspacePath(path)}`,
      tags: inferTagsFromPath(path),
      exists: false,
    }
  }
}

function mapRunStatus(status: string): OpenLabTaskStatus {
  if (status === 'running') return 'in_progress'
  if (status === 'succeeded') return 'done'
  if (status === 'queued' || status === 'pending') return 'planned'
  if (status === 'failed' || status === 'timed_out') return 'review'
  if (status === 'lost' || status === 'cancelled') return 'backlog'
  return 'planned'
}

function mapCoordinationStatus(status?: string): OpenLabTaskStatus {
  if (status === 'done') return 'done'
  if (status === 'in_progress') return 'in_progress'
  if (status === 'review') return 'review'
  if (status === 'ready' || status === 'queued') return 'planned'
  return 'backlog'
}

function inferPriority(status: string, runtime: string, deliveryStatus: string): OpenLabTaskPriority {
  if (status === 'failed' || status === 'timed_out') return 'urgent'
  if (status === 'running' || runtime === 'subagent') return 'high'
  if (deliveryStatus === 'pending') return 'medium'
  return 'low'
}

function mapCoordinationPriority(priority?: string): OpenLabTaskPriority {
  if (priority === 'P0') return 'urgent'
  if (priority === 'P1') return 'high'
  if (priority === 'P2') return 'medium'
  return 'low'
}

function inferTeam(row: OpenClawTaskRunRow, channel?: string): string {
  if (row.runtime === 'cron') return 'Automation'
  if (channel === 'discord') return 'Comms'
  if (channel === 'telegram') return 'Messaging'
  if (row.runtime === 'subagent') return 'Execution'
  return 'OpenClaw'
}

function prettifyOwner(ownerKey: string, sessionLabel?: string) {
  if (sessionLabel) return sessionLabel
  if (!ownerKey) return 'System'
  if (ownerKey.includes('discord')) return 'Discord thread'
  if (ownerKey.includes('telegram')) return 'Telegram'
  if (ownerKey.includes('subagent')) return 'Subagent'
  return ownerKey.replace(/^agent:main:/, '')
}

function summarizeTaskText(text: string) {
  const compactText = text.replace(/\s+/g, ' ').trim()
  return compactText.length > 88 ? `${compactText.slice(0, 85)}…` : compactText
}

function formatRelative(input?: number | string | null) {
  if (!input) return 'No recent update'
  const value = typeof input === 'string' ? Date.parse(input) : input
  if (!value || Number.isNaN(value)) return 'No recent update'
  const diffMs = Date.now() - value
  const absMinutes = Math.round(Math.abs(diffMs) / 60000)
  if (absMinutes < 1) return 'just now'
  if (absMinutes < 60) return `${absMinutes}m ago`
  const hours = Math.round(absMinutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}

function formatDateTime(input?: number | string | null) {
  if (!input) return 'n/a'
  const date = typeof input === 'number' ? new Date(input) : new Date(input)
  if (Number.isNaN(date.getTime())) return 'n/a'
  return date.toLocaleString('en-GB', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
}

function statusTone(status: string): OpenLabTaskEvent['tone'] {
  if (status === 'succeeded') return 'good'
  if (status === 'failed' || status === 'timed_out') return 'bad'
  if (status === 'running') return 'warn'
  return 'neutral'
}

function toIso(value?: number | null) {
  return value ? new Date(value).toISOString() : undefined
}

function formatClock(date: Date) {
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function inferDuration(kind?: string, expr?: string) {
  if (kind === 'cron' && expr?.includes('*/3')) return 'Every 3h'
  if (kind === 'cron' && expr?.includes('* * *')) return 'Recurring'
  return 'Scheduled'
}

function inferHermesDuration(minutes?: number, display?: string) {
  if (minutes) return `Every ${minutes}m`
  return display || 'Scheduled'
}

function mapHealthTone(status?: OpenLabHealthStatus): OpenLabOfficeZone['tone'] {
  if (status === 'healthy') return 'good'
  if (status === 'warning' || status === 'placeholder') return 'warn'
  if (status === 'critical' || status === 'offline') return 'bad'
  return 'neutral'
}

function inferActiveWorkflowTitle(tasks: OpenLabTask[], projects: OpenLabProjectCard[]) {
  const activeTask = tasks.find((task) => task.status === 'in_progress')
  if (activeTask) return activeTask.title
  return projects.find((project) => project.status === 'active')?.name ?? 'Operator coordination'
}

function inferWorkflowSummary(tasks: OpenLabTask[], calendarItems: OpenLabCalendarItem[], monitoring: OpenLabMonitorCard[]) {
  const activeTask = tasks.find((task) => task.status === 'in_progress')
  const nextCalendar = calendarItems[0]
  const runtime = monitoring.find((card) => card.id === 'gateway')
  if (activeTask && nextCalendar) return `${activeTask.team} is active, with ${nextCalendar.title} scheduled next and ${runtime?.summary.toLowerCase() ?? 'runtime visible locally'}.`
  if (activeTask) return `${activeTask.team} is active and ready for a focused operator view.`
  if (nextCalendar) return `${nextCalendar.title} is the next scheduled event, so the likely need is coordination and review.`
  return 'No dominant workflow was detected, so proposals stay broad and operator-first.'
}

function compact<T>(items: Array<T | undefined | null | false>): T[] {
  return items.filter(Boolean) as T[]
}

function compactEvents(items: Array<OpenLabTaskEvent | null>) {
  return items.filter(Boolean) as OpenLabTaskEvent[]
}

function compactMetrics(items: Array<OpenLabMetric | null>) {
  return items.filter(Boolean) as OpenLabMetric[]
}

function rankAlertLevel(level: OpenLabAlert['level']) {
  return { critical: 3, warning: 2, info: 1 }[level]
}

function sortByUpdatedLabel<T extends { updatedAt?: string }>(a: T, b: T) {
  return (Date.parse(b.updatedAt || '') || 0) - (Date.parse(a.updatedAt || '') || 0)
}

function slugify(input: string) {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

function toWorkspacePath(path: string) {
  return path.startsWith(WORKSPACE_ROOT) ? relative(WORKSPACE_ROOT, path) || '.' : path
}

function inferTagsFromPath(path: string) {
  const rel = toWorkspacePath(path)
  return rel.split('/').filter(Boolean).slice(0, 3)
}

function inferMemoryKind(path: string): OpenLabMemoryCard['kind'] {
  if (path === MEMORY_FILE) return 'memory-core'
  if (path.includes('/incidents/')) return 'incident'
  if (path.includes('/obsidian-vault/')) return 'vault-note'
  return 'daily-note'
}

function inferDocSection(path: string) {
  if (path.includes('/docs/')) return 'Runbook'
  if (path.includes('/reports/')) return 'Report'
  if (path.includes('/Reference/')) return 'Reference'
  return 'Workspace'
}

function determineProjectStatus(name: string, previewSummary: string): OpenLabProjectCard['status'] {
  const lower = `${name} ${previewSummary}`.toLowerCase()
  if (lower.includes('backup') || lower.includes('archive')) return 'archived'
  if (lower.includes('pending') || lower.includes('await')) return 'watching'
  return 'active'
}
