import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let mockPlatform: NodeJS.Platform = 'darwin';

vi.mock('node:process', async () => {
  const actual = await vi.importActual<typeof import('node:process')>('node:process');
  return {
    ...actual,
    get platform() {
      return mockPlatform;
    },
  };
});

vi.mock('electron', () => {
  const builtMenus: { template: Electron.MenuItemConstructorOptions[] }[] = [];

  const Menu = {
    buildFromTemplate: vi.fn((template: Electron.MenuItemConstructorOptions[]) => {
      const built = { template };
      builtMenus.push(built);
      return built;
    }),
    setApplicationMenu: vi.fn(),
  };

  const dialog = {
    showMessageBox: vi.fn(() => Promise.resolve({ response: 0 })),
  };

  const shell = {
    openExternal: vi.fn(() => Promise.resolve()),
  };

  const __mock = {
    getLastTemplate: () => builtMenus[builtMenus.length - 1]?.template ?? [],
    reset: () => {
      builtMenus.length = 0;
    },
  };

  return { Menu, dialog, shell, __mock };
});

async function loadMenuModule() {
  return import('../../src/menu/menu-builder');
}

beforeEach(async () => {
  vi.resetModules();
  process.env.NODE_ENV = 'development';
  const electron = (await import('electron')) as unknown as {
    __mock: { reset: () => void };
  };
  electron.__mock.reset();
});

afterEach(() => {
  delete process.env.NODE_ENV;
  vi.restoreAllMocks();
});

describe('buildMenu', () => {
  it('macOS includes native app menu', async () => {
    mockPlatform = 'darwin';
    const { buildMenu } = await loadMenuModule();
    const electron = (await import('electron')) as unknown as {
      __mock: { getLastTemplate: () => Electron.MenuItemConstructorOptions[] };
    };

    buildMenu({} as never);
    const template = electron.__mock.getLastTemplate();

    expect(template[0]?.role).toBe('appMenu');
  });

  it('win/linux includes File > Quit', async () => {
    mockPlatform = 'win32';
    const { buildMenu } = await loadMenuModule();
    const electron = (await import('electron')) as unknown as {
      __mock: { getLastTemplate: () => Electron.MenuItemConstructorOptions[] };
    };

    buildMenu({} as never);
    const template = electron.__mock.getLastTemplate();
    const fileMenu = template.find((item) => item.label === 'File');
    const submenu = Array.isArray(fileMenu?.submenu) ? fileMenu?.submenu : [];

    expect(submenu.some((item) => 'role' in item && item.role === 'quit')).toBe(true);
  });

  it('DevTools menu item exists only in dev mode', async () => {
    mockPlatform = 'linux';
    const { buildMenu } = await loadMenuModule();
    const electron = (await import('electron')) as unknown as {
      __mock: {
        getLastTemplate: () => Electron.MenuItemConstructorOptions[];
        reset: () => void;
      };
    };

    process.env.NODE_ENV = 'development';
    buildMenu({} as never);
    let template = electron.__mock.getLastTemplate();
    let viewMenu = template.find((item) => item.label === 'View');
    let submenu = Array.isArray(viewMenu?.submenu) ? viewMenu.submenu : [];
    expect(submenu.some((item) => 'role' in item && item.role === 'toggleDevTools')).toBe(true);

    electron.__mock.reset();
    process.env.NODE_ENV = 'production';
    buildMenu({} as never);
    template = electron.__mock.getLastTemplate();
    viewMenu = template.find((item) => item.label === 'View');
    submenu = Array.isArray(viewMenu?.submenu) ? viewMenu.submenu : [];
    expect(submenu.some((item) => 'role' in item && item.role === 'toggleDevTools')).toBe(false);
  });

  it('sets application menu with built menu', async () => {
    mockPlatform = 'darwin';
    const { buildMenu } = await loadMenuModule();
    const electron = (await import('electron')) as unknown as {
      Menu: {
        setApplicationMenu: ReturnType<typeof vi.fn>;
      };
    };

    const result = buildMenu({} as never);

    expect(electron.Menu.setApplicationMenu).toHaveBeenCalledWith(result);
  });
});
