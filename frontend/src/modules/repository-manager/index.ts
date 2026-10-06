import { Boxes } from "lucide-react"
import type { AppModule } from "@/lib/module"
import { connectRepositoryManager } from "./connect"
import { RepositoryManagerView } from "./views/RepositoryManagerView"

export const repositoryManagerModule: AppModule = {
  id: "repositories",
  icon: Boxes,
  label: (t) => t.rail.repos,
  View: RepositoryManagerView,
  init: connectRepositoryManager,
}
