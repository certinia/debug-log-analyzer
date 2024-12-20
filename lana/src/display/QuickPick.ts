/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import { window, type QuickPickItem, type QuickPickOptions } from 'vscode';

export class Item implements QuickPickItem {
  label: string;
  description: string;
  detail: string;
  picked: boolean;
  alwaysShow: boolean;

  constructor(name: string, desc: string, details: string, sticky = true, selected = false) {
    this.label = name;
    this.description = desc;
    this.detail = details;
    this.picked = selected;
    this.alwaysShow = sticky;
  }
}

export class Options implements QuickPickOptions {
  canPickMany: boolean;
  ignoreFocusOut: boolean;
  placeHolder: string;
  matchOnDescription: boolean;
  matchOnDetail: boolean;

  constructor({
    placeholder,
    ignoreDefocus = false,
    multiSelect = false,
    matchOnDescription = false,
    matchOnDetail = false,
  }: {
    placeholder: string;
    ignoreDefocus?: boolean;
    multiSelect?: boolean;
    matchOnDescription?: boolean;
    matchOnDetail?: boolean;
  }) {
    this.placeHolder = placeholder;
    this.ignoreFocusOut = ignoreDefocus;
    this.canPickMany = multiSelect;
    this.matchOnDescription = matchOnDescription;
    this.matchOnDetail = matchOnDetail;
  }
}

export class QuickPick {
  static async pick<T extends Item, U extends Options>(items: T[], options: U): Promise<T[]> {
    return QuickPick.showQuickPick(items, options).then((oneOrMany) => {
      if (oneOrMany) {
        return options.canPickMany ? (oneOrMany as T[]) : [oneOrMany as T];
      }
      return [];
    });
  }

  static async showQuickPick<T extends QuickPickItem>(
    items: T[],
    options: QuickPickOptions,
  ): Promise<T | T[] | undefined> {
    return window.showQuickPick<T>(items, options, undefined);
  }
}
