/**
 * @jest-environment jsdom
 */
/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */
import formatDuration, {
  highlightText,
  showTab,
  recalculateDurations,
} from "../Util";
import { TimeStampedNode } from "../parsers/LineParser";

jest.mock("../Browser", () => ({
  decodeEntities: (text: string) => {
    return text.replace(/&amp;/gim, "&");
  },
  encodeEntities: (text: string) => {
    return text.replace(/&/gim, "&amp;");
  },
}));

describe("Highlight tests", () => {
  it("Text is escaped", () => {
    expect(highlightText("M&S", false)).toBe("M&amp;S");
  });
  it("Text is bold", () => {
    expect(highlightText("Text", true)).toBe("<b>Text</b>");
  });
});

describe("Format duration tests", () => {
  it("Value converted from nanoseconds to milliseconds", () => {
    expect(formatDuration(1000)).toBe("0.001ms");
  });
  it("Value always has 3dp", () => {
    expect(formatDuration(1000000)).toBe("1.000ms");
  });
  it("Value truncated at 3dp", () => {
    expect(formatDuration(1234567)).toBe("1.234ms");
  });
});

describe("Show Tab tests", () => {
  it("Moves the selected class to the secified tab and its view", () => {
    document.body.innerHTML =
      '<div class="tabHolder">' +
      '<div class="tab" id="tab1" data-show="view1">V1</div>' +
      '<div class="tab selected" id="tab2" data-show="view2">V2</div>' +
      "</div>" +
      '<div class="tabber">' +
      '<div id="view1" class="tabItem">' +
      '<div id="view2" class="tabItem selected">' +
      "</div>";
    showTab("tab1");
    expect(
      document.getElementById("tab1")?.classList.contains("selected")
    ).toBe(true);
    expect(
      document.getElementById("tab2")?.classList.contains("selected")
    ).toBe(false);
    expect(
      document.getElementById("view1")?.classList.contains("selected")
    ).toBe(true);
    expect(
      document.getElementById("view2")?.classList.contains("selected")
    ).toBe(false);
  });
});

describe("Recalculate durations tests", () => {
  it("Recalculates parent node", () => {
    let node: TimeStampedNode = {
      timestamp: 1,
      exitStamp: 3,
      children: [],
      duration: null,
      selfTime: null,
    };
    recalculateDurations(node);
    expect(node.duration).toBe(2);
    expect(node.selfTime).toBe(2);
  });
  it("Children are subtracted from self time", () => {
    let node: TimeStampedNode = {
      timestamp: 0,
      exitStamp: 100,
      children: [
        {
          duration: 50,
          timestamp: 0,
          exitStamp: null,
          selfTime: null,
          children: [],
        },
        {
          duration: 25,
          timestamp: 0,
          exitStamp: null,
          selfTime: null,
          children: [],
        },
      ],
      duration: null,
      selfTime: null,
    };
    recalculateDurations(node);
    expect(node.duration).toBe(100);
    expect(node.selfTime).toBe(25);
  });
});
