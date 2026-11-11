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

test("delivery partner assignment persists the selected partner on an accepted order", async () => {
  const order = {
    _id: "507f1f77bcf86cd799439033",
    status: "Accepted",
    orderType: "MEDICINE",
    medicines: [{ medicineName: "Dolo", quantity: 1, price: 1 }],
    deliveryFee: 0,
    discount: 0,
    platformFee: 0,
    deliveryAgentAssigned: false,
    async save() { this.saved = true; },
  };
  const originalLoad = Module._load;
  const controllerPath = require.resolve("../controllers/orderController");
  delete require.cache[controllerPath];
  Module._load = function (request, parent, isMain) {
    if (request === "../models/orderModel") {
      return { findById: async () => order };
    }
    if (request === "../models/medicine") {
      return { findById: async () => null };
    }
    if (request === "../models/pharmacy") return {};
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const { assignDeliveryAgent } = require("../controllers/orderController");
    const response = await invoke(assignDeliveryAgent, {
      params: { id: order._id },
      body: {
        deliveryAgentName: "Abcd",
        deliveryAgentPhone: "1234567890",
      },
    });

    assert.equal(response.statusCode, 200, JSON.stringify(response.body));
    assert.equal(response.body.success, true);
    assert.equal(order.deliveryAgentName, "Abcd");
    assert.equal(order.deliveryAgentPhone, "1234567890");
    assert.equal(order.deliveryAgentAssigned, true);
    assert.ok(order.deliveryAgentAssignedAt instanceof Date);
    assert.equal(order.saved, true);
  } finally {
    Module._load = originalLoad;
    delete require.cache[controllerPath];
  }
});
