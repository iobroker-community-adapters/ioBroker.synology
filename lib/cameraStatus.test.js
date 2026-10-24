const { expect } = require("chai");
const { getCameraStatus } = require("../build/lib/cameraStatus.js");

describe("getCameraStatus", () => {
  it("uses the camera status field instead of the unrelated numeric status", () => {
    expect(getCameraStatus({ status: 0, camStatus: 1 })).to.equal("Normal");
  });

  it("preserves a textual status from the current API", () => {
    expect(getCameraStatus({ status: "Normal", statusId: 1 })).to.equal(
      "Normal",
    );
  });

  it("maps a numeric status ID returned as a string", () => {
    expect(getCameraStatus({ camStatus: "1" })).to.equal("Normal");
  });

  it("does not interpret the unrelated numeric status as a camera status", () => {
    expect(getCameraStatus({ status: 2 })).to.equal("Unknown (2)");
  });
});
