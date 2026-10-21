export type {
  Monorepo, MonorepoTask, NodeInstall, NodeOverview, NodeRequest, NodeStatus,
  CommandStep, QuickCommand, EnvFile, FolderCheck, GlobalCommand, Group, GroupSchedule, GroupScheduleStatus, ScheduleKind, ScheduledStop, ScheduleEvent, ImportGlobalCommandPreview, ImportOptions, ImportPreview, ImportRepositoryPreview, ImportResult, GroupRepoState, GroupRun, GroupRunMode, ProcessExit, ProcessOutput, ProcessSnapshot, Repository, Run, RunStatus, Script,
  SequenceRun, SequenceStepState, StepStatus, Workspace,
} from "@/lib/contracts"
export { displayName, isActive, isZeroTime } from "@/lib/contracts"

import type { ProcessOutput } from "@/lib/contracts"
/** A console line. ANSI segments are parsed lazily, in a cache outside the line. */
export type ConsoleLine = ProcessOutput

/** Selection for the console: one run, or every run in scope. */
export type ConsoleFilter = { runId: string | null; query: string }
