const mongoose = require("mongoose");

const scanSchema = new mongoose.Schema(
  {
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Session",
      required: true
    },
    assetId: {
      type: String,
      required: true
    },
    plantId: {
      type: String,
      required: true
    },
    mode: {
      type: String,
      enum: ["IN", "OUT", "MAINT", "OK"],
      required: true
    },
    byUser: {
      type: String,
      required: true
    },

    /* ✅ EXPLICIT MOVEMENT TIME */
    movementTime: {
      type: Date,
      required: true,
      default: () => new Date()
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model("Scan", scanSchema);
