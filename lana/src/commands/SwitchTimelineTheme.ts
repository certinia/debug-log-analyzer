/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { ConfigurationTarget, Uri, window, workspace } from 'vscode';

import { appName } from '../AppSettings.js';
import { Context } from '../Context.js';
import { Command } from './Command.js';

import { LogView } from './LogView.js';

export class SwitchTimelineTheme {
  static getCommand(context: Context): Command {
    return new Command('switchTimelineTheme', 'Log: Timeline Theme', (uri: Uri) =>
      SwitchTimelineTheme.safeCommand(context, uri),
    );
  }

  static apply(context: Context): void {
    SwitchTimelineTheme.getCommand(context).register(context);
    context.display.output(`Registered command '${appName}: Timeline Theme'`);
  }

  private static async safeCommand(context: Context, uri: Uri): Promise<void> {
    try {
      return SwitchTimelineTheme.command(context, uri);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      context.display.showErrorMessage(`Error changing timeline theme: ${msg}`);
      return Promise.resolve();
    }
  }

  private static async command(_context: Context, _uri: Uri): Promise<void> {
    const config = workspace.getConfiguration('lana');
    const customThemesNames = Object.keys(config.get('timeline.customThemes') || {});
    const allThemeNames = new Set(THEMES.concat(customThemesNames));

    // Create a QuickPick that allows custom text
    const pick = window.createQuickPick();
    const items = Array.from(allThemeNames).map((label) => ({
      label,
      description: label === DEFAULT_THEME ? 'default' : '',
    }));
    pick.items = items;
    pick.placeholder = 'Select Timeline Theme...';

    // Focus the currently active theme
    let activeTheme = config.get<string>('timeline.activeTheme') || DEFAULT_THEME;
    const activeItem = items.find((item) => item.label === activeTheme);
    if (activeItem) {
      pick.activeItems = [activeItem];
    }

    let selectedTheme = activeTheme;
    pick.onDidChangeActive(async (selection) => {
      // Update preview as user navigates
      selectedTheme = selection[0]?.label ?? '';
      SwitchTimelineTheme.switchTheme(selectedTheme);
    });

    pick.onDidAccept(async () => {
      if (selectedTheme) {
        // Update the active theme in user settings on confirm
        activeTheme = selectedTheme;
        await config.update('timeline.activeTheme', selectedTheme, ConfigurationTarget.Global);
        pick.hide();
      }
    });

    pick.onDidHide(() => {
      pick.dispose();
      // Revert to the original theme if no selection was made
      if (selectedTheme !== activeTheme) {
        SwitchTimelineTheme.switchTheme(activeTheme);
      }
    });

    pick.show();
  }

  private static switchTheme(activeTheme: string) {
    const currentView = LogView.getCurrentView();
    if (currentView) {
      currentView.webview.postMessage({
        cmd: 'switchTimelineTheme',
        payload: { activeTheme },
      });
    }
  }
}

// Note: Themes are defined in the log-viewer folder but there are no references to the files from here to maintain separation of concerns.
// They are kept in sync manually.
const THEMES = [
  '50 shades of green - classic',
  '50 Shades of green high contrast',
  'Botanical Twilight /  50 Shades of green modern',
  'Catppuccin Macchiato',
  'Chrome Bright',
  'Chrome Muted',
  'Dracula',
  'Dusty Aurora',
  'Firefox',
  'Firefox Dim',
  'Flame',
  'Forest Floor',
  'Garish',
  'Intellij',
  'Material',
  'Monokai Pro',
  'Modern',
  'Nord Artic Muted',
  'Nordic',
  'Okabe-Ito',
  'Salesforce Lightning',
  'Solarized High Contrast',
  'Sunset Diverging',
].sort();

const DEFAULT_THEME = '50 shades of green - classic';
