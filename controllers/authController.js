const {
  register,
  login,
} = require("../services/authService");

async function registerUser(req, res) {
  const { name, email, password } = req.body || {};

  if (
    typeof name !== "string" ||
    !name.trim() ||
    typeof email !== "string" ||
    !email.trim() ||
    typeof password !== "string" ||
    password.length < 8
  ) {
    return res.status(400).json({
      success: false,
      message: "Provide a name, a valid email, and a password of at least 8 characters.",
    });
  }

  try {
    const result = await register({ name, email, password });

    return res.status(201).json({
      success: true,
      ...result,
    });
  } catch (error) {
    if (error.code === 11000 || error.code === "EMAIL_EXISTS") {
      return res.status(409).json({
        success: false,
        message: "An account with that email already exists.",
      });
    }

    console.error("User registration failed:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to register user.",
    });
  }
}

async function loginUser(req, res) {
  const { email, password } = req.body || {};

  if (
    typeof email !== "string" ||
    !email.trim() ||
    typeof password !== "string"
  ) {
    return res.status(400).json({
      success: false,
      message: "Provide an email and password.",
    });
  }

  try {
    const result = await login({ email, password });

    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    if (error.code === "INVALID_CREDENTIALS") {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    console.error("User login failed:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to log in.",
    });
  }
}

function getProfile(req, res) {
  return res.status(200).json({
    success: true,
    user: req.user,
  });
}

module.exports = {
  registerUser,
  loginUser,
  getProfile,
};
