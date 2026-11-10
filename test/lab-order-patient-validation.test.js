const { test } = require("node:test");
const assert = require("node:assert/strict");
const LabOrder = require("../models/labOrder");

const validPatient = {
  patientId: "patient-123",
  patientName: "Test Patient",
  patientPhone: "9876543210",
};

test("LabOrder requires patient ID, name, and phone", async () => {
  const validOrder = new LabOrder(validPatient);
  await assert.doesNotReject(validOrder.validate());

  for (const field of Object.keys(validPatient)) {
    const incompleteOrder = new LabOrder({
      ...validPatient,
      [field]: "",
    });
    await assert.rejects(
      incompleteOrder.validate(),
      (error) => Boolean(error.errors[field]),
      `${field} must be required`
    );
  }
});
