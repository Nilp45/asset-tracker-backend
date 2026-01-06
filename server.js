require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

/* ================= MODELS ================= */
const User = require("./models/User");
const Asset = require("./models/Asset");
const Session = require("./models/Session");
const Scan = require("./models/Scan");
const Plant = require("./models/Plant");

/* ================= ROUTES ================= */
const adminRoutes = require("./routes/admin.routes");
const assetRoutes = require("./routes/asset.routes");
const dashboardRoutes = require("./routes/dashboard.routes");
const challanRoutes = require("./routes/challan.routes");
const transactionRoutes = require("./routes/transaction.routes");

/* ================= APP ================= */
const app = express();

/* ================= CORS (ENV BASED) ================= */
const allowedOrigins = process.env.FRONTEND_URLS
  ? process.env.FRONTEND_URLS.split(",")
  : [];

app.use(cors({
  origin: function (origin, callback) {
    // allow non-browser tools (Postman)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(
      new Error("CORS blocked: " + origin),
      false
    );
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.options("*", cors());
app.use(express.json());

/* ================= DATABASE ================= */
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => {
    console.error("❌ MongoDB error:", err);
    process.exit(1);
  });

/* ================= AUTH MIDDLEWARE ================= */
function auth(req, res, next) {
  const hdr = req.headers.authorization;
  if (!hdr) {
    return res.status(401).json({ error: "Session expired" });
  }

  try {
    const token = hdr.split(" ")[1];
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    return res.status(403).json({ error: "Invalid token" });
  }
}

/* ================= LOGIN ================= */
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;

  const user = await User.findOne({ username, active: true });
  if (!user) {
    return res.status(401).json({ error: "User not found" });
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: "Incorrect password" });
  }

  const token = jwt.sign(
    {
      userId: user._id.toString(),
      username: user.username,
      role: user.role,
      tokenVersion: user.tokenVersion || 0
    },
    process.env.JWT_SECRET,
    { expiresIn: "8h" }
  );

  res.json({
    token,
    role: user.role,
    plantId: user.plantId || null,
    forcePasswordChange: user.forcePasswordChange
  });
});

/* ================= CHANGE PASSWORD ================= */
app.post("/api/change-password", auth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword)
      return res.status(400).json({ error: "All fields required" });

    if (newPassword.length < 6)
      return res.status(400).json({ error: "Password too short" });

    const user = await User.findById(req.user.userId);
    if (!user)
      return res.status(404).json({ error: "User not found" });

    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok)
      return res.status(403).json({ error: "Current password incorrect" });

    user.passwordHash = await bcrypt.hash(newPassword, 10);
    user.forcePasswordChange = false;
    user.tokenVersion += 1; // invalidate old tokens
    await user.save();

    res.json({ ok: true });

  } catch (err) {
    console.error("Change password error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ================= PLANTS ================= */
app.get("/api/admin/plants", auth, async (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Admin access only" });
  }
  const plants = await Plant.find({ active: true }).sort({ plantId: 1 });
  res.json(plants);
});

/* ================= SESSION START ================= */
app.post("/api/session/start", auth, async (req, res) => {
  const { mode, documentNo, totalQty, plantId } = req.body;

  if (!plantId)
    return res.status(400).json({ error: "Plant not selected" });

  if (["IN", "OUT"].includes(mode)) {
    if (!documentNo)
      return res.status(400).json({ error: "Document number required" });

    if (!totalQty || totalQty <= 0)
      return res.status(400).json({ error: "Quantity must be > 0" });

    const existing = await Session.findOne({
      documentNo,
      plantId,
      status: "completed"
    });

    if (existing)
      return res.status(400).json({
        error: "Duplicate completed document not allowed"
      });
  }

  const session = await Session.create({
    mode,
    documentNo: documentNo || null,
    totalQty: totalQty || null,
    scannedQty: 0,
    plantId,
    createdBy: req.user.username,
    status: "active"
  });

  res.json({ sessionId: session._id });
});

/* ================= SCAN ================= */
app.post("/api/scan", auth, async (req, res) => {
  try {
    let { sessionId, assetId, plantId } = req.body;
    assetId = assetId.toUpperCase();

    const session = await Session.findById(sessionId);
    if (!session || session.status !== "active")
      return res.status(400).json({ error: "Invalid or closed session" });

    if (session.plantId !== plantId)
      return res.status(403).json({ error: "Plant mismatch" });

    if (session.totalQty && session.scannedQty >= session.totalQty)
      return res.status(400).json({ error: "Quantity already completed" });

    const asset = await Asset.findOne({ assetId, plantId, active: true });
    if (!asset)
      return res.status(400).json({ error: "Asset not found" });

    if (await Scan.findOne({ sessionId, assetId }))
      return res.status(400).json({ error: "Duplicate scan" });

    const lastScan = await Scan.findOne({ assetId, plantId })
      .sort({ createdAt: -1 });

    let currentStatus = "NO_MOVEMENT";
    if (lastScan) {
      if (["IN", "OK"].includes(lastScan.mode)) currentStatus = "AT_PLANT";
      else if (lastScan.mode === "OUT") currentStatus = "AT_CUSTOMER";
      else if (lastScan.mode === "MAINT") currentStatus = "AT_MAINTENANCE";
    }

    const invalid =
      (currentStatus === "AT_PLANT" && session.mode === "IN") ||
      (currentStatus === "AT_CUSTOMER" && session.mode === "OUT") ||
      (currentStatus === "AT_MAINTENANCE" && ["IN", "OUT"].includes(session.mode)) ||
      (currentStatus !== "AT_MAINTENANCE" && session.mode === "OK") ||
      (currentStatus !== "AT_PLANT" && session.mode === "MAINT");

    if (invalid)
      return res.status(400).json({ error: "Invalid movement" });

    await Scan.create({
      sessionId,
      assetId,
      plantId,
      mode: session.mode,
      byUser: req.user.username,
      movementTime: new Date()
    });

    if (session.mode === "IN") asset.cycleSinceOk++;
    if (session.mode === "OK") {
      asset.cycleSinceOk = 0;
      asset.lastOkAt = new Date();
    }
    await asset.save();

    session.scannedQty++;
    if (session.totalQty && session.scannedQty >= session.totalQty)
      session.status = "completed";

    await session.save();

    res.json({
      scannedQty: session.scannedQty,
      remainingQty: session.totalQty
        ? session.totalQty - session.scannedQty
        : null
    });

  } catch (err) {
    console.error("Scan error:", err);
    res.status(500).json({ error: "Scan failed" });
  }
});

/* ================= SESSION CLOSE ================= */
app.post("/api/session/close", auth, async (req, res) => {
  const { sessionId } = req.body;

  const session = await Session.findById(sessionId);
  if (!session || session.status !== "active")
    return res.status(400).json({ error: "Invalid session" });

  if (session.totalQty && session.scannedQty < session.totalQty) {
    session.remark =
      `${session.totalQty - session.scannedQty} qty short against document`;
  }

  session.status = "completed";
  await session.save();

  res.json({ ok: true });
});

/* ================= ROUTES ================= */
app.use("/api/admin", auth, adminRoutes);
app.use("/api/assets", auth, assetRoutes);
app.use("/api/dashboard", auth, dashboardRoutes);
app.use("/api/challan", auth, challanRoutes);
app.use("/api/transactions", auth, transactionRoutes);

/* ================= START ================= */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
