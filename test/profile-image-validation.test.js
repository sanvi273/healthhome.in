const assert = require("node:assert/strict");
const test = require("node:test");

const detectProfileImageMimeType = require("../utils/profileImageValidation");

test("accepts supported profile image signatures", async (t) => {
  const validImages = [
    ["JPEG", Buffer.from([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0]), "image/jpeg"],
    ["PNG", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]), "image/png"],
    ["WEBP", Buffer.from("RIFF0000WEBP", "ascii"), "image/webp"],
  ];

  for (const [format, bytes, expectedMime] of validImages) {
    await t.test(format, () => {
      assert.equal(detectProfileImageMimeType(bytes), expectedMime);
    });
  }
});

test("rejects empty, non-image, and unrecognized file data", () => {
  assert.equal(detectProfileImageMimeType(null), null);
  assert.equal(detectProfileImageMimeType(Buffer.alloc(0)), null);
  assert.equal(detectProfileImageMimeType(Buffer.from("not an image")), null);
});
