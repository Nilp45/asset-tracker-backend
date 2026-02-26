const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");

const User = require("../models/User");
const Plant = require("../models/Plant");
const Asset = require("../models/Asset");

/* ================= ADMIN GUARD ================= */
function adminOnly(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ error: "Admin access only" });
  }
  next();
}

/* =================================================
   USERS
================================================= */

/* GET USERS */
router.get("/users", adminOnly, async (req, res) => {
  const users = await User.find().sort({ username: 1 });
  res.json(users);
});

/* CREATE USER */
router.post("/create-user", adminOnly, async (req, res) => {
  const { username, password, role, plantId } = req.body;

  if (!username || !password || !role) {
    return res.status(400).json({ error: "Missing fields" });
  }

  if (role !== "admin" && !plantId) {
    return res.status(400).json({
      error: "Plant ID is mandatory for non-admin users"
    });
  }

  const exists = await User.findOne({ username });
  if (exists) {
    return res.status(400).json({ error: "User already exists" });
  }

  const passwordHash = await bcrypt.hash(password, 10);

  await User.create({
    username,
    passwordHash,
    role,
    plantId: role === "admin" ? null : plantId,
    active: true,
    forcePasswordChange: true
  });

  res.json({ ok: true });
});

/* ENABLE / DISABLE USER */
router.post("/users/:id/toggle", adminOnly, async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });

  user.active = !user.active;
  await user.save();

  res.json({ ok: true });
});

/* RESET PASSWORD */
router.post("/users/:id/reset-password", adminOnly, async (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: "Password too short" });
  }

  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });

  user.passwordHash = await bcrypt.hash(newPassword, 10);
  user.forcePasswordChange = true;
  await user.save();

  res.json({ ok: true });
});

/* =================================================
   PLANTS
================================================= */

router.post("/create-plant", adminOnly, async (req, res) => {
  const { plantId, plantName, address } = req.body;

  if (!plantId || !plantName) {
    return res.status(400).json({ error: "Missing plant details" });
  }

  const exists = await Plant.findOne({ plantId });
  if (exists) {
    return res.status(400).json({ error: "Plant already exists" });
  }

  await Plant.create({
    plantId,
    plantName,
    address,
    active: true
  });

  res.json({ ok: true });
});

router.get("/plants", adminOnly, async (req, res) => {
  res.json(await Plant.find().sort({ plantId: 1 }));
});

router.post("/plants/:plantId/toggle", adminOnly, async (req, res) => {
  const plant = await Plant.findOne({ plantId: req.params.plantId });
  if (!plant) return res.status(404).json({ error: "Plant not found" });

  plant.active = !plant.active;
  await plant.save();

  res.json({ ok: true });
});

/* =================================================
   ASSETS
================================================= */

router.post("/add-assets", adminOnly, async (req, res) => {

  const {
    assetType,
    quantity,
    customer,
    plantId,
    description,
    pmCycle
  } = req.body;

  if (!assetType || !quantity || !plantId) {
    return res.status(400).json({ error: "Missing asset fields" });
  }

  try {

    // Generate date YYYYMMDD
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    const dateStr = `${yyyy}${mm}${dd}`;

    const prefix = `${plantId}/${assetType}/${dateStr}/`;

    // 🔥 Get max serial from DB safely
    const lastAsset = await Asset.findOne({
      assetId: { $regex: `^${prefix}` }
    }).sort({ assetId: -1 });

    let nextSerial = 1;

    if (lastAsset) {
      const parts = lastAsset.assetId.split("/");
      const lastSerial = parseInt(parts[3]);
      if (!isNaN(lastSerial)) {
        nextSerial = lastSerial + 1;
      }
    }

    const newAssets = [];

    for (let i = 0; i < quantity; i++) {

      const serialFormatted = String(nextSerial + i).padStart(6, "0");
      const assetId = `${prefix}${serialFormatted}`;

      newAssets.push({
        assetId,
        assetType,
        customer,
        plantId,
        description,
        pmCycle: pmCycle || null,
        cycleSinceOk: 0,
        active: true,
        status: "AVAILABLE"
      });
    }

    await Asset.insertMany(newAssets, { ordered: true });

    res.json({ created: newAssets.length });

  } catch (err) {

    console.error("ADD ASSET ERROR:", err);

    // 🔥 If duplicate happens, retry once automatically
    if (err.code === 11000) {
      return res.status(400).json({
        error: "Asset ID conflict detected. Please retry."
      });
    }

    res.status(500).json({ error: "Server error" });
  }
});


/* SEARCH ASSETS */
router.get("/assets/search", adminOnly, async (req, res) => {
  const { assetId, plantId, assetType } = req.query;

  const filter = {};

  if (assetId) {
    filter.assetId = { $regex: assetId, $options: "i" };
  }

  if (plantId) {
    filter.plantId = plantId;
  }

  if (assetType) {
    filter.assetType = assetType;
  }

  try {
    const assets = await Asset.find(filter).sort({ createdAt: -1 });
    res.json(assets);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});


module.exports = router;

