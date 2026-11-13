const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const invoke = async (handler, request) => {
  let statusCode;
  let body;
  const response = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(value) {
      body = value;
      return this;
    },
  };
  await handler(request, response);
  return { statusCode, body };
};

const loadController = (state) => {
  const medicineModel = {
    async create(data) {
      if (state.failCreate) throw new Error("database write failed");
      const medicine = {
        ...data,
        _id: `507f1f77bcf86cd7994390${String(state.records.length + 1).padStart(2, "0")}`,
      };
      state.records.push(medicine);
      return medicine;
    },
    async find() {
      return state.records;
    },
    async findOne(filter) {
      return state.records.find((record) =>
        record.pharmacyPhone === filter.pharmacyPhone &&
        record.submissionKey === filter.submissionKey
      ) || null;
    },
    async findById(id) {
      return state.records.find((record) => record._id === id) || null;
    },
    async findByIdAndUpdate(id, update) {
      if (state.failUpdate) throw new Error("database update failed");
      const record = state.records.find((item) => item._id === id);
      if (!record) return null;
      Object.assign(record, update.$set);
      return record;
    },
    async findByIdAndDelete(id) {
      const index = state.records.findIndex((record) => record._id === id);
      if (index < 0) return null;
      return state.records.splice(index, 1)[0];
    },
  };
  const cloudinary = {
    uploader: {
      async destroy(publicId) {
        state.deletedCloudinaryAssets.push(publicId);
      },
    },
  };
  const stubs = {
    "mongoose": {
      Types: {
        ObjectId: {
          isValid: (value) => /^[a-f\d]{24}$/i.test(String(value)),
        },
      },
    },
    "../models/medicine": medicineModel,
    "../config/cloudinary": cloudinary,
    "../utils/cloudinaryUpload": async (file, folder) => {
      state.uploadedFiles.push({ file, folder });
      const index = state.uploadedFiles.length;
      return {
        secure_url: `https://res.cloudinary.com/healthhome/medicine-${index}.jpg`,
        public_id: `medicine-${index}`,
        resource_type: "image",
      };
    },
  };
  const originalLoad = Module._load;
  const controllerPath = require.resolve("../controllers/medicineController");
  delete require.cache[controllerPath];
  Module._load = function (request, parent, isMain) {
    if (Object.hasOwn(stubs, request)) return stubs[request];
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return require("../controllers/medicineController");
  } finally {
    Module._load = originalLoad;
    delete require.cache[controllerPath];
  }
};

const jpegFile = () => ({
  originalname: "medicine.jpg",
  mimetype: "image/jpeg",
  buffer: Buffer.from([0xff, 0xd8, 0xff, 0x01]),
});

const addBody = (overrides = {}) => ({
  pharmacyPhone: "attacker-controlled-phone",
  medicineName: "Paracetamol",
  category: "Tablet",
  manufacturer: "HealthHome Labs",
  description: "Pain relief",
  price: "25",
  stock: "20",
  ...overrides,
});

test("pharmacy medicine image upload, ownership, URL validation, and cleanup flow", async () => {
  const state = { records: [], uploadedFiles: [], deletedCloudinaryAssets: [] };
  const controller = loadController(state);
  const pharmacy = { phone: "919876543210" };

  const added = await invoke(controller.addMedicine, {
    pharmacy,
    body: addBody({ submissionKey: "paracetamol-add-attempt-01" }),
    file: jpegFile(),
  });
  assert.equal(added.statusCode, 201, JSON.stringify(added.body));
  assert.equal(added.body.medicine.pharmacyPhone, pharmacy.phone);
  assert.equal(
    added.body.medicine.image,
    "https://res.cloudinary.com/healthhome/medicine-1.jpg",
  );
  assert.equal(state.uploadedFiles[0].folder, "medicine_images");
  assert.equal(Object.hasOwn(added.body.medicine, "submissionKey"), false);

  const retriedAdd = await invoke(controller.addMedicine, {
    pharmacy,
    body: addBody({ submissionKey: "paracetamol-add-attempt-01" }),
    file: jpegFile(),
  });
  assert.equal(retriedAdd.statusCode, 200);
  assert.equal(retriedAdd.body.medicine._id, added.body.medicine._id);
  assert.equal(state.records.length, 1);
  assert.equal(state.uploadedFiles.length, 1);

  const withoutImage = await invoke(controller.addMedicine, {
    pharmacy,
    body: addBody({ medicineName: "Vitamin C" }),
  });
  assert.equal(withoutImage.statusCode, 201);
  assert.equal(withoutImage.body.medicine.image, "");

  const secondPhotographedMedicine = await invoke(controller.addMedicine, {
    pharmacy,
    body: addBody({ medicineName: "Cough Syrup" }),
    file: jpegFile(),
  });
  assert.equal(secondPhotographedMedicine.statusCode, 201);
  assert.equal(
    secondPhotographedMedicine.body.medicine.image,
    "https://res.cloudinary.com/healthhome/medicine-2.jpg",
  );

  const invalidUrl = await invoke(controller.addMedicine, {
    pharmacy,
    body: addBody({ image: "http://example.com/not-a-secure-medicine-image.jpg" }),
  });
  assert.equal(invalidUrl.statusCode, 400);
  assert.equal(state.records.length, 3);

  const all = await invoke(controller.getMedicines, {});
  assert.equal(all.statusCode, 200);
  assert.equal(all.body.medicines[0].image, added.body.medicine.image);
  assert.equal(all.body.medicines[1].image, "");
  assert.equal(
    all.body.medicines[2].image,
    secondPhotographedMedicine.body.medicine.image,
  );

  const medicineId = added.body.medicine._id;
  const unauthorizedUpdate = await invoke(controller.updateMedicine, {
    pharmacy: { phone: "another-pharmacy" },
    params: { id: medicineId },
    body: addBody(),
    file: jpegFile(),
  });
  assert.equal(unauthorizedUpdate.statusCode, 403);
  assert.equal(state.uploadedFiles.length, 2);

  const update = await invoke(controller.updateMedicine, {
    pharmacy,
    params: { id: medicineId },
    body: addBody(),
    file: jpegFile(),
  });
  assert.equal(update.statusCode, 200, JSON.stringify(update.body));
  assert.equal(
    update.body.medicine.image,
    "https://res.cloudinary.com/healthhome/medicine-3.jpg",
  );

  state.failUpdate = true;
  const failedReplacement = await invoke(controller.updateMedicine, {
    pharmacy,
    params: { id: medicineId },
    body: addBody(),
    file: jpegFile(),
  });
  assert.equal(failedReplacement.statusCode, 500);
  assert.equal(state.records[0].image, update.body.medicine.image);
  assert.deepEqual(state.deletedCloudinaryAssets, ["medicine-4"]);
  state.failUpdate = false;

  const badFile = await invoke(controller.addMedicine, {
    pharmacy,
    body: addBody(),
    file: { ...jpegFile(), originalname: "fake.jpg", buffer: Buffer.from("not an image") },
  });
  assert.equal(badFile.statusCode, 400);

  state.failCreate = true;
  const failedCreate = await invoke(controller.addMedicine, {
    pharmacy,
    body: addBody({ medicineName: "Unused upload" }),
    file: jpegFile(),
  });
  assert.equal(failedCreate.statusCode, 500);
  assert.deepEqual(state.deletedCloudinaryAssets, ["medicine-4", "medicine-5"]);
});

test("medicine schema preserves legacy records without photos", () => {
  const Medicine = require("../models/medicine");
  const legacy = new Medicine({
    pharmacyPhone: "919876543210",
    medicineName: "Legacy medicine",
    price: 1,
    stock: 1,
  });
  assert.equal(legacy.image, "");
  const retryIndex = Medicine.schema.indexes().find(
    ([keys]) => keys.pharmacyPhone === 1 && keys.submissionKey === 1,
  );
  assert.equal(retryIndex?.[1]?.unique, true);
});

test("inventory writes require an approved pharmacy JWT identity", async () => {
  let account = null;
  const userModel = {
    findById(id) {
      assert.equal(id, "507f1f77bcf86cd799439011");
      return {
        select() {
          return { lean: async () => account };
        },
      };
    },
  };
  const originalLoad = Module._load;
  const middlewarePath = require.resolve("../middleware/pharmacyMedicineAuth");
  delete require.cache[middlewarePath];
  Module._load = function (request, parent, isMain) {
    if (request === "../models/user") return userModel;
    return originalLoad.call(this, request, parent, isMain);
  };
  let middleware;
  try {
    middleware = require("../middleware/pharmacyMedicineAuth");
  } finally {
    Module._load = originalLoad;
    delete require.cache[middlewarePath];
  }

  const unauthenticated = await invoke(middleware, { user: null });
  assert.equal(unauthenticated.statusCode, 401);

  account = {
    _id: "507f1f77bcf86cd799439011",
    phone: "919876543210",
    role: "patient",
    verificationStatus: "NOT_REQUIRED",
  };
  const patient = await invoke(middleware, {
    user: { id: "507f1f77bcf86cd799439011", role: "pharmacy" },
  });
  assert.equal(patient.statusCode, 403);

  account.role = "pharmacy";
  account.verificationStatus = "PENDING";
  const pendingPharmacy = await invoke(middleware, {
    user: { id: "507f1f77bcf86cd799439011", role: "pharmacy" },
  });
  assert.equal(pendingPharmacy.statusCode, 403);

  account.verificationStatus = "APPROVED";
  let nextCalled = false;
  const approvedRequest = {
    user: { id: "507f1f77bcf86cd799439011", role: "pharmacy" },
    body: { pharmacyPhone: "attacker-controlled-phone" },
  };
  await middleware(
    approvedRequest,
    {
      status(code) { this.statusCode = code; return this; },
      json(value) { this.body = value; return this; },
    },
    () => { nextCalled = true; },
  );
  assert.equal(nextCalled, true);
  assert.deepEqual(approvedRequest.pharmacy, {
    id: "507f1f77bcf86cd799439011",
    phone: "919876543210",
  });
});
