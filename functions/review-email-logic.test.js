"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  canAnchorReviewTask,
  getLprEntryDate,
  getReviewRecipientDecision,
  getReviewRecipientId,
  getReviewDueDate,
  isEligibleReviewBooking,
  isRealLprEntry,
  isReviewTaskDue,
  isTrustedLprReviewTask,
  normalizeReviewEmail,
} = require("./review-email-logic");

test("accepts the two existing eligible booking flows", () => {
  assert.equal(isEligibleReviewBooking({
    bookingOrigin: "wp-card-booking",
    paymentStatus: "paid",
  }), true);
  assert.equal(isEligibleReviewBooking({
    source: "pay_on_site",
    status: "confirmed_pay_on_site",
  }), true);
  assert.equal(isEligibleReviewBooking({
    bookingOrigin: "wp-card-booking",
    paymentStatus: "pending",
  }), false);
});

test("accepts only automatic entry gate events", () => {
  assert.equal(isRealLprEntry({eventType: "entry"}), true);
  assert.equal(isRealLprEntry({eventType: "entry", manual: true}), false);
  assert.equal(isRealLprEntry({eventType: "exit"}), false);
});

test("uses booking lpr.arrivedAt as the entry instant", () => {
  const date = getLprEntryDate({
    lpr: {arrivedAt: "2026-09-10T08:15:00.000Z"},
  }, {
    accurateTime: "2026-09-10T08:16:00.000Z",
  });
  assert.equal(date.toISOString(), "2026-09-10T08:15:00.000Z");
});

test("falls back to the gate event time when arrivedAt is unavailable", () => {
  const date = getLprEntryDate({}, {
    accurateTime: "2026-09-10T08:16:00.000Z",
  });
  assert.equal(date.toISOString(), "2026-09-10T08:16:00.000Z");
});

test("schedules the review one hour after entry", () => {
  const due = getReviewDueDate(new Date("2026-09-10T08:15:00.000Z"));
  assert.equal(due.toISOString(), "2026-09-10T09:15:00.000Z");
});

test("is not due at 59 minutes and is due at 60 minutes", () => {
  const due = "2026-09-10T09:15:00.000Z";
  assert.equal(isReviewTaskDue(
      due,
      new Date("2026-09-10T09:14:00.000Z"),
  ), false);
  assert.equal(isReviewTaskDue(
      due,
      new Date("2026-09-10T09:15:00.000Z"),
  ), true);
});

test("keeps retry timing separate and prevents duplicate anchoring", () => {
  const retryAt = "2026-09-10T09:20:00.000Z";
  assert.equal(isReviewTaskDue(
      retryAt,
      new Date("2026-09-10T09:16:00.000Z"),
  ), false);
  assert.equal(canAnchorReviewTask({status: "awaiting_entry"}), true);
  assert.equal(canAnchorReviewTask({
    status: "pending",
    lprEntryAt: "2026-09-10T08:15:00.000Z",
  }), false);
  assert.equal(canAnchorReviewTask({status: "completed"}), false);
});

test("trusts only tasks anchored by the new LPR trigger", () => {
  const validTask = {
    scheduleMode: "lpr_entry_plus_1h",
    lprEntryEventId: "event-123",
    lprEntryAt: "2026-09-10T08:15:00.000Z",
    reviewDueAt: "2026-09-10T09:15:00.000Z",
  };
  assert.equal(isTrustedLprReviewTask(validTask), true);
  assert.equal(isTrustedLprReviewTask({
    ...validTask,
    lprEntryEventId: undefined,
  }), false);
  assert.equal(isTrustedLprReviewTask({
    ...validTask,
    scheduleMode: "arrival_plus_1h",
  }), false);
  assert.equal(isTrustedLprReviewTask({
    ...validTask,
    reviewDueAt: undefined,
  }), false);
});

test("normalizes recipient emails before deduplication", () => {
  assert.equal(
      normalizeReviewEmail("  Client.Example@GMAIL.COM "),
      "client.example@gmail.com",
  );
  assert.equal(
      getReviewRecipientId(" Client.Example@GMAIL.COM "),
      getReviewRecipientId("client.example@gmail.com"),
  );
  assert.notEqual(
      getReviewRecipientId("client.one@example.com"),
      getReviewRecipientId("client.two@example.com"),
  );
  assert.match(getReviewRecipientId("client@example.com"), /^[a-f0-9]{64}$/);
});

test("allows only the first task to own a review recipient", () => {
  assert.equal(getReviewRecipientDecision({}, "task-1"), "claim");

  const claimed = {status: "processing", firstTaskId: "task-1"};
  assert.equal(
      getReviewRecipientDecision(claimed, "task-1"),
      "claim",
  );
  assert.equal(
      getReviewRecipientDecision(claimed, "task-2"),
      "skip_repeat",
  );
});

test("blocks historical recipients and keeps retry ownership", () => {
  assert.equal(getReviewRecipientDecision({
    status: "sent",
    firstTaskId: "historical-task",
  }, "new-task"), "skip_repeat");

  assert.equal(getReviewRecipientDecision({
    status: "retry_pending",
    firstTaskId: "task-1",
  }, "task-1"), "claim");
  assert.equal(getReviewRecipientDecision({
    status: "retry_pending",
    firstTaskId: "task-1",
  }, "task-2"), "skip_repeat");
});
