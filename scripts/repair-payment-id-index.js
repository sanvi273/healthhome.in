require("dotenv").config();

const mongoose = require("mongoose");

const args = process.argv.slice(2);
const optionValue = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : "";
};
const applyChanges = args.includes("--apply");
const expectedDatabase = optionValue("--confirm-db");

const isExpectedPartialIndex = (index) => {
  const filter = index?.partialFilterExpression?.paymentId;
  return Boolean(
    index?.unique === true &&
    filter &&
    filter.$type === "string" &&
    filter.$gt === ""
  );
};

const hasDuplicateNonEmptyIds = async (collection) => {
  const duplicates = await collection.aggregate([
    { $match: { paymentId: { $type: "string", $gt: "" } } },
    { $group: { _id: "$paymentId", count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $limit: 10 },
  ]).toArray();
  return duplicates;
};

const restoreIndex = async (collection, index) => {
  const options = { name: index.name };
  for (const key of [
    "unique",
    "sparse",
    "expireAfterSeconds",
    "partialFilterExpression",
    "collation",
    "hidden",
  ]) {
    if (Object.prototype.hasOwnProperty.call(index, key)) {
      options[key] = index[key];
    }
  }
  await collection.createIndex(index.key, options);
};

const main = async () => {
  if (!process.env.MONGO_URL) {
    throw new Error("MONGO_URL is not configured in this environment.");
  }
  if (!expectedDatabase) {
    throw new Error(
      "Pass --confirm-db <database-name> after confirming the intended target database.",
    );
  }

  await mongoose.connect(process.env.MONGO_URL);
  const databaseName = mongoose.connection.name;
  if (databaseName !== expectedDatabase) {
    throw new Error(
      `Connected database is "${databaseName}", not the confirmed database "${expectedDatabase}". No index changes were made.`,
    );
  }

  const collection = mongoose.connection.db.collection("payments");
  const indexes = await collection.indexes();
  const existing = indexes.find(
    (index) =>
      Object.keys(index.key || {}).length === 1 &&
      index.key.paymentId === 1,
  );

  if (existing && isExpectedPartialIndex(existing)) {
    console.log(`Database "${databaseName}" already has the expected partial unique paymentId index.`);
    return;
  }

  const duplicates = await hasDuplicateNonEmptyIds(collection);
  if (duplicates.length) {
    console.error(
      `Cannot safely create the partial unique index: ${duplicates.length} duplicate non-empty paymentId value(s) found (IDs withheld).`,
    );
    process.exitCode = 2;
    return;
  }

  const nullOrMissingCount = await collection.countDocuments({
    $or: [
      { paymentId: null },
      { paymentId: { $exists: false } },
      { paymentId: "" },
    ],
  });

  console.log(`Confirmed database: ${databaseName}`);
  console.log("Payment records will not be changed.");
  console.log(`Records with null, missing, or empty paymentId: ${nullOrMissingCount}`);
  console.log("Target index: unique paymentId for non-empty strings only.");

  if (!applyChanges) {
    console.log("DRY RUN: no index changes were made. Add --apply only after reviewing this output.");
    return;
  }

  if (existing) {
    console.log(`Replacing the existing paymentId index: ${existing.name}`);
    await collection.dropIndex(existing.name);
  }

  try {
    await collection.createIndex(
      { paymentId: 1 },
      {
        name: "paymentId_1",
        unique: true,
        partialFilterExpression: {
          paymentId: { $type: "string", $gt: "" },
        },
      },
    );
  } catch (error) {
    if (existing) {
      try {
        await restoreIndex(collection, existing);
        console.error(`New index creation failed; restored the previous index ${existing.name}.`);
      } catch (restoreError) {
        console.error("New index creation and previous-index restoration both failed.");
        console.error(`Restore error: ${restoreError.message}`);
      }
    }
    throw error;
  }

  console.log("Repaired paymentId index successfully. No payment records were modified.");
};

main()
  .catch((error) => {
    console.error("Payment index repair stopped:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  });
