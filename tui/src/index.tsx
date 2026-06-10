import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"

function App() {
  return (
    <box flexDirection="column" padding={1}>
      <text fg="cyan">holophyte tui — attention queue</text>
      <text fg="#888888">scaffold ok. see spec.md.</text>
    </box>
  )
}

const renderer = await createCliRenderer({
  screenMode: "alternate-screen",
  exitOnCtrlC: true,
  clearOnShutdown: true,
})
createRoot(renderer).render(<App />)
