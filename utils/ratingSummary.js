const Rating = require("../models/Rating");

const attachRatingSummaries = async (entityType, entities) => {
  if (!entities.length) return entities;

  const ids = entities.map((item) => String(item._id));
  const summaries = await Rating.aggregate([
    { $match: { entityType, targetId: { $in: ids } } },
    {
      $group: {
        _id: "$targetId",
        average: { $avg: "$rating" },
        count: { $sum: 1 },
      },
    },
  ]);
  const byId = new Map(summaries.map((item) => [item._id, item]));

  return entities.map((entity) => {
    const serialized = typeof entity.toObject === "function"
      ? entity.toObject()
      : { ...entity };
    const summary = byId.get(String(entity._id));
    serialized.rating = summary ? Number(summary.average.toFixed(1)) : 0;
    serialized.ratingCount = summary?.count || 0;
    return serialized;
  });
};

module.exports = { attachRatingSummaries };
