import { BrowserWindow, Menu, dialog, shell } from "electron";
import * as process from "node:process";

const HELP_URL = "https://github.com/audiomorph-studio";

function isDevMode(): boolean {
  return process.env.NODE_ENV !== "production";
}

function buildMacMenu(): Electron.MenuItemConstructorOptions[] {
  const viewSubmenu: Electron.MenuItemConstructorOptions[] = [
    ...(isDevMode()
      ? [
          { role: "reload" as const },
          { role: "toggleDevTools" as const },
          { type: "separator" as const },
        ]
      : []),
    { role: "togglefullscreen" },
  ];

  return [
    {
      role: "appMenu",
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "File",
      submenu: [{ role: "close" }],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: viewSubmenu,
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { type: "separator" },
        { role: "front" },
      ],
    },
    {
      role: "help",
      submenu: [
        {
          label: "Learn More",
          click: () => {
            void shell.openExternal(HELP_URL);
          },
        },
      ],
    },
  ];
}

function buildDefaultMenu(mainWindow: BrowserWindow): Electron.MenuItemConstructorOptions[] {
  return [
    {
      label: "File",
      submenu: [
        {
          label: "Quit",
          role: "quit",
        },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "togglefullscreen" },
        ...(isDevMode() ? [{ role: "toggleDevTools" as const }] : []),
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "About",
          click: async () => {
            await dialog.showMessageBox(mainWindow, {
              type: "info",
              title: "About AudioMorph Studio",
              message: "AudioMorph Studio",
              detail: "Cross-platform audio morphing and synthesis platform.",
            });
          },
        },
      ],
    },
  ];
}

export function buildMenu(mainWindow: BrowserWindow): Menu {
  const template =
    process.platform === "darwin" ? buildMacMenu() : buildDefaultMenu(mainWindow);

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
  return menu;
}
