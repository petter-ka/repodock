import type { MiniApp } from "@/lib/module"
import { processKillerApp } from "@/modules/process-killer"

/** Mini apps toggled from the application rail, in order (ADR-0018). */
export const miniAppList: MiniApp[] = [processKillerApp]
