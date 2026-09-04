import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { testLogDetails, testSampleSummary } from "../api/testClientApi";
import { prepareLogDetails } from "../utils/type-utils";

import { DB_NAME } from "./schema";
import { createDatabaseService, DatabaseService } from "./service";

const FILE = "/logs/run.eval";

let db: DatabaseService;

beforeEach(async () => {
  db = createDatabaseService();
  await db.openDatabase();
});

afterEach(async () => {
  await db.closeDatabase();
  await Dexie.delete(DB_NAME);
});

describe("hasCompletedSampleSummary", () => {
  it("point-reads logical sample identity across string and numeric ids", async () => {
    const details = testLogDetails({
      sampleSummaries: [
        testSampleSummary({ id: 1, epoch: 2, completed: true }),
        testSampleSummary({ id: "other", epoch: 2, completed: false }),
      ],
    });
    await db.writeLogDetails({ [FILE]: prepareLogDetails(details) });

    expect(await db.hasCompletedSampleSummary(FILE, "1", 2)).toBe(true);
    expect(await db.hasCompletedSampleSummary(FILE, "other", 2)).toBe(false);
    expect(await db.hasCompletedSampleSummary(FILE, "missing", 2)).toBe(false);
  });
});
