import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import App from "./app/App"
import { applyStoredTheme } from "./lib/theme"
import { applyStoredAppearance } from "./state/appearance"
import "./styles/index.css"

applyStoredTheme()
applyStoredAppearance()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
