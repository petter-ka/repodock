import type { AppModule } from "@/lib/module"
import { repositoryManagerModule } from "@/modules/repository-manager"
import { settingsModule } from "@/modules/settings"

/** Feature modules shown in the application rail, in order. */
export const modules: AppModule[] = [repositoryManagerModule, settingsModule]
