const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");

const Asset = require("../models/Asset");
const AssetRequestBatch = require("../models/AssetRequestBatch");
const AssetRequestItem = require("../models/AssetRequestItem");

/* =====================================
   CREATE BATCH REQUEST (OPERATOR)
===================================== */
router.post("/batch", auth, async (req, res) => {
  const { requestType, assets, reason, plantId } = req.body;
  const { username, role } = req.user;

  if (!["ENABLE", "DISABLE"].includes(requestType)) {
    return res.status(400).json({ error: "Invalid request type" });
  }

  if (!assets || assets.length === 0) {
    return res.status(400).json({ error: "No assets scanned" });
  }

  try {
    const batch = await AssetRequestBatch.create({
      plantId: plantId || null,
      requestType,
      requestedBy: username,
      requestedRole: role,
      reason,
      status: "PENDING"
    });

    const items = assets.map(a => ({
      batchId: batch._id,
      assetId: a.toUpperCase()
    }));

    await AssetRequestItem.insertMany(items);

    res.json({ message: "Request sent for admin approval" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =====================================
   GET ALL PENDING BATCHES (ADMIN)
===================================== */
router.get("/pending", auth, async (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Admin only" });
  }

  try {
    const batches = await AssetRequestBatch
      .find({ status: "PENDING" })
      .sort({ createdAt: -1 });

    res.json(batches);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =====================================
   APPROVE BATCH (ADMIN)
===================================== */
router.post("/:id/approve", auth, async (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Admin only" });
  }

  try {
    const batch = await AssetRequestBatch.findById(req.params.id);
    if (!batch) return res.status(404).json({ error: "Batch not found" });

    batch.status = "APPROVED";
    await batch.save();

    // Get all items in batch
    const items = await AssetRequestItem.find({ batchId: batch._id });

    const assetIds = items.map(i => i.assetId);

    // Update assets
    await Asset.updateMany(
      { assetId: { $in: assetIds } },
      { active: batch.requestType === "ENABLE" }
    );

    res.json({ ok: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =====================================
   REJECT BATCH (ADMIN)
===================================== */
router.post("/:id/reject", auth, async (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Admin only" });
  }

  try {
    const batch = await AssetRequestBatch.findById(req.params.id);
    if (!batch) return res.status(404).json({ error: "Batch not found" });

    batch.status = "REJECTED";
    await batch.save();

    res.json({ ok: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;