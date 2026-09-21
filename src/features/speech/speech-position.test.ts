import { describe, expect, it } from "vitest";
import { positionSpeechPanel } from "./speech-position";

describe("speech panel placement", () => {
  it("sits just below the insertion line", () => {
    expect(positionSpeechPanel({ left: 400, right: 400, top: 200, bottom: 220 }, 320, 90, 1200, 800))
      .toEqual({ left: 400, top: 230 });
  });

  it("flips above the cursor and shifts left at the bottom right edge", () => {
    const anchor = { left: 1100, right: 1100, top: 730, bottom: 750 };
    expect(positionSpeechPanel(anchor, 320, 90, 1200, 800)).toEqual({ left: 868, top: 630 });
    expect(positionSpeechPanel(anchor, 360, 340, 1200, 800)).toEqual({ left: 828, top: 380 });
  });

  it("stays inside a small viewport when neither side has enough room", () => {
    expect(positionSpeechPanel({ left: 2, right: 2, top: 80, bottom: 100 }, 296, 216, 320, 240))
      .toEqual({ left: 12, top: 12 });
  });
});
