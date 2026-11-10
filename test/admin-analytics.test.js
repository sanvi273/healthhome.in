const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const aggregateCalls = {};
const makeModel = (name, paidAmountPaise) => ({
  async aggregate(pipeline) {
    aggregateCalls[name] = pipeline;
    return [{
      totals: [{
        totalCount: 2,
        paidCount: 1,
        pendingCount: 1,
        cancelledCount: 0,
        grossCollectedPaise: paidAmountPaise,
      }],
      providers: [],
    }];
  },
});

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (parent?.filename.endsWith("adminAnalyticsController.js")) {
    if (request === "../models/Appointment") return makeModel("doctor", 10000);
    if (request === "../models/orderModel") return makeModel("medicine", 20000);
    if (request === "../models/labOrder") return makeModel("laboratory", 30000);
  }
  return originalLoad.call(this, request, parent, isMain);
};
const controller = require("../controllers/adminAnalyticsController");
Module._load = originalLoad;
const { _test } = controller;

test("analytics periods use India midnight and reject unsupported periods", () => {
  const now = new Date("2026-11-10T12:00:00.000Z");
  const today = _test.getDateRange("today", now);
  assert.equal(today.from.toISOString(), "2026-11-09T18:30:00.000Z");
  assert.equal(today.to.toISOString(), now.toISOString());
  assert.equal(today.timezone, "Asia/Kolkata");

  const week = _test.getDateRange("7d", now);
  assert.equal(week.from.toISOString(), "2026-11-03T18:30:00.000Z");
  assert.equal(_test.getDateRange("all", now), null);
});

test("analytics calculates the 5 percent platform fee in paise and provider estimates", () => {
  const result = _test.formatAggregate({
    totals: [{ totalCount: 2, paidCount: 1, pendingCount: 1, cancelledCount: 0, grossCollectedPaise: 1234 }],
    providers: [{ _id: "doctor-1", providerName: "Dr One", bookingCount: 2, paidCount: 1, grossCollectedPaise: 1234 }],
  }, "Doctor");

  assert.equal(result.grossCollected, 12.34);
  assert.equal(result.platformFeeEstimate, 0.62);
  assert.equal(result.providerPayableEstimate, 11.72);
  assert.equal(result.providers[0].providerPayableEstimate, 11.72);
});

test("analytics aggregation scopes records to creation time and returns provider summaries", () => {
  const pipeline = _test.metricPipeline({
    from: new Date("2026-11-09T18:30:00.000Z"),
    to: new Date("2026-11-10T12:00:00.000Z"),
    paymentField: "paymentStatus",
    amountField: "totalAmount",
    providerIdField: "pharmacyId",
    providerNameField: "pharmacyName",
  });
  assert.deepEqual(pipeline[0].$match.createdAt, {
    $gte: new Date("2026-11-09T18:30:00.000Z"),
    $lte: new Date("2026-11-10T12:00:00.000Z"),
  });
  assert.ok(Array.isArray(pipeline[1].$facet.providers));
  assert.ok(Array.isArray(pipeline[1].$facet.totals));
});

test("admin analytics combines doctor, medicine, and lab counts and estimates", async () => {
  const response = {
    statusCode: 0,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  await controller.getAdminAnalytics({ query: { period: "today" } }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.totals.totalServiceRecords, 6);
  assert.equal(response.body.totals.paidServiceRecords, 3);
  assert.equal(response.body.totals.grossCollected, 600);
  assert.equal(response.body.totals.platformFeeEstimate, 30);
  assert.equal(response.body.totals.providerPayableEstimate, 570);
  assert.equal(response.body.dateBasis, "service_created_at");
  assert.ok(aggregateCalls.doctor);
  assert.ok(aggregateCalls.medicine);
  assert.ok(aggregateCalls.laboratory);
});

test("admin analytics rejects unsupported periods", async () => {
  const response = {
    statusCode: 0,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  await controller.getAdminAnalytics({ query: { period: "90d" } }, response);
  assert.equal(response.statusCode, 400);
  assert.equal(response.body.success, false);
});
