import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
} from 'lucide-react';
import {
  INBOX_LINE_ID,
  materializeAutoTasksForCycle,
  railAtDate,
  useStore,
  type EditSession,
} from '@dayrail/core';
import type { TemplateKey } from '@/data/sampleTemplate';
import { CycleSummaryStrip } from '@/components/CycleSummaryStrip';
import {
  CycleSection,
  type TemplateChoice,
} from '@/components/CycleSection';
import { EditSessionIndicator } from '@/components/EditSessionIndicator';
import { ReasonToast } from '@/components/ReasonToast';
import { useReasonToast } from '@/components/useReasonToast';
import { TaskDetailDrawer } from './Tasks';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/primitives/Popover';
import { clsx } from 'clsx';
import type { CycleDay, CycleSlot } from '@/data/sampleCycle';
import type { RailColor } from '@/data/sample';
import {
  deriveCycleFromStore,
  startOfWeekMonday,
  toIsoDate,
} from './cycleFromStore';
import {
  cycleLabel,
  cycleRangeLabel,
  enumerateCycles,
} from './cycleNotation';

// ERD §5.3 Cycle View, v0.3 with a real Edit Session (§5.3.1).
// Every mutation from this page (drag-drop, template override, slot
// clear, quick-create, mark-done) is tagged with the view's sessionId
// so "⤺ 撤销本次编辑" rolls back the whole batch in one step.

export function CycleView() {
  const navigate = useNavigate();
  const [anchorDate, setAnchorDate] = useState<Date>(() => new Date());
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  // Drag-hover key shared across all CycleSection instances. Lifted
  // here so dragging a task across a section boundary doesn't strand
  // the previous section's highlight — only one cell + rail glows at
  // a time across the whole grid. Format: `${railId}|${date}`.
  const [dragHoverKey, setDragHoverKey] = useState<string | null>(null);
  useEffect(() => {
    const clear = () => setDragHoverKey(null);
    // capture-phase drop so we clear before any per-cell drop handler
    // mutates state, mirroring the pre-lift behavior.
    window.addEventListener('dragend', clear);
    window.addEventListener('drop', clear, true);
    return () => {
      window.removeEventListener('dragend', clear);
      window.removeEventListener('drop', clear, true);
    };
  }, []);

  const templates = useStore((s) => s.templates);
  const rails = useStore((s) => s.rails);
  const railRevisions = useStore((s) => s.railRevisions);
  const railTombstones = useStore((s) => s.railTombstones);
  const tasks = useStore((s) => s.tasks);
  const lines = useStore((s) => s.lines);
  const calendarRules = useStore((s) => s.calendarRules);
  const calendarRuleRevisions = useStore((s) => s.calendarRuleRevisions);
  const calendarRuleTombstones = useStore((s) => s.calendarRuleTombstones);
  const scheduleTaskToRail = useStore((s) => s.scheduleTaskToRail);
  const setSlotTaskOrder = useStore((s) => s.setSlotTaskOrder);
  const unscheduleTask = useStore((s) => s.unscheduleTask);
  const overrideCycleDay = useStore((s) => s.overrideCycleDay);
  const clearCycleDayOverride = useStore((s) => s.clearCycleDayOverride);
  const createTask = useStore((s) => s.createTask);
  const updateTask = useStore((s) => s.updateTask);
  const openEditSession = useStore((s) => s.openEditSession);
  const closeEditSession = useStore((s) => s.closeEditSession);
  const undoEditSessionAction = useStore((s) => s.undoEditSession);
  const storedCycles = useStore((s) => s.cycles);
  const upsertCycle = useStore((s) => s.upsertCycle);
  const removeCycle = useStore((s) => s.removeCycle);
  const reflections = useStore((s) => s.reflections);

  // --- session bookkeeping (ERD §5.3.1) ---
  const [sessionId, setSessionId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    let openedId: string | null = null;
    openEditSession('cycle-planner').then((s: EditSession) => {
      if (cancelled) {
        void closeEditSession(s.id);
        return;
      }
      openedId = s.id;
      setSessionId(s.id);
    });
    return () => {
      cancelled = true;
      if (openedId) void closeEditSession(openedId);
    };
  }, [openEditSession, closeEditSession]);
  const session = useStore((s) =>
    sessionId ? s.sessions[sessionId] : undefined,
  );
  const changeCount = session?.changeCount ?? 0;

  const weekStart = useMemo(() => startOfWeekMonday(anchorDate), [anchorDate]);

  // §10.2 trigger point "Cycle View 打开 / 切换 cycle". Materialize the
  // visible Monday-anchored 7-day window so habit auto-tasks appear
  // in the grid. Idempotent — safe to run on every anchor change.
  useEffect(() => {
    const mondayIso = toIsoDate(weekStart);
    void materializeAutoTasksForCycle(mondayIso);
  }, [weekStart]);

  const { cycle, railsByTemplate, offRailByDate } = useMemo(
    () =>
      deriveCycleFromStore(
        {
          templates,
          rails,
          railRevisions,
          railTombstones,
          tasks,
          lines,
          calendarRules,
          calendarRuleRevisions,
          calendarRuleTombstones,
        },
        weekStart,
      ),
    [
      templates,
      rails,
      railRevisions,
      railTombstones,
      tasks,
      lines,
      calendarRules,
      calendarRuleRevisions,
      calendarRuleTombstones,
      weekStart,
    ],
  );

  const todayISO = toIsoDate(new Date());

  // Set of dates in the visible cycle that already have a reflection.
  // Subscribed as a raw map (per the project's "no fresh array/object
  // from useStore selectors" rule) and reduced via useMemo so the
  // child only re-renders when membership actually changes.
  const reflectedDates = useMemo(() => {
    const set = new Set<string>();
    for (const day of cycle.days) {
      if (reflections[day.date]) set.add(day.date);
    }
    return set;
  }, [cycle.days, reflections]);

  const handleOpenReflection = useCallback(
    (date: string) => {
      navigate(`/review/day/${date}`);
    },
    [navigate],
  );

  const templateChoices = useMemo<TemplateChoice[]>(
    () =>
      Object.values(templates).map((t) => ({
        key: t.key,
        label: t.name,
        color: (t.color ?? 'slate') as RailColor,
      })),
    [templates],
  );

  // Switch the day's template. Tasks scheduled to rails that don't
  // belong to the new template aren't unscheduled — they surface in
  // the Cycle section's Off-rail row, where the user can drag them
  // back onto any rail. The previous confirm-and-unschedule flow was
  // destructive (the task lost its date intent on cancel-and-redo),
  // so we let the rendering layer handle the "no rail to land on"
  // case instead.
  const overrideDay = useCallback(
    (date: string, nextTemplate: TemplateKey) => {
      void overrideCycleDay(date, nextTemplate, sessionId ?? undefined);
    },
    [overrideCycleDay, sessionId],
  );

  const clearOverride = useCallback(
    (date: string) => {
      void clearCycleDayOverride(date, sessionId ?? undefined);
    },
    [clearCycleDayOverride, sessionId],
  );

  // Group days into contiguous runs of the same template. A sequence
  // like A → B → C → A produces four sections (the trailing A is its
  // own section, not folded back into the leading A) — top-to-bottom
  // reading order matches the calendar, which is what users expect
  // when scanning a week.
  const groups = useMemo(() => {
    const sections: { key: string; templateKey: TemplateKey; days: CycleDay[] }[] = [];
    for (const d of cycle.days) {
      const last = sections[sections.length - 1];
      if (last && last.templateKey === d.templateKey) {
        last.days.push(d);
      } else {
        // Section keys must be unique even when a template repeats —
        // anchor on the section's first date to disambiguate.
        sections.push({
          key: `${d.templateKey || 'untemplated'}|${d.date}`,
          templateKey: d.templateKey,
          days: [d],
        });
      }
    }
    return sections;
  }, [cycle]);

  const slotMap = useMemo(() => {
    const m = new Map<string, CycleSlot>();
    for (const s of cycle.slots) m.set(`${s.railId}|${s.date}`, s);
    return m;
  }, [cycle]);

  const handleDropTask = useCallback(
    (taskId: string, date: string, railId: string) => {
      // No-op if the task was dragged back onto its own (date, rail) —
      // scheduleTaskToRail would still write a redundant task.scheduled
      // event otherwise, which pads the Edit-Session change count for
      // no user-visible effect.
      const existing = tasks[taskId]?.slot;
      if (
        existing &&
        existing.date === date &&
        existing.railId === railId
      ) {
        return;
      }
      void scheduleTaskToRail(
        taskId,
        { cycleId: `cycle-${date}`, date, railId },
        sessionId ?? undefined,
      );
    },
    [scheduleTaskToRail, sessionId, tasks],
  );

  const handleDropTaskAt = useCallback(
    async (
      taskId: string,
      date: string,
      railId: string,
      orderedTaskIds: string[],
    ) => {
      // Same-slot reorder: just persist the new order.
      // Cross-slot: schedule first (so the dragged task's `slot`
      // points at the destination), then persist the order.
      const existing = tasks[taskId]?.slot;
      const sameSlot =
        existing && existing.date === date && existing.railId === railId;
      const slot = {
        cycleId: existing?.cycleId ?? `cycle-${date}`,
        date,
        railId,
      };
      if (!sameSlot) {
        await scheduleTaskToRail(taskId, slot, sessionId ?? undefined);
      }
      await setSlotTaskOrder(slot, orderedTaskIds, sessionId ?? undefined);
    },
    [scheduleTaskToRail, setSlotTaskOrder, sessionId, tasks],
  );

  const handleClearSlot = useCallback(
    (taskId: string) => {
      void unscheduleTask(taskId, sessionId ?? undefined);
    },
    [unscheduleTask, sessionId],
  );

  const { toast, fire, handleAddTag, handleUndo, handleClose } = useReasonToast(
    'pending-queue',
  );

  const handleMarkTaskDone = useCallback(
    (taskId: string) => {
      const task = tasks[taskId];
      if (!task) return;
      const railRev = task.slot
        ? railAtDate(
            { railRevisions, railTombstones },
            task.slot.railId,
            task.slot.date,
          )
        : undefined;
      fire({
        taskId,
        ...(railRev && { railId: railRev.railId }),
        displayName: railRev?.name ?? task.title,
        ...(sessionId && { sessionId }),
        action: 'done',
      });
    },
    [tasks, railRevisions, railTombstones, fire, sessionId],
  );

  const handleSetTaskPriority = useCallback(
    (taskId: string, priority: import('@dayrail/core').TaskPriority | null) => {
      // `priority: undefined` in a Partial<Task> patch means "clear it".
      // Upstream reducer spreads the patch into the task verbatim.
      void updateTask(
        taskId,
        { priority: priority ?? undefined },
        sessionId ?? undefined,
      );
    },
    [updateTask, sessionId],
  );

  const handleUndoTaskDone = useCallback(
    (taskId: string) => {
      // Going through updateTask (not a dedicated event) so the flip
      // is tagged with the Cycle-View edit session — users can still
      // wrap a misclick into the session undo. `doneAt: undefined`
      // clears the completion stamp; status → pending is the only
      // sane landing for "nope, not done".
      void updateTask(
        taskId,
        { status: 'pending', doneAt: undefined },
        sessionId ?? undefined,
      );
    },
    [updateTask, sessionId],
  );

  const handleArchiveTask = useCallback(
    (taskId: string) => {
      // Same reasoning as handleUndoTaskDone — updateTask keeps the
      // mutation inside the session rather than the store's dedicated
      // `archiveTask` action (which writes a `task.archived` event
      // without sessionId).
      void updateTask(
        taskId,
        { status: 'archived', archivedAt: new Date().toISOString() },
        sessionId ?? undefined,
      );
    },
    [updateTask, sessionId],
  );

  const handleUnarchiveTask = useCallback(
    (taskId: string) => {
      // Restores an archived task back to pending. Clears archivedAt
      // so the task re-enters the normal flow (Backlog / Cycle pill).
      // Session-tagged for symmetry with archive.
      void updateTask(
        taskId,
        { status: 'pending', archivedAt: undefined },
        sessionId ?? undefined,
      );
    },
    [updateTask, sessionId],
  );

  const handleToggleSubItem = useCallback(
    (taskId: string, subItemId: string) => {
      const task = tasks[taskId];
      const items = task?.subItems;
      if (!items || items.length === 0) return;
      const next = items.map((it) =>
        it.id === subItemId ? { ...it, done: !it.done } : it,
      );
      void updateTask(taskId, { subItems: next }, sessionId ?? undefined);
    },
    [tasks, updateTask, sessionId],
  );

  const handleOpenTaskProject = useCallback(
    (taskId: string) => {
      const task = tasks[taskId];
      if (!task) return;
      // Inbox is its own nav entry in the Tasks view, so route it
      // specifically; everything else goes to /tasks/line/:lineId.
      const target =
        task.lineId === INBOX_LINE_ID
          ? '/tasks/inbox'
          : `/tasks/line/${task.lineId}`;
      navigate(target);
    },
    [navigate, tasks],
  );

  const lineLookup = useCallback(
    (taskId: string) => {
      const task = tasks[taskId];
      if (!task) return undefined;
      const line = lines[task.lineId];
      if (!line) return undefined;
      return { name: line.name, color: line.color };
    },
    [tasks, lines],
  );

  const handleQuickCreate = useCallback(
    (date: string, railId: string, title: string) => {
      // v0.4: `Rail.defaultLineId` removed. Quick-created tasks land
      // in Inbox; the user can re-home via the task detail drawer.
      void rails;
      const lineId = INBOX_LINE_ID;
      const maxOrder = Object.values(tasks)
        .filter((t) => t.lineId === lineId)
        .reduce((m, t) => Math.max(m, t.order), 0);
      void createTask(
        {
          id: `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          lineId,
          title,
          order: maxOrder + 1,
          status: 'pending',
          slot: { cycleId: `cycle-${date}`, date, railId },
        },
        sessionId ?? undefined,
      );
    },
    [createTask, rails, tasks, sessionId],
  );

  const shiftWeek = useCallback((deltaDays: number) => {
    setAnchorDate((d) => {
      const next = new Date(d);
      next.setDate(next.getDate() + deltaDays);
      return next;
    });
  }, []);

  const handleUndoSession = useCallback(async () => {
    if (!sessionId) return;
    await undoEditSessionAction(sessionId);
    // `undoEditSession` closes the session inside the store. Open a
    // fresh one so any further edits this page-visit get grouped
    // together rather than leaking into "no session".
    const next = await openEditSession('cycle-planner');
    setSessionId(next.id);
  }, [sessionId, undoEditSessionAction, openEditSession]);

  return (
    <div className="flex min-h-screen w-full flex-col px-10 xl:px-14">
      <TopBar
          anchorDate={anchorDate}
          onPrev={() => shiftWeek(-7)}
          onNext={() => shiftWeek(7)}
          onToday={() => setAnchorDate(new Date())}
          onPickCycle={(monday) => setAnchorDate(monday)}
          changeCount={changeCount}
          onUndoSession={handleUndoSession}
          cycles={storedCycles}
          onUpsertCycle={async (startDate, label) => {
            await upsertCycle({ startDate, label });
          }}
          onRemoveCycle={async (id) => {
            await removeCycle(id);
          }}
        />

        <CycleSummaryStrip cycle={cycle} />

        <div className="flex flex-col gap-5 pt-6 pb-16">
          {groups.map(({ key, templateKey, days }) => {
            const tmpl = templateChoices.find((t) => t.key === templateKey);
            const sectionRails = railsByTemplate[templateKey] ?? [];
            return (
              <CycleSection
                key={key}
                templateKey={templateKey}
                templateLabel={tmpl?.label ?? templateKey}
                templateColor={tmpl?.color ?? 'slate'}
                rails={sectionRails}
                days={days}
                slotsByKey={slotMap}
                offRailByDate={offRailByDate}
                dragHoverKey={dragHoverKey}
                onDragHoverKeyChange={setDragHoverKey}
                todayISO={todayISO}
                templateChoices={templateChoices}
                reflectedDates={reflectedDates}
                onOpenReflection={handleOpenReflection}
                onOverride={overrideDay}
                onClearOverride={clearOverride}
                onDropTask={handleDropTask}
                onDropTaskAt={handleDropTaskAt}
                onClearSlot={handleClearSlot}
                onMarkTaskDone={handleMarkTaskDone}
                onUndoTaskDone={handleUndoTaskDone}
                onArchiveTask={handleArchiveTask}
                onUnarchiveTask={handleUnarchiveTask}
                onOpenTaskDetail={(taskId) => setDetailTaskId(taskId)}
                onOpenTaskProject={handleOpenTaskProject}
                onSetTaskPriority={handleSetTaskPriority}
                onToggleSubItem={handleToggleSubItem}
                onQuickCreate={handleQuickCreate}
                lineLookup={lineLookup}
              />
            );
          })}

          {groups.length === 0 && (
            <section className="rounded-md border border-dashed border-hairline/60 bg-surface-1 px-6 py-8 text-sm text-ink-tertiary">
              没有 Template —— 去 Template Editor 建一条，这里会按日期自动分段。
            </section>
          )}

        <CycleFooter cycle={cycle} groupCount={groups.length} />
      </div>

      <ReasonToast
        state={toast}
        onAddTag={handleAddTag}
        onUndo={handleUndo}
        onClose={handleClose}
      />

      {detailTaskId && tasks[detailTaskId] && (
        <TaskDetailDrawer
          task={tasks[detailTaskId]!}
          line={lines[tasks[detailTaskId]!.lineId]}
          onClose={() => setDetailTaskId(null)}
        />
      )}
    </div>
  );
}

function TopBar({
  anchorDate,
  onPrev,
  onNext,
  onToday,
  onPickCycle,
  changeCount,
  onUndoSession,
  cycles,
  onUpsertCycle,
  onRemoveCycle,
}: {
  anchorDate: Date;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onPickCycle: (monday: Date) => void;
  changeCount: number;
  onUndoSession: () => void;
  cycles: Record<string, import('@dayrail/core').Cycle>;
  onUpsertCycle: (startDate: string, label: string) => Promise<void>;
  onRemoveCycle: (id: string) => Promise<void>;
}) {
  const monday = startOfWeekMonday(anchorDate);
  const labelText = cycleLabel(monday);
  const rangeText = cycleRangeLabel(monday);
  const todayMondayIso = toIsoDate(startOfWeekMonday(new Date()));
  const isCurrentCycle = toIsoDate(monday) === todayMondayIso;
  const anchorIso = toIsoDate(monday);
  const storedForAnchor = cycles[`cycle-${anchorIso}`];
  return (
    <header className="sticky top-0 z-40 -mx-10 flex h-[52px] items-center justify-between gap-4 bg-surface-0 px-10 xl:-mx-14 xl:px-14">
      <div className="flex items-center gap-2">
        <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
          Cycle
        </span>
        <div className="inline-flex items-center gap-1 rounded-md bg-surface-1 px-2 py-1">
          <button
            type="button"
            onClick={onPrev}
            aria-label="Previous cycle"
            className="rounded-sm p-1 text-ink-tertiary transition hover:bg-surface-2 hover:text-ink-primary"
          >
            <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.8} />
          </button>
          <CyclePickerTrigger
            anchorDate={anchorDate}
            labelText={storedForAnchor?.label ?? labelText}
            rangeText={rangeText}
            isCurrentCycle={isCurrentCycle}
            storedLabel={storedForAnchor?.label}
            onPick={onPickCycle}
            onToday={onToday}
            onUpsertCycle={onUpsertCycle}
            onRemoveCycle={onRemoveCycle}
            storedCycleIdForAnchor={storedForAnchor?.id}
            cycles={cycles}
          />
          <button
            type="button"
            onClick={onNext}
            aria-label="Next cycle"
            className="rounded-sm p-1 text-ink-tertiary transition hover:bg-surface-2 hover:text-ink-primary"
          >
            <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.8} />
          </button>
        </div>
        <button
          type="button"
          onClick={onToday}
          className="rounded-sm px-2 py-1 font-mono text-2xs uppercase tracking-widest text-ink-tertiary transition hover:bg-surface-2 hover:text-ink-primary"
        >
          Today
        </button>
      </div>

      <div className="flex items-center gap-3">
        <EditSessionIndicator
          changeCount={changeCount}
          onUndo={onUndoSession}
        />
        <button
          type="button"
          aria-label="Cycle menu"
          className="rounded-sm p-1 text-ink-secondary transition hover:bg-surface-2 hover:text-ink-primary"
        >
          <MoreHorizontal className="h-4 w-4" strokeWidth={1.8} />
        </button>
      </div>
    </header>
  );
}

function CyclePickerTrigger({
  anchorDate,
  labelText,
  rangeText,
  isCurrentCycle,
  storedLabel,
  storedCycleIdForAnchor,
  cycles,
  onPick,
  onToday,
  onUpsertCycle,
  onRemoveCycle,
}: {
  anchorDate: Date;
  labelText: string;
  rangeText: string;
  isCurrentCycle: boolean;
  storedLabel?: string;
  storedCycleIdForAnchor?: string;
  cycles: Record<string, import('@dayrail/core').Cycle>;
  onPick: (monday: Date) => void;
  onToday: () => void;
  onUpsertCycle: (startDate: string, label: string) => Promise<void>;
  onRemoveCycle: (id: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [labelEditOpen, setLabelEditOpen] = useState(false);
  const [labelDraft, setLabelDraft] = useState('');
  const groups = useMemo(
    () => enumerateCycles(anchorDate, { cycles }),
    [anchorDate, cycles],
  );

  const anchorMondayIso = toIsoDate(startOfWeekMonday(anchorDate));

  const openLabelEdit = () => {
    setLabelDraft(storedLabel ?? '');
    setLabelEditOpen(true);
  };
  const submitLabel = async () => {
    const trimmed = labelDraft.trim();
    if (!trimmed) return;
    await onUpsertCycle(anchorMondayIso, trimmed);
    setLabelEditOpen(false);
  };
  const clearLabel = async () => {
    if (storedCycleIdForAnchor) {
      await onRemoveCycle(storedCycleIdForAnchor);
    }
    setLabelEditOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-left transition hover:bg-surface-2"
        >
          <Calendar
            className="h-3.5 w-3.5 text-ink-tertiary"
            strokeWidth={1.6}
          />
          <span className="font-mono text-sm tabular-nums text-ink-primary">
            {labelText}
          </span>
          <span className="font-mono text-2xs tabular-nums text-ink-tertiary">
            · {rangeText}
          </span>
          {isCurrentCycle && (
            <span className="rounded-sm bg-ink-primary px-1 font-mono text-[9px] uppercase tracking-widest text-surface-0">
              当前
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="max-h-[460px] w-[300px] overflow-y-auto p-1"
      >
        <div className="flex items-center justify-between px-3 pb-1 pt-1.5">
          <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
            Cycles
          </span>
          <button
            type="button"
            onClick={() => {
              onToday();
              setOpen(false);
            }}
            className="rounded-sm px-1.5 py-0.5 text-2xs text-ink-tertiary transition hover:bg-surface-2 hover:text-ink-primary"
          >
            回到当前
          </button>
        </div>

        {labelEditOpen ? (
          <div className="flex flex-col gap-1.5 px-3 py-2">
            <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
              {storedLabel ? '重命名' : '标记此周期'} · {anchorMondayIso}
            </span>
            <input
              type="text"
              autoFocus
              value={labelDraft}
              onChange={(e) => setLabelDraft(e.target.value)}
              placeholder="例：考研冲刺周"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void submitLabel();
                } else if (e.key === 'Escape') {
                  setLabelEditOpen(false);
                }
              }}
              className="h-7 rounded-sm border border-hairline/60 bg-surface-0 px-2 text-xs text-ink-primary outline-none placeholder:text-ink-tertiary focus:border-ink-secondary"
            />
            <div className="flex items-center justify-end gap-1.5">
              {storedCycleIdForAnchor && (
                <button
                  type="button"
                  onClick={() => void clearLabel()}
                  className="mr-auto rounded-sm px-2 py-0.5 text-2xs text-ink-tertiary transition hover:bg-surface-2 hover:text-red-500"
                >
                  删除标记
                </button>
              )}
              <button
                type="button"
                onClick={() => setLabelEditOpen(false)}
                className="rounded-sm px-2 py-0.5 text-2xs text-ink-tertiary transition hover:bg-surface-2 hover:text-ink-primary"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void submitLabel()}
                className="rounded-sm bg-ink-primary px-2 py-0.5 text-2xs text-surface-0 transition hover:bg-ink-primary/90"
              >
                保存
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={openLabelEdit}
            className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-xs text-ink-secondary transition hover:bg-surface-2 hover:text-ink-primary"
          >
            {storedLabel ? `✎ 重命名「${storedLabel}」` : '+ 标记此周期'}
          </button>
        )}

        <div className="mx-3 my-1 h-px bg-surface-3" />

        {groups.map((g) => (
          <div key={`${g.year}-${g.month}`} className="flex flex-col">
            <span className="px-3 pb-0.5 pt-2 font-mono text-2xs uppercase tracking-widest text-ink-tertiary/80">
              {g.label}
            </span>
            {g.entries.map((entry) => {
              const active = toIsoDate(entry.monday) === anchorMondayIso;
              return (
                <button
                  key={entry.startIso}
                  type="button"
                  onClick={() => {
                    onPick(entry.monday);
                    setOpen(false);
                  }}
                  className={clsx(
                    'flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm transition',
                    active ? 'bg-surface-2' : 'hover:bg-surface-2',
                  )}
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex items-center gap-2">
                      {entry.customLabel ? (
                        <>
                          <span className="truncate text-xs text-ink-primary">
                            {entry.customLabel}
                          </span>
                          <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary/80">
                            {entry.cycleLabel}
                          </span>
                        </>
                      ) : (
                        <span className="font-mono text-xs text-ink-primary">
                          {entry.cycleLabel}
                        </span>
                      )}
                    </span>
                    <span className="font-mono text-2xs tabular-nums text-ink-tertiary">
                      {entry.rangeLabel}
                    </span>
                  </span>
                  {entry.isCurrent && (
                    <span className="ml-auto rounded-sm bg-ink-primary px-1 font-mono text-[9px] uppercase tracking-widest text-surface-0">
                      当前
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function CycleFooter({
  cycle,
  groupCount,
}: {
  cycle: { days: CycleDay[]; slots: CycleSlot[] };
  groupCount: number;
}) {
  return (
    <footer className="flex items-center justify-between pt-3 font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
      <span>
        {cycle.days.length} days · {groupCount} sections · {cycle.slots.length} scheduled
      </span>
      <span>ERD §5.3 · live</span>
    </footer>
  );
}

