const jwt = require("jsonwebtoken");
const prisma = require("../lib/prisma");

/**
 * Middleware d'authentification
 * @param {Object} req - Requête
 * @param {Object} res - Réponse
 * @param {Function} next - Fonction suivante
 */
const authMiddleware = async (req, res, next) => {
  try {
    const token = req.header("Authorization")?.replace("Bearer ", "");

    if (!token) {
      return res.status(401).json({
        error: "Token d'authentification requis",
        code: "NO_TOKEN",
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Vérification de l'utilisateur en base de données
    const user = await prisma.user.findUnique({
      where: { id: decoded.id || decoded.userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
      },
    });

    if (!user || !user.isActive) {
      return res.status(401).json({
        error: "Utilisateur non trouvé ou inactif",
        code: "USER_NOT_FOUND",
      });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({
        error: "Token invalide",
        code: "INVALID_TOKEN",
      });
    }

    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        error: "Token expiré",
        code: "TOKEN_EXPIRED",
      });
    }

    console.error("Erreur d'authentification:", error);
    res.status(500).json({
      error: "Erreur interne du serveur",
      code: "AUTH_ERROR",
    });
  }
};

/**
 * Middleware pour vérifier si l'utilisateur est admin
 */
const requireAdmin = (req, res, next) => {
  if (
    req.user &&
    (req.user.role === "ADMIN" || req.user.role === "SUPER_ADMIN")
  ) {
    next();
  } else {
    res.status(403).json({
      error: "Accès refusé. Droits d'administrateur requis.",
      code: "FORBIDDEN",
    });
  }
};

/**
 * Middleware pour vérifier si l'utilisateur est super admin
 */
const requireSuperAdmin = (req, res, next) => {
  if (req.user && req.user.role === "SUPER_ADMIN") {
    next();
  } else {
    res.status(403).json({
      error: "Accès refusé. Droits de super administrateur requis.",
      code: "FORBIDDEN",
    });
  }
};

/**
 * Middleware pour vérifier si l'utilisateur est manager
 */
const requireManager = (req, res, next) => {
  if (
    req.user &&
    (req.user.role === "MANAGER" ||
      req.user.role === "ADMIN" ||
      req.user.role === "SUPER_ADMIN")
  ) {
    next();
  } else {
    res.status(403).json({
      error: "Accès refusé. Droits de manager requis.",
      code: "FORBIDDEN",
    });
  }
};

/**
 * Middleware pour vérifier si l'utilisateur est propriétaire de la ressource ou a un rôle spécifique
 */
const requireOwnershipOrRole = (roles) => (req, res, next) => {
  const userId = req.params.id; // Supposons que l'ID de la ressource utilisateur est dans les params
  const allowedRoles = Array.isArray(roles) ? roles : [roles];

  if (
    req.user &&
    (req.user.id === userId ||
      allowedRoles.includes(req.user.role) ||
      req.user.role === "ADMIN" ||
      req.user.role === "SUPER_ADMIN")
  ) {
    next();
  } else {
    res.status(403).json({
      error: "Accès refusé.",
      code: "FORBIDDEN",
    });
  }
};

/**
 * Alias pour les permissions de routage (Manager/Admin/SuperAdmin)
 */
const requireRoutingPermission = requireManager;

module.exports = {
  authMiddleware,
  requireAdmin,
  requireSuperAdmin,
  requireManager,
  requireOwnershipOrRole,
  requireRoutingPermission,
};
