const mongoose = require("mongoose");

const AssetRequestBatchSchema = new mongoose.Schema({
  plantId: String,
  requestType: { type: String, enum: ["ENABLE", "DISABLE"], required: true },
  requestedBy: String,
  requestedRole: String,
  reason: String,
  status: { type: String, enum: ["PENDING", "APPROVED", "REJECTED"], default: "PENDING" },
  approvedBy: String,
  approvedAt: Date,
  remarks: String
}, { timestamps: true });

module.exports = mongoose.model("AssetRequestBatch", AssetRequestBatchSchema);
