/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */

import { QuickPickItem, QuickPickOptions, window } from "vscode";

export class Item implements QuickPickItem {
  label: string;
  description: string;
  detail: string;
  picked: boolean;
  alwaysShow: boolean;

  constructor(
    name: string,
    desc: string,
    details: string,
    sticky: boolean = true,
    selected: boolean = false
  ) {
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

  constructor(
    placeholder: string,
    ignoreDefocus: boolean = false,
    multiSelect: boolean = false
  ) {
    this.placeHolder = placeholder;
    this.ignoreFocusOut = ignoreDefocus;
    this.canPickMany = multiSelect;
  }
}

export class QuickPick {
  static async pick<T extends Item, U extends Options>(
    items: T[],
    options: U
  ): Promise<T[]> {
    return QuickPick.showQuickPick(items, options).then((oneOrMany) => {
      if (oneOrMany) {
        if (options.canPickMany) return oneOrMany as T[];
        else return [oneOrMany as T];
      }
      return [];
    });
  }

  static async showQuickPick<T extends QuickPickItem>(
    items: T[],
    options: QuickPickOptions
  ): Promise<T | T[] | undefined> {
    return window.showQuickPick<T>(items, options, undefined);
  }
}
