import { Skull } from "lucide-react"
import type { MiniApp } from "@/lib/module"
import { ProcessKiller } from "./ProcessKiller"

/** "Kill process" mini app: find a process by port or PID and terminate it. */
export const processKillerApp: MiniApp = {
  id: "process-killer",
  icon: Skull,
  label: (t) => t.killer.title,
  View: ProcessKiller,
  width: 420,
}
