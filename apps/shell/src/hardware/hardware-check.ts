import { app, dialog, ipcMain } from "electron";
import { detect } from "@audiomorph/hardware-gate";

function formatFailureList(report: Awaited<ReturnType<typeof detect>>): string {
  if (report.failures.length === 0) {
    return "Unknown hardware validation failure.";
  }

  return report.failures
    .map((failure, index) => `${index + 1}. ${failure.requirement}: ${failure.message} (actual: ${failure.actual})`)
    .join("\n");
}

export async function enforceHardwareRequirements(): Promise<void> {
  // AUDIOMORPH_TEST_MODE hook — skip hardware gate in test mode
  if (process.env.AUDIOMORPH_TEST_MODE === "1") return;

  const report = await detect();
  if (report.ok) {
    return;
  }

  dialog.showErrorBox(
    "System Requirements Not Met",
    `AudioMorph Studio requires compatible hardware to run.\n\n${formatFailureList(report)}`,
  );
  app.exit(1);
}

export function registerHardwareIpcHandler(): void {
  if (typeof ipcMain.removeHandler === "function") {
    ipcMain.removeHandler("hardware:check");
  }

  ipcMain.handle("hardware:check", async () => detect());
}
