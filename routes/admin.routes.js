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
  const { assetType, quantity, customer, plantId, description, pmCycle } = req.body;

  if (!assetType || !quantity || !customer || !plantId) {
    return res.status(400).json({ error: "Missing asset fields" });
  }

  let created = 0;
  for (let i = 1; i <= quantity; i++) {
    await Asset.create({
      assetId: `${assetType}-${Date.now()}-${i}`,
      assetType,
      customer,
      plantId,
      description,
      pmCycle,
      active: true
    });
    created++;
  }

  res.json({ created });
});

router.get("/assets/search", adminOnly, async (req, res) => {
  const q = {};
  if (req.query.assetId) q.assetId = req.query.assetId;
  if (req.query.plantId) q.plantId = req.query.plantId;
  if (req.query.assetType) q.assetType = req.query.assetType;

  const assets = await Asset.find(q).sort({ assetId: 1 });
  res.json(assets);
});

module.exports = router;
