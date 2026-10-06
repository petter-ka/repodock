export type {
  CommandStep, EnvFile, Group, ImportOptions, ImportPreview, ImportRepositoryPreview, ImportResult, GroupRepoState, GroupRun, GroupRunMode, ProcessExit, ProcessOutput, ProcessSnapshot, Repository, Run, RunStatus, Script,
  SequenceRun, SequenceStepState, StepStatus, Workspace,
} from "@/lib/contracts"
export { isActive, isZeroTime } from "@/lib/contracts"

import type { ProcessOutput } from "@/lib/contracts"
import type { AnsiSegment } from "@/lib/ansi"

/** A console line with lazily parsed ANSI segments. */
export type ConsoleLine = ProcessOutput & { segments?: AnsiSegment[] }

/** Selection for the console: one run, or every run in scope. */
export type ConsoleFilter = { runId: string | null; query: string }
