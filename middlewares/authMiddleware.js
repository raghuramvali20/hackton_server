const jwt = require("jsonwebtoken");
const User = require("../model/User");

async function authMiddleware(req, res, next) {
  const authorization = req.headers.authorization;
  const [scheme, token] = authorization ? authorization.split(" ") : [];

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({
      success: false,
      message: "A Bearer token is required.",
    });
  }

  const secret = process.env.JWT_SECRET_KEY;

  if (!secret) {
    console.error("JWT_SECRET is not configured.");
    return res.status(500).json({
      success: false,
      message: "Authentication is not configured.",
    });
  }

  let payload;

  try {
    payload = jwt.verify(token, secret);
  } catch (_error) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token.",
    });
  }

  if (!payload.sub) {
    return res.status(401).json({
      success: false,
      message: "Invalid token.",
    });
  }

  try {
    const user = await User.findById(payload.sub).select(
      "_id name email createdAt"
    );

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "The token user no longer exists.",
      });
    }

    req.user = {
      _id: user._id,
      name: user.name,
      email: user.email,
      createdAt: user.createdAt,
    };

    return next();
  } catch (error) {
    console.error("Token user lookup failed:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to authenticate request.",
    });
  }
}

module.exports = authMiddleware;