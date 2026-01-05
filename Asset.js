const mongoose = require("mongoose");

const AssetSchema = new mongoose.Schema(
  {
    assetId: {
      type: String,
      required: true,
      unique: true,
      uppercase: true
    },

    assetType: {
      type: String,
      required: true,
      uppercase: true
    },

    customer: {
      type: String,
      required: true
    },

    plantId: {
      type: String,
      required: true,
      uppercase: true
    },

    description: {
      type: String,
      default: ""
    },

    pmCycle: {
      type: Number,
      default: null
    },

    cycleSinceOk: { type: Number, default: 0 },
    
    lastOkAt: { type: Date, default: null },


    status: {
      type: String,
      default: "AVAILABLE"
    },

    active: {
      type: Boolean,
      default: true
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Asset", AssetSchema);
