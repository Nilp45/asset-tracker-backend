const mongoose = require("mongoose");

const SessionSchema = new mongoose.Schema({
  mode: {
    type: String,
    enum: ["IN", "OUT", "MAINT", "OK"],
    required: true
  },

  documentNo: {
    type: String,
    default: null
  },

  totalQty: {
    type: Number,
    default: null
  },

  scannedQty: {
    type: Number,
    default: 0
  },

  remark: { type: String, default: "" },


  plantId: {
    type: String,
    required: true
  },

  createdBy: {
    type: String,
    required: true
  },

  status: {
    type: String,
    enum: ["active", "completed"],
    default: "active"
  },

  shipToAddress: {
    type: String
  },

  transporter:{ type:String},

  transportMode: { type:String},

  vehicleNo: { type:String},


  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model("Session", SessionSchema);
