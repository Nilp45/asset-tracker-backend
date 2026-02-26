const mongoose = require("mongoose");

const AssetRequestItemSchema = new mongoose.Schema({
  batchId: { type: mongoose.Schema.Types.ObjectId, ref: "AssetRequestBatch" },
  assetId: String
}, { timestamps: true });

module.exports = mongoose.model("AssetRequestItem", AssetRequestItemSchema);
