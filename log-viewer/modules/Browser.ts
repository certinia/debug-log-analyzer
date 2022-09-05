/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */
const convertorDiv = document.createElement('div');

export function decodeEntities(text: string) {
  if (!text) {
    return text;
  }
  convertorDiv.innerHTML = text;
  return convertorDiv.innerText;
}
