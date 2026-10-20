import type { MiniApp } from "@/lib/module"
import { graphqlMapApp } from "@/modules/graphql-map"
import { jwtToolApp } from "@/modules/jwt-tool"
import { processKillerApp } from "@/modules/process-killer"

/** Mini apps toggled from the application rail, in order (ADR-0018). */
export const miniAppList: MiniApp[] = [processKillerApp, jwtToolApp, graphqlMapApp]
