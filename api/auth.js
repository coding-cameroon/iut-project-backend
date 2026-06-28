const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { body, validationResult } = require("express-validator");
const prisma = require("../lib/prisma");

const router = express.Router();

// ─── helpers ────────────────────────────────────────────────────────────────

function signToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "24h",
  });
}

function extractToken(req) {
  const auth = req.headers["authorization"];
  return auth && auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

const handleValidation = (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res
      .status(400)
      .json({ error: "Données invalides", details: errors.array() });
    return false;
  }
  return true;
};

// ─── POST /api/auth/register ─────────────────────────────────────────────────

router.post(
  "/register",
  [
    body("email").isEmail().normalizeEmail().withMessage("Email invalide"),
    body("password")
      .isLength({ min: 6 })
      .withMessage("Le mot de passe doit contenir au moins 6 caractères"),
    body("firstName").trim().notEmpty().withMessage("Le prénom est requis"),
    body("lastName").trim().notEmpty().withMessage("Le nom est requis"),
    // FIX: only validate phone format when it's actually provided
    body("phone")
      .optional({ nullable: true, checkFalsy: true })
      .isMobilePhone("any")
      .withMessage("Numéro de téléphone invalide"),
  ],
  async (req, res) => {
    try {
      if (!handleValidation(req, res)) return;

      const { email, password, firstName, lastName, phone } = req.body;

      const existingUser = await prisma.user.findFirst({
        where: {
          OR: [{ email }, ...(phone ? [{ phone }] : [])],
        },
      });

      if (existingUser) {
        return res.status(409).json({
          error:
            "Un utilisateur avec cet email ou ce numéro de téléphone existe déjà",
          code: "USER_EXISTS",
        });
      }

      const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
      const hashedPassword = await bcrypt.hash(password, saltRounds);

      const user = await prisma.user.create({
        data: {
          email,
          password: hashedPassword,
          firstName,
          lastName,
          phone: phone || null,
          role: "USER",
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          phone: true,
          role: true,
          createdAt: true,
        },
      });

      const token = signToken({ userId: user.id, email: user.email });

      return res
        .status(201)
        .json({ message: "Utilisateur créé avec succès", user, token });
    } catch (error) {
      console.error("Erreur inscription:", error);
      return res
        .status(500)
        .json({ error: "Erreur interne du serveur", code: "INTERNAL_ERROR" });
    }
  },
);

// ─── POST /api/auth/login ─────────────────────────────────────────────────────

router.post(
  "/login",
  [
    body("email").isEmail().normalizeEmail().withMessage("Email invalide"),
    body("password").notEmpty().withMessage("Le mot de passe est requis"),
  ],
  async (req, res) => {
    try {
      if (!handleValidation(req, res)) return;

      const { email, password } = req.body;
      // FIX: removed console.log that was leaking credentials

      const user = await prisma.user.findUnique({
        where: { email },
        select: {
          id: true,
          email: true,
          password: true,
          firstName: true,
          lastName: true,
          phone: true,
          role: true,
          isActive: true,
        },
      });

      // FIX: use constant-time compare even on missing user to prevent timing attacks
      const dummyHash =
        "$2a$12$invalidhashfortimingneutralityxxxxxxxxxxxxxxxxxxxxxxxxxxx";
      const isPasswordValid = await bcrypt.compare(
        password,
        user?.password ?? dummyHash,
      );

      if (!user || !isPasswordValid) {
        return res.status(401).json({
          error: "Email ou mot de passe incorrect",
          code: "INVALID_CREDENTIALS",
        });
      }

      if (!user.isActive) {
        return res
          .status(401)
          .json({ error: "Compte désactivé", code: "ACCOUNT_DISABLED" });
      }

      const { password: _, ...userWithoutPassword } = user;
      const token = signToken({ userId: user.id, email: user.email });

      return res.json({
        message: "Connexion réussie",
        user: userWithoutPassword,
        token,
      });
    } catch (error) {
      console.error("Erreur connexion:", error);
      return res
        .status(500)
        .json({ error: "Erreur interne du serveur", code: "INTERNAL_ERROR" });
    }
  },
);

// ─── POST /api/auth/logout ────────────────────────────────────────────────────

router.post("/logout", (req, res) => {
  // Stateless JWT — token invalidation requires a blocklist (Redis etc.)
  // For now this is intentionally a no-op on the server side
  return res.json({ message: "Déconnexion réussie" });
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────

router.get("/me", async (req, res) => {
  try {
    const token = extractToken(req);
    if (!token) {
      return res
        .status(401)
        .json({ error: "Token d'accès requis", code: "MISSING_TOKEN" });
    }

    let decoded;
    try {
      decoded = verifyToken(token);
    } catch (err) {
      // FIX: handle expired tokens explicitly instead of letting them 500
      const code =
        err.name === "TokenExpiredError" ? "TOKEN_EXPIRED" : "INVALID_TOKEN";
      return res.status(401).json({ error: "Token invalide ou expiré", code });
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });

    if (!user) {
      return res
        .status(404)
        .json({ error: "Utilisateur non trouvé", code: "USER_NOT_FOUND" });
    }

    // FIX: original code was missing this check
    if (!user.isActive) {
      return res
        .status(401)
        .json({ error: "Compte désactivé", code: "ACCOUNT_DISABLED" });
    }

    return res.json({ user });
  } catch (error) {
    console.error("Erreur profil:", error);
    return res
      .status(500)
      .json({ error: "Erreur interne du serveur", code: "INTERNAL_ERROR" });
  }
});

// ─── POST /api/auth/refresh ───────────────────────────────────────────────────

router.post("/refresh", async (req, res) => {
  try {
    const token = extractToken(req);
    if (!token) {
      return res
        .status(401)
        .json({ error: "Token d'accès requis", code: "MISSING_TOKEN" });
    }

    let decoded;
    try {
      // FIX: allow verifying expired tokens so we can still read the userId
      // and issue a new token (the typical refresh pattern)
      decoded = jwt.verify(token, process.env.JWT_SECRET, {
        ignoreExpiration: true,
      });
    } catch (err) {
      return res
        .status(401)
        .json({ error: "Token invalide", code: "INVALID_TOKEN" });
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, email: true, isActive: true },
    });

    if (!user || !user.isActive) {
      return res.status(401).json({
        error: "Utilisateur non trouvé ou inactif",
        code: "USER_NOT_FOUND",
      });
    }

    const newToken = signToken({ userId: user.id, email: user.email });
    return res.json({
      message: "Token renouvelé avec succès",
      token: newToken,
    });
  } catch (error) {
    console.error("Erreur refresh token:", error);
    return res
      .status(500)
      .json({ error: "Erreur interne du serveur", code: "INTERNAL_ERROR" });
  }
});

// ─── POST /api/auth/forgot-password ──────────────────────────────────────────

router.post(
  "/forgot-password",
  [body("email").isEmail().normalizeEmail().withMessage("Email invalide")],
  async (req, res) => {
    try {
      if (!handleValidation(req, res)) return;

      const { email } = req.body;

      // Always return the same response regardless of whether email exists (security)
      const user = await prisma.user.findUnique({
        where: { email },
        select: { id: true, email: true, firstName: true },
      });

      if (user) {
        // TODO: generate a signed reset token, store it, and send via email
        // e.g. sendPasswordResetEmail(user)
      }

      return res.json({
        message:
          "Si cet email existe, vous recevrez un lien de réinitialisation",
      });
    } catch (error) {
      console.error("Erreur forgot-password:", error);
      return res
        .status(500)
        .json({ error: "Erreur interne du serveur", code: "INTERNAL_ERROR" });
    }
  },
);

module.exports = router;
