import { ReactFlowProvider } from "@xyflow/react";
import { CanvasShell } from "./shell/CanvasShell.tsx";

export function App() {
  return (
    <ReactFlowProvider>
      <CanvasShell />
    </ReactFlowProvider>
  );
}
