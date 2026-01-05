const mongoose = require("mongoose");

const PlantSchema = new mongoose.Schema({
  plantId: {
    type: String,
    required: true,
    unique: true
  },
  plantName: {
    type: String,
    required: true
  },
  
  address: {
    type: String,
    required: true
  },

  active: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model("Plant", PlantSchema);
