const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true
  },

  passwordHash: {
    type: String,
    required: true
  },

  role: {
    type: String,
    enum: ["admin", "operator"],
    required: true
  },

  plantId: {
    type: String,
    default: null
  },

  active: {
    type: Boolean,
    default: true
  },

  /* ✅ ADD HERE (INSIDE SCHEMA OBJECT) */
  forcePasswordChange: {
    type: Boolean,
    default: true
  },

  tokenVersion: { type: Number, default: 0 }


});

module.exports = mongoose.model("User", UserSchema);
