const jwt = require("jsonwebtoken");

module.exports = function auth(req, res, next) {
  const hdr = req.headers.authorization;
  if (!hdr) {
    return res.status(401).json({ error: "Session expired" });
  }

  try {
    req.user = jwt.verify(hdr.split(" ")[1], process.env.JWT_SECRET);
    next();
  } catch (err) {
    return res.status(403).json({ error: "Invalid token" });
  }
};

console.log("JWT SECRET:", process.env.JWT_SECRET);