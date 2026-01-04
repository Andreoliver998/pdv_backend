const userService = require("./users.service");

function requireOwner(req) {
  return req.user && req.user.role === "OWNER";
}

async function list(req, res, next) {
  try {
    if (!requireOwner(req)) {
      return res.status(403).json({ message: "Only OWNER can manage users" });
    }

    const users = await userService.listUsers(req.user.merchantId);
    res.json(users);
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    if (!requireOwner(req)) {
      return res.status(403).json({ message: "Only OWNER can manage users" });
    }

    const user = await userService.createUser(
      req.user.merchantId,
      req.body
    );

    res.status(201).json(user);
  } catch (err) {
    if (err.message === "EMAIL_ALREADY_IN_USE") {
      return res.status(400).json({ message: "E-mail já cadastrado" });
    }
    next(err);
  }
}

async function update(req, res, next) {
  try {
    if (!requireOwner(req)) {
      return res.status(403).json({ message: "Only OWNER can manage users" });
    }

    const user = await userService.updateUser(
      req.user.merchantId,
      req.params.id,
      req.body
    );

    res.json(user);
  } catch (err) {
    next(err);
  }
}

async function updateStatus(req, res, next) {
  try {
    if (!requireOwner(req)) {
      return res.status(403).json({ message: "Only OWNER can manage users" });
    }

    const { isActive } = req.body;

    if (typeof isActive !== "boolean") {
      return res.status(400).json({ message: "isActive must be boolean" });
    }

    const user = await userService.updateUserStatus(
      req.user.merchantId,
      req.params.id,
      isActive
    );

    res.json(user);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  list,
  create,
  update,
  updateStatus,
};
