'use client'

import type { ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type {
  OpenLabAgentCard,
  OpenLabAlert,
  OpenLabCalendarItem,
  OpenLabDocCard,
  OpenLabHealthStatus,
  OpenLabMemoryCard,
  OpenLabMetric,
  OpenLabMonitorCard,
  OpenLabOfficeSnapshot,
  OpenLabProjectCard,
  OpenLabSnapshot,
  OpenLabSourceKind,
  OpenLabTask,
  OpenLabTaskEvent,
  OpenLabToolBuilderSnapshot,
  OpenLabToolProposal,
} from '@/lib/openclaw-adapters'

type Surface = 'task-board' | 'calendar' | 'agents' | 'pulse' | 'projects' | 'memories' | 'docs' | 'office' | 'tools'

type TaskContext = {
  projects: OpenLabProjectCard[]
  memories: OpenLabMemoryCard[]
  docs: OpenLabDocCard[]
  calendarItems: OpenLabCalendarItem[]
}

type TaskColumn = {
  key: OpenLabTask['status']
  label: string
  accent: string
}

const taskColumns: TaskColumn[] = [
  { key: 'backlog', label: 'Backlog', accent: 'bg-slate-400/20 text-slate-300' },
  { key: 'planned', label: 'Planned', accent: 'bg-blue-500/20 text-blue-300' },
  { key: 'in_progress', label: 'In Progress', accent: 'bg-amber-500/20 text-amber-300' },
  { key: 'review', label: 'Review', accent: 'bg-violet-500/20 text-violet-300' },
  { key: 'done', label: 'Done', accent: 'bg-emerald-500/20 text-emerald-300' },
]

export function OpenLabAppShell({ snapshot }: { snapshot: OpenLabSnapshot }) {
  const [surface, setSurface] = useState<Surface>('pulse')
  const [liveSnapshot, setLiveSnapshot] = useState(snapshot)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(snapshot.tasks[0]?.id ?? null)
  const [syncState, setSyncState] = useState<{ lastSuccessAt: number; syncing: boolean; error: string | null }>({
    lastSuccessAt: Date.parse(snapshot.generatedAt) || Date.now(),
    syncing: false,
    error: null,
  })
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlightRef = useRef(false)
  const boardData = useMemo(() => groupTasksByColumn(liveSnapshot.tasks), [liveSnapshot.tasks])
  const selectedTask = liveSnapshot.tasks.find((task) => task.id === selectedTaskId) ?? liveSnapshot.tasks[0]
  const selectedTaskContext = useMemo(
    () => (selectedTask ? buildTaskContext(selectedTask, liveSnapshot) : null),
    [selectedTask, liveSnapshot],
  )
  const calendarDays = useMemo(() => buildCalendarDays(liveSnapshot.calendarItems), [liveSnapshot.calendarItems])
  const calendarLanes = useMemo(() => Array.from(new Set(liveSnapshot.calendarItems.map((item) => item.lane))), [liveSnapshot.calendarItems])
  const primaryDate = calendarDays[0]?.date
  const todaysItems = primaryDate ? liveSnapshot.calendarItems.filter((item) => item.date === primaryDate) : liveSnapshot.calendarItems.slice(0, 4)
  const healthyMonitors = liveSnapshot.monitoring.filter((item) => item.status === 'healthy').length
  const alertCount = liveSnapshot.alerts.filter((item) => item.level !== 'info').length
  const activeAgents = liveSnapshot.agents.filter((agent) => agent.status === 'active').length
  const realProjects = liveSnapshot.projects.filter((project) => project.sourceKind !== 'placeholder').length
  const realDocs = liveSnapshot.docs.filter((doc) => doc.sourceKind === 'real').length
  const realMemories = liveSnapshot.memories.filter((memory) => memory.sourceKind === 'real').length
  const cadenceSeconds = getRefreshCadenceSeconds(surface)

  useEffect(() => {
    setLiveSnapshot(snapshot)
    setSyncState({ lastSuccessAt: Date.parse(snapshot.generatedAt) || Date.now(), syncing: false, error: null })
  }, [snapshot])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const initialSurface = params.get('surface')
    const initialTask = params.get('task')

    if (isSurface(initialSurface)) {
      setSurface(initialSurface)
    }

    if (initialTask && snapshot.tasks.some((task) => task.id === initialTask)) {
      setSelectedTaskId(initialTask)
    }
  }, [snapshot.tasks])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    params.set('surface', surface)
    if (selectedTaskId) {
      params.set('task', selectedTaskId)
    } else {
      params.delete('task')
    }

    window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`)
  }, [surface, selectedTaskId])

  useEffect(() => {
    if (liveSnapshot.tasks.length === 0) {
      setSelectedTaskId(null)
      return
    }

    if (!selectedTaskId || !liveSnapshot.tasks.some((task) => task.id === selectedTaskId)) {
      setSelectedTaskId(liveSnapshot.tasks[0]?.id ?? null)
    }
  }, [liveSnapshot.tasks, selectedTaskId])

  useEffect(() => {
    let cancelled = false

    const clearTimer = () => {
      if (syncTimerRef.current) {
        clearTimeout(syncTimerRef.current)
        syncTimerRef.current = null
      }
    }

    const scheduleNext = (ms: number) => {
      clearTimer()
      syncTimerRef.current = setTimeout(runRefresh, ms)
    }

    const runRefresh = async () => {
      if (cancelled || inFlightRef.current) return
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        scheduleNext(cadenceSeconds * 1000)
        return
      }

      inFlightRef.current = true
      setSyncState((current) => ({ ...current, syncing: true }))

      try {
        const response = await fetch('/api/openlab/snapshot', { cache: 'no-store' })
        if (!response.ok) {
          throw new Error(`Refresh failed (${response.status})`)
        }

        const nextSnapshot = await response.json() as OpenLabSnapshot
        if (cancelled) return
        setLiveSnapshot(nextSnapshot)
        setSyncState({ lastSuccessAt: Date.now(), syncing: false, error: null })
      } catch (error) {
        if (cancelled) return
        setSyncState((current) => ({
          ...current,
          syncing: false,
          error: error instanceof Error ? error.message : 'Refresh failed',
        }))
      } finally {
        inFlightRef.current = false
        if (!cancelled) {
          scheduleNext(cadenceSeconds * 1000)
        }
      }
    }

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        clearTimer()
        void runRefresh()
      }
    }

    scheduleNext(cadenceSeconds * 1000)
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      cancelled = true
      clearTimer()
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [cadenceSeconds])

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="flex min-h-screen">
        <aside className="hidden w-[88px] shrink-0 border-r border-border bg-surface-1/80 px-4 py-5 md:flex md:flex-col md:justify-between">
          <div className="space-y-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-lab-cyan/30 bg-lab-cyan/10 text-lg font-semibold text-lab-cyan">OL</div>
            <nav className="space-y-2">
              <RailButton label="Pulse" active={surface === 'pulse'} onClick={() => setSurface('pulse')} icon={<PulseIcon />} />
              <RailButton label="Board" active={surface === 'task-board'} onClick={() => setSurface('task-board')} icon={<BoardIcon />} />
              <RailButton label="Calendar" active={surface === 'calendar'} onClick={() => setSurface('calendar')} icon={<CalendarIcon />} />
              <RailButton label="Projects" active={surface === 'projects'} onClick={() => setSurface('projects')} icon={<ProjectsIcon />} />
              <RailButton label="Office" active={surface === 'office'} onClick={() => setSurface('office')} icon={<OfficeIcon />} />
              <RailButton label="Tools" active={surface === 'tools'} onClick={() => setSurface('tools')} icon={<ToolboxIcon />} />
              <RailButton label="Memory" active={surface === 'memories'} onClick={() => setSurface('memories')} icon={<MemoryIcon />} />
              <RailButton label="Docs" active={surface === 'docs'} onClick={() => setSurface('docs')} icon={<DocsIcon />} />
              <RailButton label="Agents" active={surface === 'agents'} onClick={() => setSurface('agents')} icon={<AgentsIcon />} />
            </nav>
          </div>
          <div className="panel-muted px-3 py-3 text-center text-[11px] text-muted-foreground">
            {new Date(liveSnapshot.generatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} sync
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="border-b border-border bg-surface-1/60 px-5 py-4 backdrop-blur">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="rounded-full border border-lab-cyan/30 bg-lab-cyan/10 px-2 py-0.5 text-lab-cyan">OpenLab</span>
                  <span>Local operator workspace, live from OpenClaw, Chrome, Hermes, memory files, and markdown sources</span>
                </div>
                <h1 className="text-2xl font-semibold">Monitoring, board, projects, memory, docs, and team visibility</h1>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant={surface === 'pulse' ? 'default' : 'outline'} size="sm" onClick={() => setSurface('pulse')}>Pulse</Button>
                <Button variant={surface === 'task-board' ? 'default' : 'outline'} size="sm" onClick={() => setSurface('task-board')}>Task Board</Button>
                <Button variant={surface === 'calendar' ? 'default' : 'outline'} size="sm" onClick={() => setSurface('calendar')}>Calendar</Button>
                <Button variant={surface === 'projects' ? 'default' : 'outline'} size="sm" onClick={() => setSurface('projects')}>Projects</Button>
                <Button variant={surface === 'office' ? 'default' : 'outline'} size="sm" onClick={() => setSurface('office')}>Office</Button>
                <Button variant={surface === 'tools' ? 'default' : 'outline'} size="sm" onClick={() => setSurface('tools')}>Custom Tools</Button>
                <Button variant={surface === 'memories' ? 'default' : 'outline'} size="sm" onClick={() => setSurface('memories')}>Memories</Button>
                <Button variant={surface === 'docs' ? 'default' : 'outline'} size="sm" onClick={() => setSurface('docs')}>Docs</Button>
                <Button variant={surface === 'agents' ? 'default' : 'outline'} size="sm" onClick={() => setSurface('agents')}>Agents</Button>
                <span className="rounded-full border border-border bg-surface-1 px-3 py-1 text-xs text-muted-foreground">Localhost-only</span>
              </div>
            </div>
          </header>

          <div className="grid gap-4 border-b border-border bg-surface-1/40 px-5 py-4 lg:grid-cols-[1.6fr_1fr_1fr_1fr_1fr]">
            <div className="panel p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-1 px-3 py-1 text-xs text-muted-foreground">
                  <span className={cn('status-dot', syncState.error ? 'bg-rose-400' : syncState.syncing ? 'bg-lab-amber animate-pulse' : 'bg-lab-mint')} />
                  <span>{syncState.error ? 'Refresh paused' : syncState.syncing ? 'Refreshing now' : `Auto-refresh ${cadenceSeconds}s`}</span>
                  <span>•</span>
                  <span>{formatSyncLabel(syncState.lastSuccessAt)}</span>
                </div>
                {syncState.error ? <div className="text-xs text-rose-300">{syncState.error}</div> : null}
              </div>
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">OpenLab pulse</p>
                  <h2 className="text-lg font-semibold">Runtime signals stay local, UI stays read-only</h2>
                </div>
                <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-300">{healthyMonitors}/{liveSnapshot.monitoring.length} healthy</span>
              </div>
              <p className="max-w-2xl text-sm text-muted-foreground">Projects, Memories, and Docs now read local files directly. Each card marks whether it comes from live system state, real files, or inference from file structure.</p>
            </div>
            <CompactStatCard label="Live alerts" value={String(alertCount)} tone={alertCount > 0 ? 'warning' : 'healthy'} detail="Tasks, incidents, and schedule state" />
            <CompactStatCard label="Tracked tasks" value={String(liveSnapshot.tasks.length)} tone={activeAgents > 0 ? 'warning' : 'healthy'} detail="OpenClaw task runs plus fallback coordination" />
            <CompactStatCard label="Real projects" value={String(realProjects)} tone="healthy" detail="Workspace and vault evidence attached" />
            <CompactStatCard label="Memory + docs" value={`${realMemories}/${realDocs}`} tone="neutral" detail="Real memory cards / real docs cards" />
          </div>

          <div className="border-b border-border bg-background/60 px-5 py-4 backdrop-blur">
            <TaskContextBar task={selectedTask} context={selectedTaskContext} surface={surface} onNavigate={setSurface} />
          </div>

          <div className="flex-1 overflow-hidden px-5 py-5">
            {surface === 'task-board' ? (
              <TaskBoardSurface boardData={boardData} selectedTask={selectedTask} taskContext={selectedTaskContext} onSelectTask={setSelectedTaskId} onNavigate={setSurface} generatedAt={liveSnapshot.generatedAt} />
            ) : surface === 'calendar' ? (
              <CalendarSurface items={liveSnapshot.calendarItems} todaysItems={todaysItems} calendarDays={calendarDays} calendarLanes={calendarLanes} generatedAt={liveSnapshot.generatedAt} selectedTask={selectedTask} taskContext={selectedTaskContext} onNavigate={setSurface} />
            ) : surface === 'projects' ? (
              <ProjectsSurface projects={liveSnapshot.projects} selectedTask={selectedTask} taskContext={selectedTaskContext} onNavigate={setSurface} />
            ) : surface === 'office' ? (
              <OfficeSurface office={liveSnapshot.office} monitoring={liveSnapshot.monitoring} generatedAt={liveSnapshot.generatedAt} />
            ) : surface === 'tools' ? (
              <ToolBuilderSurface toolBuilder={liveSnapshot.toolBuilder} />
            ) : surface === 'memories' ? (
              <MemoriesSurface memories={liveSnapshot.memories} selectedTask={selectedTask} taskContext={selectedTaskContext} onNavigate={setSurface} />
            ) : surface === 'docs' ? (
              <DocsSurface docs={liveSnapshot.docs} selectedTask={selectedTask} taskContext={selectedTaskContext} onNavigate={setSurface} />
            ) : surface === 'agents' ? (
              <AgentsSurface agents={liveSnapshot.agents} />
            ) : (
              <PulseSurface monitoring={liveSnapshot.monitoring} alerts={liveSnapshot.alerts} generatedAt={liveSnapshot.generatedAt} />
            )}
          </div>
        </div>
      </div>
    </main>
  )
}

function TaskContextBar({
  task,
  context,
  surface,
  onNavigate,
}: {
  task?: OpenLabTask
  context: TaskContext | null
  surface: Surface
  onNavigate: (surface: Surface) => void
}) {
  if (!task) return null

  return (
    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
      <div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-1 text-primary">Selected task</span>
          <span>{task.id}</span>
          <span>•</span>
          <span>{labelizeStatus(task.status)}</span>
          <span>•</span>
          <span>{task.owner ?? 'Unassigned'}</span>
        </div>
        <h2 className="mt-2 text-base font-semibold">{task.title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {context?.projects.length ?? 0} project, {context?.memories.length ?? 0} memory, {context?.docs.length ?? 0} doc, {context?.calendarItems.length ?? 0} schedule link(s)
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {(['task-board', 'calendar', 'projects', 'memories', 'docs', 'pulse'] as Surface[]).map((target) => (
          <Button key={target} variant={surface === target ? 'default' : 'outline'} size="sm" onClick={() => onNavigate(target)}>
            {surfaceLabel(target)}
          </Button>
        ))}
      </div>
    </div>
  )
}

function PulseSurface({ monitoring, alerts, generatedAt }: { monitoring: OpenLabMonitorCard[]; alerts: OpenLabAlert[]; generatedAt: string }) {
  return (
    <section className="grid h-full min-h-[640px] gap-4 xl:grid-cols-[minmax(0,1.45fr)_360px]">
      <div className="space-y-4">
        <div className="panel p-4">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Monitoring</p>
              <h2 className="text-lg font-semibold">System status cards</h2>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="status-dot bg-lab-mint" />
              Local evidence only, updated {formatDataAgeLabel(generatedAt)}
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {monitoring.map((card) => (
              <MonitorCard key={card.id} card={card} />
            ))}
          </div>
        </div>
      </div>

      <aside className="space-y-4">
        <div className="panel p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Alerts</p>
          <h3 className="mt-2 text-base font-semibold">Recent failures and live attention</h3>
          <div className="mt-3 space-y-3">
            {alerts.map((alert) => (
              <AlertRow key={alert.id} alert={alert} />
            ))}
          </div>
        </div>
        <div className="panel p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Sources</p>
          <h3 className="mt-2 text-base font-semibold">What this pass made live</h3>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li>Gateway reads from <code className="text-[11px] text-foreground">openclaw gateway status</code></li>
            <li>Chrome reads from <code className="text-[11px] text-foreground">127.0.0.1:9222/json/*</code></li>
            <li>Memory reads from workspace files and incident logs</li>
            <li>Projects and docs read from workspace plus Obsidian markdown</li>
            <li>Alerts merge recent task runs with memory incident notes</li>
          </ul>
        </div>
      </aside>
    </section>
  )
}

function TaskBoardSurface({
  boardData,
  selectedTask,
  taskContext,
  onSelectTask,
  onNavigate,
  generatedAt,
}: {
  boardData: Record<OpenLabTask['status'], OpenLabTask[]>
  selectedTask?: OpenLabTask
  taskContext: TaskContext | null
  onSelectTask: (taskId: string) => void
  onNavigate: (surface: Surface) => void
  generatedAt: string
}) {
  return (
    <section className="grid h-full min-h-[640px] gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="panel p-4">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Task Board</p>
            <h2 className="text-lg font-semibold">Execution lanes</h2>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="status-dot bg-lab-mint" />
            Live local feed, updated {formatDataAgeLabel(generatedAt)}
          </div>
        </div>
        <div className="flex gap-4 overflow-x-auto pb-2">
          {taskColumns.map((column) => (
            <div key={column.key} className="min-h-[520px] min-w-[290px] flex-1 rounded-2xl border border-border bg-surface-1/80">
              <div className={cn('flex items-center justify-between rounded-t-2xl border-b border-border px-4 py-3 text-sm font-medium', column.accent)}>
                <span>{column.label}</span>
                <span className="rounded-md bg-black/10 px-2 py-0.5 text-xs">{boardData[column.key].length}</span>
              </div>
              <div className="space-y-3 p-3">
                {boardData[column.key].map((task) => {
                  const active = selectedTask?.id === task.id
                  return (
                    <button
                      key={task.id}
                      type="button"
                      onClick={() => onSelectTask(task.id)}
                      className={cn(
                        'block w-full rounded-xl border bg-card px-3 py-3 text-left shadow-panel transition-all hover:-translate-y-0.5 hover:border-primary/40',
                        active ? 'border-primary/50 ring-1 ring-primary/30' : 'border-border',
                      )}
                    >
                      <div className="mb-2 flex items-start justify-between gap-3">
                        <div>
                          <div className="mb-1 text-[11px] font-mono text-lab-cyan">{task.id}</div>
                          <h3 className="text-sm font-medium leading-5">{task.title}</h3>
                        </div>
                        <PriorityPill priority={task.priority} />
                      </div>
                      <div className="mb-3 flex flex-wrap gap-1.5">
                        <Tag>{task.team}</Tag>
                        {task.tags?.map((tag) => <Tag key={tag}>{tag}</Tag>)}
                      </div>
                      <p className="mb-3 max-h-10 overflow-hidden text-xs text-muted-foreground">{task.summary ?? 'No summary yet.'}</p>
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>{task.owner ?? 'Unassigned'}</span>
                        <span>{task.dueLabel ?? 'No due date'}</span>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <TaskDetailDrawer task={selectedTask} context={taskContext} onNavigate={onNavigate} />
    </section>
  )
}

function TaskDetailDrawer({ task, context, onNavigate }: { task?: OpenLabTask; context: TaskContext | null; onNavigate: (surface: Surface) => void }) {
  if (!task) {
    return (
      <aside className="panel p-5">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Task Detail</p>
        <h3 className="mt-2 text-base font-semibold">Pick a task</h3>
        <p className="mt-3 text-sm text-muted-foreground">Select any card to inspect its latest run, session, summary, and linked project or knowledge context.</p>
      </aside>
    )
  }

  return (
    <aside className="panel flex h-full min-h-[640px] flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Task Detail</p>
          <h3 className="mt-2 text-base font-semibold leading-6">{task.title}</h3>
        </div>
        <PriorityPill priority={task.priority} />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Tag>{task.id}</Tag>
        <Tag>{task.team}</Tag>
        {task.source === 'openclaw-task-run' ? <Tag>live</Tag> : <Tag>fallback</Tag>}
      </div>

      <div className="mt-4 rounded-2xl border border-border bg-surface-1/80 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Operator navigation</p>
            <p className="mt-1 text-sm text-muted-foreground">Keep this task selected while jumping across board, calendar, docs, and memory.</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => onNavigate('task-board')}>Board</Button>
          <Button variant="outline" size="sm" onClick={() => onNavigate('calendar')}>Calendar</Button>
          <Button variant="outline" size="sm" onClick={() => onNavigate('projects')}>Projects</Button>
          <Button variant="outline" size="sm" onClick={() => onNavigate('memories')}>Memory</Button>
          <Button variant="outline" size="sm" onClick={() => onNavigate('docs')}>Docs</Button>
          <Button variant="outline" size="sm" onClick={() => onNavigate('pulse')}>Pulse</Button>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <MetricCard label="Owner" value={task.owner ?? 'Unassigned'} />
        <MetricCard label="Status" value={labelizeStatus(task.status)} />
        <MetricCard label="Updated" value={task.dueLabel ?? 'Unknown'} />
        <MetricCard label="Runtime" value={task.runtime ?? task.estimate ?? 'n/a'} />
      </div>

      <div className="mt-5 rounded-2xl border border-border bg-surface-1/80 p-4">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Summary</p>
        <p className="mt-2 text-sm leading-6 text-foreground/90">{task.summary ?? 'No summary available.'}</p>
      </div>

      <div className="mt-4 rounded-2xl border border-border bg-surface-1/80 p-4">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Source detail</p>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">{task.detail ?? 'No detail available.'}</p>
      </div>

      <div className="mt-4 rounded-2xl border border-border bg-surface-1/80 p-4">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Linked context</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <ContextListCard title="Projects" items={context?.projects.map((project) => project.name) ?? []} emptyLabel="No project match yet" />
          <ContextListCard title="Schedule" items={context?.calendarItems.map((item) => `${item.time} ${item.title}`) ?? []} emptyLabel="No schedule block matched" />
          <ContextListCard title="Memory" items={context?.memories.map((memory) => memory.title) ?? []} emptyLabel="No memory trace matched" />
          <ContextListCard title="Docs" items={context?.docs.map((doc) => doc.title) ?? []} emptyLabel="No doc reference matched" />
        </div>
      </div>

      <div className="mt-4 flex-1 rounded-2xl border border-border bg-surface-1/80 p-4">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Activity</p>
        <div className="mt-3 space-y-3">
          {(task.events ?? []).map((event, index) => (
            <TaskEventRow key={`${event.label}-${index}`} event={event} />
          ))}
        </div>
      </div>
    </aside>
  )
}

function CalendarSurface({
  items,
  todaysItems,
  calendarDays,
  calendarLanes,
  generatedAt,
  selectedTask,
  taskContext,
  onNavigate,
}: {
  items: OpenLabCalendarItem[]
  todaysItems: OpenLabCalendarItem[]
  calendarDays: Array<{ date: string; label: string }>
  calendarLanes: string[]
  generatedAt: string
  selectedTask?: OpenLabTask
  taskContext: TaskContext | null
  onNavigate: (surface: Surface) => void
}) {
  return (
    <section className="grid h-full min-h-[600px] gap-4 xl:grid-cols-[1.6fr_340px]">
      <div className="panel p-4">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Calendar</p>
            <h2 className="text-lg font-semibold">Scheduled work lanes</h2>
          </div>
          <div className="rounded-full border border-lab-violet/30 bg-lab-violet/10 px-3 py-1 text-xs text-lab-violet">OpenClaw + Hermes, {formatDataAgeLabel(generatedAt)}</div>
        </div>
        <div className="grid grid-cols-[140px_repeat(auto-fit,minmax(160px,1fr))] gap-2 text-xs">
          <div className="rounded-xl border border-transparent px-3 py-2 text-muted-foreground">Lane</div>
          {calendarDays.map((day) => (
            <div key={day.date} className="rounded-xl border border-border bg-surface-1 px-3 py-2 text-center font-medium">{day.label}</div>
          ))}
          {calendarLanes.map((lane) => (
            <div key={lane} className="contents">
              <div className="rounded-xl border border-border bg-surface-1 px-3 py-3 font-medium text-foreground">{lane}</div>
              {calendarDays.map((day) => {
                const cellItems = items.filter((item) => item.lane === lane && item.date === day.date)
                return (
                  <div key={`${lane}-${day.date}`} className="min-h-[136px] rounded-xl border border-border bg-card p-2">
                    <div className="space-y-2">
                      {cellItems.map((item) => (
                        <div key={item.id} className={cn('rounded-lg border bg-surface-1 px-2 py-2', taskContext?.calendarItems.some((match) => match.id === item.id) ? 'border-primary/50 ring-1 ring-primary/20' : 'border-border')}>
                          <div className="mb-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                            <span>{item.time}</span>
                            <SourcePill source={item.source} system={item.system} />
                          </div>
                          <div className="text-sm font-medium">{item.title}</div>
                          <div className="mt-1 text-[11px] text-muted-foreground">{item.duration}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        <div className="panel p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Upcoming</p>
          <h3 className="mt-2 text-base font-semibold">Next schedule blocks</h3>
          <div className="mt-3 space-y-3">
            {(taskContext?.calendarItems.length ? taskContext.calendarItems : todaysItems).map((item) => (
              <div key={item.id} className={cn('rounded-xl border bg-surface-1 px-3 py-3', taskContext?.calendarItems.some((match) => match.id === item.id) ? 'border-primary/50' : 'border-border')}>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{item.lane}</span>
                  <span>{item.time}</span>
                </div>
                <div className="mt-1 text-sm font-medium">{item.title}</div>
                <div className="mt-1 text-xs text-muted-foreground">{item.duration}</div>
                {item.detail ? <div className="mt-2 text-[11px] text-muted-foreground">{item.detail}</div> : null}
              </div>
            ))}
          </div>
        </div>
        <div className="panel p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Task route</p>
          <h3 className="mt-2 text-base font-semibold">Keep context while checking schedule</h3>
          <p className="mt-2 text-sm text-muted-foreground">{selectedTask ? `Calendar is filtered toward ${selectedTask.title}.` : 'Pick a task on the board to highlight likely schedule matches here.'}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => onNavigate('task-board')}>Back to board</Button>
            <Button variant="outline" size="sm" onClick={() => onNavigate('docs')}>Open docs</Button>
            <Button variant="outline" size="sm" onClick={() => onNavigate('memories')}>Open memory</Button>
          </div>
        </div>
        <div className="panel p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Calendar adapter</p>
          <h3 className="mt-2 text-base font-semibold">What is live now</h3>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li>OpenClaw cron from <code className="text-[11px] text-foreground">~/.openclaw/cron/jobs.json</code></li>
            <li>Hermes cron from <code className="text-[11px] text-foreground">~/.hermes/cron/jobs.json</code></li>
            <li>Upcoming next-run timestamps rendered into day lanes</li>
          </ul>
        </div>
      </div>
    </section>
  )
}

function OfficeSurface({ office, monitoring, generatedAt }: { office: OpenLabOfficeSnapshot; monitoring: OpenLabMonitorCard[]; generatedAt: string }) {
  return (
    <section className="grid h-full min-h-[640px] gap-4 xl:grid-cols-[minmax(0,1.4fr)_360px]">
      <div className="space-y-4">
        <div className="panel p-4">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Office</p>
              <h2 className="text-lg font-semibold">A live floorplan for operators, workers, and review flow</h2>
            </div>
            <span className="rounded-full border border-border bg-surface-1 px-3 py-1 text-xs text-muted-foreground">Read-only, local state, {formatDataAgeLabel(generatedAt)}</span>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {office.seats.map((seat) => (
              <article key={seat.id} className="rounded-2xl border border-border bg-card/90 p-4 shadow-panel">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{seat.label}</p>
                    <h3 className="mt-2 text-base font-semibold">{seat.occupant}</h3>
                  </div>
                  <OfficeSeatBadge status={seat.status} />
                </div>
                <p className="mt-4 text-sm text-foreground/90">{seat.detail}</p>
                <div className="mt-3 text-xs text-muted-foreground">{seat.evidence}</div>
              </article>
            ))}
          </div>
        </div>

        <div className="panel p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Zones</p>
          <h3 className="mt-2 text-base font-semibold">Stateful rooms built from current snapshot data</h3>
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {office.zones.map((zone) => (
              <div key={zone.id} className="rounded-2xl border border-border bg-surface-1/80 p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium">{zone.name}</div>
                  <TonePill tone={zone.tone}>{zone.state}</TonePill>
                </div>
                <p className="mt-3 text-sm text-muted-foreground">{zone.summary}</p>
                <div className="mt-4 text-xs uppercase tracking-[0.16em] text-muted-foreground">{zone.metric}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <aside className="space-y-4">
        <div className="panel p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Live feed</p>
          <h3 className="mt-2 text-base font-semibold">What is moving through the office now</h3>
          <div className="mt-3 space-y-3">
            {office.feed.map((item) => (
              <div key={item.id} className="rounded-xl border border-border bg-surface-1 px-3 py-3">
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>{item.source}</span>
                  <TonePill tone={item.tone}>{item.timeLabel}</TonePill>
                </div>
                <div className="mt-2 text-sm font-semibold">{item.title}</div>
                <div className="mt-1 text-sm text-muted-foreground">{item.detail}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="panel p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Office rituals</p>
          <h3 className="mt-2 text-base font-semibold">Simple operator checkpoints</h3>
          <div className="mt-3 space-y-3">
            {office.rituals.map((ritual) => (
              <div key={ritual.label} className="rounded-xl border border-border bg-surface-1 px-3 py-3">
                <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{ritual.label}</div>
                <div className="mt-2 text-sm font-semibold">{ritual.value}</div>
                <div className="mt-1 text-sm text-muted-foreground">{ritual.detail}</div>
              </div>
            ))}
          </div>
        </div>
        <SummaryPanel title="Office signals" items={monitoring.slice(0, 3).map((card) => `${card.title}: ${card.summary}`)} />
      </aside>
    </section>
  )
}

function ToolBuilderSurface({ toolBuilder }: { toolBuilder: OpenLabToolBuilderSnapshot }) {
  return (
    <section className="grid h-full min-h-[640px] gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-4">
        <div className="panel p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Custom tools</p>
          <h2 className="mt-2 text-lg font-semibold">Proposal-first builder for internal panels and operator tools</h2>
          <p className="mt-3 max-w-3xl text-sm text-muted-foreground">This pass stays read-only. It recommends viable internal tools from current workflows and data coverage, instead of pretending generation already exists.</p>
        </div>

        <div className="panel p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Active workflow</p>
          <h3 className="mt-2 text-base font-semibold">{toolBuilder.activeWorkflow.title}</h3>
          <p className="mt-3 text-sm text-muted-foreground">{toolBuilder.activeWorkflow.summary}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {toolBuilder.activeWorkflow.signals.map((signal) => <Tag key={signal}>{signal}</Tag>)}
            {toolBuilder.activeWorkflow.surfaces.map((surface) => <Tag key={surface}>{surface}</Tag>)}
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {toolBuilder.proposals.map((proposal) => (
            <ToolProposalCard key={proposal.id} proposal={proposal} />
          ))}
        </div>
      </div>

      <aside className="space-y-4">
        <div className="panel p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Builder flow</p>
          <h3 className="mt-2 text-base font-semibold">Current mode</h3>
          <ol className="mt-3 space-y-3 text-sm text-muted-foreground">
            <li>1. Detect the loudest workflow from live tasks, schedule, and office feed.</li>
            <li>2. Match local data sources to panel patterns that can actually be supported.</li>
            <li>3. Recommend a read-only surface, plus the next implementation step.</li>
          </ol>
        </div>
        <SummaryPanel
          title="What is live"
          items={[
            'Proposal scoring is driven from the current OpenLab snapshot.',
            'Data source lists and related surfaces are real and traceable.',
            'No code generation or mutation path exists yet, by design.',
          ]}
        />
      </aside>
    </section>
  )
}

function ProjectsSurface({ projects, selectedTask, taskContext, onNavigate }: { projects: OpenLabProjectCard[]; selectedTask?: OpenLabTask; taskContext: TaskContext | null; onNavigate: (surface: Surface) => void }) {
  const active = projects.filter((project) => project.status === 'active')
  const watching = projects.filter((project) => project.status === 'watching')

  return (
    <section className="grid h-full min-h-[640px] gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="panel p-4">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Projects</p>
            <h2 className="text-lg font-semibold">Workspace lanes backed by local records</h2>
          </div>
          <SourceBadge sourceKind="real" label="Real files where possible" />
        </div>
        {selectedTask && taskContext?.projects.length ? <RelatedContextPanel title="Projects linked to selected task" subtitle={selectedTask.title} items={taskContext.projects.map((project) => project.name)} className="mb-4" /> : null}
        <div className="grid gap-4 lg:grid-cols-2">
          {projects.map((project) => (
            <KnowledgeCard
              key={project.id}
              title={project.name}
              eyebrow={project.lane}
              summary={project.summary}
              detail={project.detail}
              sourceKind={project.sourceKind}
              updatedLabel={project.updatedLabel}
              evidence={project.evidence}
              metrics={project.metrics}
              tags={project.tags}
              status={<ProjectStatusPill status={project.status} />}
              highlighted={Boolean(taskContext?.projects.some((item) => item.id === project.id))}
            />
          ))}
        </div>
      </div>
      <aside className="space-y-4">
        <SummaryPanel
          title="Coverage"
          items={[
            `${active.length} active project card(s)`,
            `${watching.length} watching lane(s) with pending or waiting language`,
            'Evidence comes from SESSION_LOG.md, README, package.json, and vault project notes',
          ]}
        />
        <SurfaceJumpPanel selectedTask={selectedTask} onNavigate={onNavigate} targets={['task-board', 'docs', 'memories']} />
      </aside>
    </section>
  )
}

function MemoriesSurface({ memories, selectedTask, taskContext, onNavigate }: { memories: OpenLabMemoryCard[]; selectedTask?: OpenLabTask; taskContext: TaskContext | null; onNavigate: (surface: Surface) => void }) {
  const recent = memories.filter((memory) => memory.sourceKind === 'real').length

  return (
    <section className="grid h-full min-h-[640px] gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="panel p-4">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Memories</p>
            <h2 className="text-lg font-semibold">Long-term memory, daily notes, incidents, and vault traces</h2>
          </div>
          <SourceBadge sourceKind="real" label="File-backed" />
        </div>
        {selectedTask && taskContext?.memories.length ? <RelatedContextPanel title="Memory traces linked to selected task" subtitle={selectedTask.title} items={taskContext.memories.map((memory) => memory.title)} className="mb-4" /> : null}
        <div className="grid gap-4 lg:grid-cols-2">
          {memories.map((memory) => (
            <KnowledgeCard
              key={memory.id}
              title={memory.title}
              eyebrow={memory.kind}
              summary={memory.summary}
              detail={memory.detail}
              sourceKind={memory.sourceKind}
              updatedLabel={memory.updatedLabel}
              evidence={memory.evidence}
              tags={memory.tags}
              highlighted={Boolean(taskContext?.memories.some((item) => item.id === memory.id))}
            />
          ))}
        </div>
      </div>
      <aside className="space-y-4">
        <SummaryPanel
          title="Memory split"
          items={[
            `${recent} real memory card(s) loaded`,
            'MEMORY.md and memory/*.md are read directly',
            'Vault notes are shown separately from core memory so provenance stays clear',
          ]}
        />
        <SurfaceJumpPanel selectedTask={selectedTask} onNavigate={onNavigate} targets={['task-board', 'projects', 'docs']} />
      </aside>
    </section>
  )
}

function DocsSurface({ docs, selectedTask, taskContext, onNavigate }: { docs: OpenLabDocCard[]; selectedTask?: OpenLabTask; taskContext: TaskContext | null; onNavigate: (surface: Surface) => void }) {
  const sections = Array.from(new Set(docs.map((doc) => doc.section)))

  return (
    <section className="grid h-full min-h-[640px] gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="panel p-4">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Docs</p>
            <h2 className="text-lg font-semibold">Runbooks, references, audits, and workspace docs</h2>
          </div>
          <SourceBadge sourceKind="real" label="Read-only markdown index" />
        </div>
        {selectedTask && taskContext?.docs.length ? <RelatedContextPanel title="Docs linked to selected task" subtitle={selectedTask.title} items={taskContext.docs.map((doc) => doc.title)} className="mb-4" /> : null}
        <div className="grid gap-4 lg:grid-cols-2">
          {docs.map((doc) => (
            <KnowledgeCard
              key={doc.id}
              title={doc.title}
              eyebrow={doc.section}
              summary={doc.summary}
              detail={doc.detail}
              sourceKind={doc.sourceKind}
              updatedLabel={doc.updatedLabel}
              evidence={doc.evidence}
              tags={[doc.pathLabel, ...doc.tags].slice(0, 4)}
              highlighted={Boolean(taskContext?.docs.some((item) => item.id === doc.id))}
            />
          ))}
        </div>
      </div>
      <aside className="space-y-4">
        <SummaryPanel
          title="Doc sources"
          items={[
            `${sections.length} doc section(s) represented`,
            'Workspace docs and vault references are mixed, but each card keeps its path label',
            'No mutation actions yet, this surface is browse-only',
          ]}
        />
        <SurfaceJumpPanel selectedTask={selectedTask} onNavigate={onNavigate} targets={['task-board', 'projects', 'memories', 'calendar']} />
      </aside>
    </section>
  )
}

function AgentsSurface({ agents }: { agents: OpenLabAgentCard[] }) {
  return (
    <section className="grid h-full min-h-[640px] gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="panel p-4">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Team / Agents</p>
            <h2 className="text-lg font-semibold">Known actors and their current state</h2>
          </div>
          <div className="rounded-full border border-border bg-surface-1 px-3 py-1 text-xs text-muted-foreground">Mixed live + manual evidence</div>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {agents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} />
          ))}
        </div>
      </div>
      <aside className="space-y-4">
        <div className="panel p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Coverage</p>
          <h3 className="mt-2 text-base font-semibold">What is feasible today</h3>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li>Saemord, subagents, Hermes, and cron runners are backed by local runtime files.</li>
            <li>WarmTea is included as a manual actor, not a tracked process.</li>
            <li>This surface stays read-only and does not control any agent.</li>
          </ul>
        </div>
      </aside>
    </section>
  )
}

function KnowledgeCard({
  title,
  eyebrow,
  summary,
  detail,
  sourceKind,
  updatedLabel,
  evidence,
  tags,
  metrics,
  status,
  highlighted,
}: {
  title: string
  eyebrow: string
  summary: string
  detail: string
  sourceKind: OpenLabSourceKind
  updatedLabel: string
  evidence: string[]
  tags: string[]
  metrics?: OpenLabMetric[]
  status?: ReactNode
  highlighted?: boolean
}) {
  return (
    <article className={cn('rounded-2xl border bg-card/90 p-4 shadow-panel', highlighted ? 'border-primary/50 ring-1 ring-primary/20' : 'border-border')}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{eyebrow}</p>
          <h3 className="mt-2 text-base font-semibold">{title}</h3>
        </div>
        <div className="flex flex-col items-end gap-2">
          {status}
          <SourceBadge sourceKind={sourceKind} />
        </div>
      </div>
      <p className="mt-4 text-sm leading-6 text-foreground/90">{summary}</p>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{detail}</p>
      {metrics?.length ? <div className="mt-4 grid gap-2 sm:grid-cols-3">{metrics.map((metric) => <MetricCard key={`${title}-${metric.label}`} label={metric.label} value={metric.value} compact />)}</div> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <Tag>{updatedLabel}</Tag>
        {evidence.slice(0, 2).map((item) => <Tag key={item}>{item}</Tag>)}
        {tags.slice(0, 3).map((tag) => <Tag key={tag}>{tag}</Tag>)}
      </div>
    </article>
  )
}

function ToolProposalCard({ proposal }: { proposal: OpenLabToolProposal }) {
  return (
    <article className="rounded-2xl border border-border bg-card/90 p-4 shadow-panel">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{proposal.kind}</p>
          <h3 className="mt-2 text-base font-semibold">{proposal.name}</h3>
        </div>
        <ProposalReadinessPill readiness={proposal.readiness} />
      </div>
      <p className="mt-4 text-sm text-foreground/90">{proposal.summary}</p>
      <p className="mt-2 text-sm text-muted-foreground">{proposal.operatorValue}</p>
      <div className="mt-4 rounded-2xl border border-border bg-surface-1/80 p-4">
        <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Why now</div>
        <div className="mt-2 text-sm text-muted-foreground">{proposal.rationale}</div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <ProposalList title="Recommended inputs" items={proposal.recommendedInputs} />
        <ProposalList title="Data sources" items={proposal.dataSources} />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {proposal.relatedSurfaces.map((item) => <Tag key={item}>{item}</Tag>)}
      </div>
      <div className="mt-4 rounded-xl border border-border bg-surface-1/80 px-3 py-3 text-sm text-muted-foreground">Next step: {proposal.nextStep}</div>
    </article>
  )
}

function ProposalList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-2xl border border-border bg-surface-1/80 p-4">
      <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{title}</div>
      <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </div>
  )
}

function SummaryPanel({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="panel p-4">
      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{title}</p>
      <h3 className="mt-2 text-base font-semibold">Local evidence summary</h3>
      <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </div>
  )
}

function RelatedContextPanel({ title, subtitle, items, className }: { title: string; subtitle: string; items: string[]; className?: string }) {
  return (
    <div className={cn('rounded-2xl border border-primary/30 bg-primary/5 p-4', className)}>
      <p className="text-xs uppercase tracking-[0.2em] text-primary">{title}</p>
      <h3 className="mt-2 text-base font-semibold">{subtitle}</h3>
      <div className="mt-3 flex flex-wrap gap-2">
        {items.map((item) => <Tag key={item}>{item}</Tag>)}
      </div>
    </div>
  )
}

function SurfaceJumpPanel({ selectedTask, onNavigate, targets }: { selectedTask?: OpenLabTask; onNavigate: (surface: Surface) => void; targets: Surface[] }) {
  return (
    <div className="panel p-4">
      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Cross-surface nav</p>
      <h3 className="mt-2 text-base font-semibold">{selectedTask ? 'Keep task focus' : 'Jump between surfaces'}</h3>
      <p className="mt-2 text-sm text-muted-foreground">{selectedTask ? `Selected task stays pinned as you move: ${selectedTask.title}` : 'Choose a task on the board first for linked navigation.'}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {targets.map((target) => (
          <Button key={target} variant="outline" size="sm" onClick={() => onNavigate(target)}>{surfaceLabel(target)}</Button>
        ))}
      </div>
    </div>
  )
}

function ContextListCard({ title, items, emptyLabel }: { title: string; items: string[]; emptyLabel: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card px-3 py-3">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{title}</p>
      <div className="mt-3 space-y-2 text-sm text-muted-foreground">
        {items.length ? items.map((item) => <div key={item}>{item}</div>) : <div>{emptyLabel}</div>}
      </div>
    </div>
  )
}

function RailButton({ label, active, disabled, onClick, icon }: { label: string; active?: boolean; disabled?: boolean; onClick?: () => void; icon: ReactNode }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex w-full flex-col items-center gap-1 rounded-2xl px-2 py-3 text-[11px] text-muted-foreground transition-colors',
        active && 'bg-primary/12 text-primary',
        !disabled && !active && 'hover:bg-secondary hover:text-foreground',
        disabled && 'cursor-not-allowed opacity-40',
      )}
    >
      <span className="flex h-5 w-5 items-center justify-center">{icon}</span>
      <span>{label}</span>
    </button>
  )
}

function CompactStatCard({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: 'healthy' | 'warning' | 'neutral' }) {
  const toneClasses = {
    healthy: 'border-emerald-500/20 bg-emerald-500/5 text-emerald-300',
    warning: 'border-amber-500/20 bg-amber-500/5 text-amber-300',
    neutral: 'border-border bg-card text-foreground',
  }[tone]

  return (
    <div className={cn('panel p-4', toneClasses)}>
      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{label}</p>
      <div className="mt-3 text-3xl font-semibold">{value}</div>
      <p className="mt-2 text-sm text-muted-foreground">{detail}</p>
    </div>
  )
}

function MonitorCard({ card }: { card: OpenLabMonitorCard }) {
  return (
    <article className="rounded-2xl border border-border bg-card/90 p-4 shadow-panel">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{card.title}</p>
          <h3 className="mt-2 text-base font-semibold">{card.summary}</h3>
        </div>
        <HealthBadge status={card.status} />
      </div>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">{card.detail}</p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {card.metrics.map((metric) => (
          <MetricCard key={`${card.id}-${metric.label}`} label={metric.label} value={metric.value} compact />
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {card.evidence.map((item) => (
          <Tag key={`${card.id}-${item}`}>{item}</Tag>
        ))}
      </div>
    </article>
  )
}

function AgentCard({ agent }: { agent: OpenLabAgentCard }) {
  return (
    <article className="rounded-2xl border border-border bg-card/90 p-4 shadow-panel">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{agent.team}</p>
          <h3 className="mt-2 text-base font-semibold">{agent.name}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{agent.role}</p>
        </div>
        <AgentStatusBadge status={agent.status} />
      </div>
      <p className="mt-4 text-sm leading-6 text-foreground/90">{agent.summary}</p>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{agent.detail}</p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {agent.metrics.map((metric) => (
          <MetricCard key={`${agent.id}-${metric.label}`} label={metric.label} value={metric.value} compact />
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Tag>{agent.evidenceMode}</Tag>
        {agent.lastSeen ? <Tag>{agent.lastSeen}</Tag> : null}
        {agent.channel ? <Tag>{agent.channel}</Tag> : null}
      </div>
    </article>
  )
}

function AlertRow({ alert }: { alert: OpenLabAlert }) {
  const tone = {
    info: 'border-blue-500/25 bg-blue-500/8 text-blue-200',
    warning: 'border-amber-500/25 bg-amber-500/8 text-amber-100',
    critical: 'border-rose-500/25 bg-rose-500/8 text-rose-100',
  }[alert.level]

  return (
    <div className={cn('rounded-xl border px-3 py-3', tone)}>
      <div className="flex items-center justify-between gap-2 text-xs uppercase tracking-[0.16em]">
        <span>{alert.source}</span>
        <span>{alert.timeLabel}</span>
      </div>
      <div className="mt-2 text-sm font-semibold">{alert.title}</div>
      <div className="mt-1 text-sm opacity-85">{alert.detail}</div>
      <div className="mt-2 text-[11px] uppercase tracking-[0.14em] opacity-60">{alert.live ? 'live evidence' : 'incident note'}</div>
    </div>
  )
}

function HealthBadge({ status }: { status: OpenLabHealthStatus }) {
  const classes = {
    healthy: 'bg-emerald-500/15 text-emerald-300',
    warning: 'bg-amber-500/15 text-amber-300',
    critical: 'bg-rose-500/15 text-rose-300',
    offline: 'bg-slate-500/15 text-slate-300',
    placeholder: 'bg-violet-500/15 text-violet-300',
  }[status]

  return <span className={cn('rounded-full px-2 py-1 text-[11px] font-medium capitalize', classes)}>{status}</span>
}

function AgentStatusBadge({ status }: { status: OpenLabAgentCard['status'] }) {
  const classes = {
    active: 'bg-emerald-500/15 text-emerald-300',
    monitoring: 'bg-blue-500/15 text-blue-300',
    idle: 'bg-slate-500/15 text-slate-300',
    attention: 'bg-rose-500/15 text-rose-300',
    manual: 'bg-violet-500/15 text-violet-300',
  }[status]

  return <span className={cn('rounded-full px-2 py-1 text-[11px] font-medium capitalize', classes)}>{status}</span>
}

function ProposalReadinessPill({ readiness }: { readiness: OpenLabToolProposal['readiness'] }) {
  const classes = {
    ready: 'bg-emerald-500/15 text-emerald-300',
    candidate: 'bg-blue-500/15 text-blue-300',
    placeholder: 'bg-violet-500/15 text-violet-300',
  }[readiness]

  return <span className={cn('rounded-full px-2 py-1 text-[11px] font-medium capitalize', classes)}>{readiness}</span>
}

function TonePill({ tone, children }: { tone: 'neutral' | 'good' | 'warn' | 'bad'; children: ReactNode }) {
  const classes = {
    neutral: 'bg-slate-500/15 text-slate-300',
    good: 'bg-emerald-500/15 text-emerald-300',
    warn: 'bg-amber-500/15 text-amber-300',
    bad: 'bg-rose-500/15 text-rose-300',
  }[tone]

  return <span className={cn('rounded-full px-2 py-1 text-[11px] font-medium', classes)}>{children}</span>
}

function OfficeSeatBadge({ status }: { status: OpenLabOfficeSnapshot['seats'][number]['status'] }) {
  const classes = {
    active: 'bg-emerald-500/15 text-emerald-300',
    focus: 'bg-blue-500/15 text-blue-300',
    watching: 'bg-amber-500/15 text-amber-300',
    offline: 'bg-slate-500/15 text-slate-300',
  }[status]

  return <span className={cn('rounded-full px-2 py-1 text-[11px] font-medium capitalize', classes)}>{status}</span>
}

function MetricCard({ label, value, compact }: { label: string; value: string; compact?: boolean }) {
  return (
    <div className={cn('rounded-2xl border border-border bg-surface-1/80 px-3 py-3', compact && 'rounded-xl')}>
      <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="mt-2 text-sm font-medium">{value}</div>
    </div>
  )
}

function TaskEventRow({ event }: { event: OpenLabTaskEvent }) {
  const tone = {
    neutral: 'border-border text-foreground',
    good: 'border-emerald-500/30 text-emerald-300',
    warn: 'border-amber-500/30 text-amber-300',
    bad: 'border-rose-500/30 text-rose-300',
  }[event.tone ?? 'neutral']

  return (
    <div className="flex items-start gap-3">
      <span className={cn('mt-1 h-2.5 w-2.5 rounded-full border bg-transparent', tone)} />
      <div className="min-w-0">
        <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{event.label}</div>
        <div className="mt-1 break-words text-sm text-foreground/90">{event.value}</div>
      </div>
    </div>
  )
}

function PriorityPill({ priority }: { priority: OpenLabTask['priority'] }) {
  const classes = {
    low: 'bg-emerald-500/15 text-emerald-300',
    medium: 'bg-blue-500/15 text-blue-300',
    high: 'bg-amber-500/15 text-amber-300',
    urgent: 'bg-rose-500/15 text-rose-300',
  }[priority]

  return <span className={cn('rounded-full px-2 py-1 text-[11px] font-medium', classes)}>{priority}</span>
}

function ProjectStatusPill({ status }: { status: OpenLabProjectCard['status'] }) {
  const classes = {
    active: 'bg-emerald-500/15 text-emerald-300',
    watching: 'bg-amber-500/15 text-amber-300',
    archived: 'bg-slate-500/15 text-slate-300',
  }[status]

  return <span className={cn('rounded-full px-2 py-1 text-[11px] font-medium capitalize', classes)}>{status}</span>
}

function SourceBadge({ sourceKind, label }: { sourceKind: OpenLabSourceKind; label?: string }) {
  const classes = {
    live: 'bg-emerald-500/15 text-emerald-300',
    real: 'bg-blue-500/15 text-blue-300',
    inferred: 'bg-amber-500/15 text-amber-300',
    placeholder: 'bg-violet-500/15 text-violet-300',
  }[sourceKind]

  return <span className={cn('rounded-full px-2 py-1 text-[11px] font-medium capitalize', classes)}>{label ?? sourceKind}</span>
}

function Tag({ children }: { children: ReactNode }) {
  return <span className="rounded-full border border-border bg-surface-1 px-2 py-1 text-[11px] text-muted-foreground">{children}</span>
}

function SourcePill({ source, system }: { source: OpenLabCalendarItem['source']; system?: OpenLabCalendarItem['system'] }) {
  const styles = {
    calendar: 'bg-blue-500/15 text-blue-300',
    cron: system === 'hermes' ? 'bg-violet-500/15 text-violet-300' : 'bg-emerald-500/15 text-emerald-300',
    task: 'bg-emerald-500/15 text-emerald-300',
  }[source]

  return <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium uppercase', styles)}>{system ?? source}</span>
}

function isSurface(value: string | null): value is Surface {
  return Boolean(value && ['task-board', 'calendar', 'agents', 'pulse', 'projects', 'memories', 'docs', 'office', 'tools'].includes(value))
}

function surfaceLabel(surface: Surface) {
  return {
    'task-board': 'Board',
    calendar: 'Calendar',
    projects: 'Projects',
    memories: 'Memory',
    docs: 'Docs',
    pulse: 'Pulse',
    office: 'Office',
    tools: 'Tools',
    agents: 'Agents',
  }[surface]
}

function getRefreshCadenceSeconds(surface: Surface) {
  if (surface === 'pulse' || surface === 'office') return 5
  if (surface === 'task-board' || surface === 'calendar' || surface === 'agents') return 10
  return 20
}

function formatSyncLabel(lastSuccessAt: number) {
  const deltaSeconds = Math.max(0, Math.round((Date.now() - lastSuccessAt) / 1000))
  if (deltaSeconds < 2) return 'synced just now'
  if (deltaSeconds < 60) return `synced ${deltaSeconds}s ago`
  const minutes = Math.round(deltaSeconds / 60)
  return `synced ${minutes}m ago`
}

function formatDataAgeLabel(generatedAt: string) {
  const deltaSeconds = Math.max(0, Math.round((Date.now() - Date.parse(generatedAt)) / 1000))
  if (deltaSeconds < 2) return 'just now'
  if (deltaSeconds < 60) return `${deltaSeconds}s ago`
  const minutes = Math.round(deltaSeconds / 60)
  return `${minutes}m ago`
}

function buildTaskContext(task: OpenLabTask, snapshot: OpenLabSnapshot): TaskContext {
  const terms = buildTaskTerms(task)

  return {
    projects: snapshot.projects.filter((project) => matchesTaskTerms(project.name, project.summary, project.detail, project.tags, terms)).slice(0, 3),
    memories: snapshot.memories.filter((memory) => matchesTaskTerms(memory.title, memory.summary, memory.detail, memory.tags, terms)).slice(0, 3),
    docs: snapshot.docs.filter((doc) => matchesTaskTerms(doc.title, doc.summary, doc.detail, doc.tags, terms)).slice(0, 3),
    calendarItems: snapshot.calendarItems.filter((item) => matchesTaskTerms(item.title, item.detail, item.lane, compact([item.source, item.system]), terms)).slice(0, 3),
  }
}

function buildTaskTerms(task: OpenLabTask) {
  return Array.from(new Set(compact([
    task.title,
    task.team,
    task.owner,
    task.summary,
    ...(task.tags ?? []),
  ]).flatMap((value) => value.toLowerCase().split(/[^a-z0-9]+/)).filter((term) => term.length >= 4)))
}

function matchesTaskTerms(...valuesAndTerms: Array<string | string[] | undefined>) {
  const terms = valuesAndTerms.at(-1)
  const values = valuesAndTerms.slice(0, -1)
  if (!Array.isArray(terms) || terms.length === 0) return false
  const haystack = values.flatMap((value) => Array.isArray(value) ? value : [value]).filter(Boolean).join(' ').toLowerCase()
  return terms.some((term) => haystack.includes(term))
}

function compact<T>(items: Array<T | null | undefined | false>) {
  return items.filter(Boolean) as T[]
}

function groupTasksByColumn(tasks: OpenLabTask[]) {
  return {
    backlog: tasks.filter((task) => task.status === 'backlog'),
    planned: tasks.filter((task) => task.status === 'planned'),
    in_progress: tasks.filter((task) => task.status === 'in_progress'),
    review: tasks.filter((task) => task.status === 'review'),
    done: tasks.filter((task) => task.status === 'done'),
  }
}

function buildCalendarDays(items: OpenLabCalendarItem[]) {
  const dates = Array.from(new Set(items.map((item) => item.date))).sort().slice(0, 4)
  return dates.map((date) => ({
    date,
    label: new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' }),
  }))
}

function labelizeStatus(status: OpenLabTask['status']) {
  return status.replace('_', ' ')
}

function BoardIcon() {
  return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="3" width="3" height="10" rx="1" /><rect x="6.5" y="3" width="3" height="6" rx="1" /><rect x="11" y="3" width="3" height="8" rx="1" /></svg>
}

function CalendarIcon() {
  return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="3" width="12" height="11" rx="1.5" /><path d="M2 6.5h12M5 1.5v3M11 1.5v3" /></svg>
}

function ProjectsIcon() {
  return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2.5 5.5h5l1 1h5v6.5H2.5z" /><path d="M2.5 5.5V3.5h4l1 1h2" /></svg>
}

function MemoryIcon() {
  return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 2.5h8a1 1 0 0 1 1 1v9.5l-2-1-2 1-2-1-2 1-2-1V3.5a1 1 0 0 1 1-1z" /><path d="M5.5 5.5h5M5.5 8h5" /></svg>
}

function DocsIcon() {
  return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 2.5h5l3 3V13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-9.5a1 1 0 0 1 1-1z" /><path d="M9 2.5V6h3" /></svg>
}

function AgentsIcon() {
  return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="5" r="2.5" /><path d="M3 13c.6-2.3 2.5-3.5 5-3.5s4.4 1.2 5 3.5" /></svg>
}

function OfficeIcon() {
  return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2.5 13.5h11" /><path d="M3.5 13.5v-8l4.5-2 4.5 2v8" /><path d="M6 13.5V9.5h4v4" /></svg>
}

function ToolboxIcon() {
  return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2.5 6.5h11v6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z" /><path d="M6 6.5V4.75A1.25 1.25 0 0 1 7.25 3.5h1.5A1.25 1.25 0 0 1 10 4.75V6.5" /><path d="M2.5 9h11" /></svg>
}

function PulseIcon() {
  return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M1.5 8h3l1.2-3 2.2 6 2-4H14.5" /></svg>
}
