const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43]);

function loadStorage({ upload, privateDownloadUrl } = {}) {
  const originalLoad = Module._load;
  const utilityPath = require.resolve("../utils/patientReportStorage");
  const cloudinaryUploadPath = require.resolve("../utils/cloudinaryUpload");
  const cloudinaryConfigPath = require.resolve("../config/cloudinary");
  const previousModules = new Map(
    [utilityPath, cloudinaryUploadPath, cloudinaryConfigPath].map((path) => [
      path,
      require.cache[path],
    ]),
  );
  const uploadCalls = [];
  const signedUrlCalls = [];
  for (const path of previousModules.keys()) delete require.cache[path];
  Module._load = function (request, parent, isMain) {
    if (request === "./cloudinaryUpload") {
      return async (...args) => {
        uploadCalls.push(args);
        return upload ? upload(...args) : {};
      };
    }
    if (request === "../config/cloudinary") {
      return {
        utils: {
          private_download_url: (...args) => {
            signedUrlCalls.push(args);
            return privateDownloadUrl
              ? privateDownloadUrl(...args)
              : "https://res.cloudinary.com/example/private-download";
          },
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return { storage: require("../utils/patientReportStorage"), uploadCalls, signedUrlCalls };
  } finally {
    Module._load = originalLoad;
    for (const [path, moduleEntry] of previousModules) {
      delete require.cache[path];
      if (moduleEntry) require.cache[path] = moduleEntry;
    }
  }
}

test("accepts supported image and PDF signatures and rejects unknown bytes", () => {
  const { storage } = loadStorage();
  assert.equal(storage.detectPatientReportFormat(jpegBytes).fileType, "image/jpeg");
  assert.equal(
    storage.detectPatientReportFormat(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    ).fileType,
    "image/png",
  );
  assert.equal(
    storage.detectPatientReportFormat(
      Buffer.from("RIFFxxxxWEBP", "ascii"),
    ).fileType,
    "image/webp",
  );
  assert.equal(
    storage.detectPatientReportFormat(Buffer.from("%PDF-1.7", "ascii")).fileType,
    "application/pdf",
  );
  assert.equal(storage.detectPatientReportFormat(Buffer.from("not an image")), null);
});

test("uploads verified report bytes as authenticated Cloudinary assets", async () => {
  const { storage, uploadCalls } = loadStorage({
    upload: async () => ({
      secure_url: "https://res.cloudinary.com/example/image/authenticated/report.jpg",
      public_id: "appointment_reports/report",
      resource_type: "image",
      format: "jpg",
    }),
  });
  const report = await storage.uploadPatientReport({
    originalname: "blood-test.jpg",
    buffer: jpegBytes,
  });

  assert.equal(uploadCalls.length, 1);
  assert.equal(uploadCalls[0][1], "appointment_reports");
  assert.deepEqual(uploadCalls[0][2], { type: "authenticated" });
  assert.equal(report.storagePublicId, "appointment_reports/report");
  assert.equal(report.resourceType, "image");
  assert.equal(report.fileFormat, "jpg");
  assert.equal(report.fileType, "image/jpeg");
  assert.equal(report.fileName, "blood-test.jpg");
  assert.equal(Object.hasOwn(report, "fileUrl"), false);
});

test("retrieves private reports through a short-lived signed URL and validates bytes", async () => {
  const { storage, signedUrlCalls } = loadStorage({
    privateDownloadUrl: () => "https://res.cloudinary.com/example/signed-report",
  });
  const originalFetch = global.fetch;
  let requestedUrl;
  let fetchOptions;
  global.fetch = async (url, options) => {
    requestedUrl = url;
    fetchOptions = options;
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () =>
        jpegBytes.buffer.slice(
          jpegBytes.byteOffset,
          jpegBytes.byteOffset + jpegBytes.byteLength,
        ),
    };
  };

  try {
    const result = await storage.getPatientReportBytes({
      storagePublicId: "appointment_reports/report",
      resourceType: "image",
      fileFormat: "jpg",
    });
    assert.equal(requestedUrl, "https://res.cloudinary.com/example/signed-report");
    assert.equal(fetchOptions.redirect, "error");
    assert.equal(signedUrlCalls[0][0], "appointment_reports/report");
    assert.equal(signedUrlCalls[0][1], "jpg");
    assert.equal(signedUrlCalls[0][2].type, "authenticated");
    assert.ok(signedUrlCalls[0][2].expires_at <= Math.floor(Date.now() / 1000) + 60);
    assert.deepEqual(result.bytes, jpegBytes);
    assert.equal(result.fileType, "image/jpeg");
  } finally {
    global.fetch = originalFetch;
  }
});

test("keeps legacy report retrieval restricted to the configured Cloudinary host", async () => {
  const previousCloudName = process.env.CLOUDINARY_CLOUD_NAME;
  process.env.CLOUDINARY_CLOUD_NAME = "healthhome";
  const { storage } = loadStorage();
  const legacyUrl =
    "https://res.cloudinary.com/healthhome/image/upload/legacy-report.jpg";
  assert.equal(storage.isAllowedLegacyCloudinaryUrl(legacyUrl), true);
  assert.equal(
    storage.isAllowedLegacyCloudinaryUrl(
      "https://res.cloudinary.com/other/image/upload/legacy-report.jpg",
    ),
    false,
  );
  assert.equal(
    storage.isAllowedLegacyCloudinaryUrl(
      "http://res.cloudinary.com/healthhome/image/upload/legacy-report.jpg",
    ),
    false,
  );
  assert.equal(
    storage.isAllowedLegacyCloudinaryUrl(
      "https://attacker.example/healthhome/report.jpg",
    ),
    false,
  );

  const originalFetch = global.fetch;
  let requestedUrl;
  global.fetch = async (url) => {
    requestedUrl = url;
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () =>
        jpegBytes.buffer.slice(
          jpegBytes.byteOffset,
          jpegBytes.byteOffset + jpegBytes.byteLength,
        ),
    };
  };

  try {
    const result = await storage.getPatientReportBytes({ fileUrl: legacyUrl });
    assert.equal(requestedUrl, legacyUrl);
    assert.equal(result.fileType, "image/jpeg");
    await assert.rejects(
      storage.getPatientReportBytes({
        fileUrl: "https://attacker.example/healthhome/report.jpg",
      }),
      { statusCode: 404 },
    );
  } finally {
    global.fetch = originalFetch;
    if (previousCloudName === undefined) delete process.env.CLOUDINARY_CLOUD_NAME;
    else process.env.CLOUDINARY_CLOUD_NAME = previousCloudName;
  }
});
