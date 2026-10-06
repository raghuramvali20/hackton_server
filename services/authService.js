const jwt = require("jsonwebtoken");
const User = require("../model/User");
const config = require("../config/env");

function createToken(userId) {
  if (!config.jwtSecretKey) {
    throw new Error("JWT_SECRET_KEY is not configured.");
  }

  return jwt.sign({}, config.jwtSecretKey, {
    subject: userId.toString(),
    expiresIn: "30d",
  });
}

function publicUser(user) {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    createdAt: user.createdAt,
  };
}

async function register({ name, email, password }) {
  const normalizedEmail = email.trim().toLowerCase();
  const existingUser = await User.findOne({ email: normalizedEmail });

  if (existingUser) {
    const error = new Error("An account with that email already exists.");
    error.code = "EMAIL_EXISTS";
    throw error;
  }

  const user = await User.create({
    name: name.trim(),
    email: normalizedEmail,
    password,
  });

  return {
    token: createToken(user._id),
    user: publicUser(user),
  };
}

async function login({ email, password }) {
  const user = await User.findOne({
    email: email.trim().toLowerCase(),
  }).select("+password");

  if (!user || !(await user.comparePassword(password))) {
    const error = new Error("Invalid email or password.");
    error.code = "INVALID_CREDENTIALS";
    throw error;
  }

  return {
    token: createToken(user._id),
    user: publicUser(user),
  };
}

module.exports = {
  register,
  login,
};