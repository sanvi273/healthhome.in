const { test } = require("node:test");
const assert = require("node:assert/strict");
const LabOrder = require("../models/labOrder");

test("LabOrder requires an authenticated patient ID, name, and phone", async () => {
  const complete = new LabOrder({
    patientId: "507f1f77bcf86cd799439011",
    patientName: "Sanvi",
    patientPhone: "9313069960",
  });
  await assert.doesNotReject(complete.validate());

  for (const field of ["patientId", "patientName", "patientPhone"]) {
    const incomplete = new LabOrder({
      patientId: "507f1f77bcf86cd799439011",
      patientName: "Sanvi",
      patientPhone: "9313069960",
      [field]: "",
    });
    await assert.rejects(
      incomplete.validate(),
      (error) => Boolean(error.errors[field]),
      `${field} must be required`
    );
  }
});

test("LabOrder preserves online and COD method values", async () => {
  for (const paymentMethod of ["ONLINE", "COD"]) {
    const order = new LabOrder({
      patientId: "507f1f77bcf86cd799439011",
      patientName: "Sanvi",
      patientPhone: "9313069960",
      paymentMethod,
    });
    await assert.doesNotReject(order.validate());
    assert.equal(order.paymentMethod, paymentMethod);
  }
});
