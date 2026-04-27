import { describe, expect, it } from "vitest";

import { SampleDataResponse } from "../../client/api/types";
import {
  hasSampleDataUpdates,
  shouldFinalizeStreamingSample,
} from "../../state/samplePolling";

describe("samplePolling helpers", () => {
  it("treats empty sample-data payloads as no-op updates", () => {
    expect(
      hasSampleDataUpdates({
        events: [],
        attachments: [],
        message_pool: [],
        call_pool: [],
      })
    ).toBe(false);
  });

  it("detects sample-data deltas across all streamed collections", () => {
    expect(
      hasSampleDataUpdates({
        events: [],
        attachments: [
          {
            id: 1,
            sample_id: "sample-1",
            epoch: 1,
            hash: "hash-1",
            content: "content",
          },
        ],
        message_pool: [],
        call_pool: [],
      })
    ).toBe(true);
  });

  it("finalizes streaming when the sample is complete in the log and only empty deltas remain", () => {
    const response: SampleDataResponse = {
      status: "OK",
      sampleData: {
        events: [],
        attachments: [],
        message_pool: [],
        call_pool: [],
      },
    };

    expect(shouldFinalizeStreamingSample(response, true)).toBe(true);
  });

  it("keeps streaming when the sample is still incomplete in the log", () => {
    const response: SampleDataResponse = {
      status: "OK",
      sampleData: {
        events: [],
        attachments: [],
        message_pool: [],
        call_pool: [],
      },
    };

    expect(shouldFinalizeStreamingSample(response, false)).toBe(false);
  });
});
