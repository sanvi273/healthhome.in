const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const invoke = async (handler, request) => {
  let statusCode;
  let body;
  const res = {
    status(code) { statusCode = code; return this; },
    json(value) { body = value; return this; },
  };
  await handler(request, res);
  return { statusCode, body };
};

test("admin analytics returns totals and per-provider breakdown for selected range", async () => {
  const now = new Date();
  const state = { filters: [] };
  const model = (records) => ({
    find(filter) {
      state.filters.push(filter);
      return { lean: async () => records };
    },
  });
  const models = {
    "../models/Appointment": model([{
      createdAt: now,
      doctorId: "doctor-1",
      doctorName: "Dr Rao",
      fees: 1000,
      paymentStatus: "Paid",
    }]),
    "../models/orderModel": model([{
      createdAt: now,
      pharmacyId: "pharmacy-1",
      pharmacyName: "Health Pharmacy",
      totalAmount: 500,
      paymentStatus: "Paid",
      platformFee: 25,
      providerAmount: 475,
    }]),
    "../models/labOrder": model([{
      createdAt: now,
      labId: "lab-1",
      labName: "City Lab",
      totalAmount: 300,
      paymentStatus: "Pending",
    }]),
  };
  const originalLoad = Module._load;
  const controllerPath = require.resolve("../controllers/adminAnalyticsController");
  delete require.cache[controllerPath];
  Module._load = function (request, parent, isMain) {
    if (Object.hasOwn(models, request)) return models[request];
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const { getAdminAnalytics } = require("../controllers/adminAnalyticsController");
    const response = await invoke(getAdminAnalytics, { query: { period: "7d" } });
    assert.equal(response.statusCode, 200, JSON.stringify(response.body));
    assert.equal(response.body.period, "7d");
    assert.equal(response.body.timezone, "Asia/Kolkata");
    assert.equal(response.body.totals.totalServiceRecords, 3);
    assert.equal(response.body.totals.paidServiceRecords, 2);
    assert.equal(response.body.totals.grossCollected, 1500);
    assert.equal(response.body.totals.providerPayableEstimate, 1425);
    assert.equal(response.body.services.doctor.providers[0].providerName, "Dr Rao");
    assert.equal(response.body.services.medicine.providers[0].providerPayableEstimate, 475);
    assert.equal(response.body.services.laboratory.paidCount, 0);
    assert.equal(state.filters.length, 3);
    for (const filter of state.filters) {
      assert.ok(filter.createdAt.$gte instanceof Date);
      assert.ok(filter.createdAt.$lt instanceof Date);
      assert.equal(filter.createdAt.$gte.getTime(), response.body.range.start.getTime());
    }
  } finally {
    Module._load = originalLoad;
    delete require.cache[controllerPath];
  }
});

test("admin analytics rejects unsupported periods", async () => {
  const { getAdminAnalytics } = require("../controllers/adminAnalyticsController");
  const response = await invoke(getAdminAnalytics, { query: { period: "90d" } });
  assert.equal(response.statusCode, 400);
  assert.match(response.body.message, /today, 7d, or 30d/);
});
