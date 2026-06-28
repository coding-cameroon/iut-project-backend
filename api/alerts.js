const express = require("express");
const { body, validationResult } = require("express-validator");
const prisma = require("../lib/prisma");
const {
  requireManager,
  requireOwnershipOrRole,
} = require("../middleware/auth");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = process.env.UPLOAD_PATH || "./uploads";
    try {
      if (!fs.existsSync(uploadPath)) {
        fs.mkdirSync(uploadPath, { recursive: true });
      }
      cb(null, uploadPath);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const extension = path.extname(file.originalname);
    cb(null, (file.fieldname || "file") + "-" + uniqueSuffix + extension);
  },
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Type de fichier non autorisé"), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024,
    files: 5,
  },
});

/**
 * @route GET /api/alerts
 * @desc Récupération de la liste des alertes
 * @access Private (Manager/Admin)
 */
router.get("/", async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      status,
      type,
      priority,
      startDate,
      endDate,
      latitude,
      longitude,
      radius = 10000,
    } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    let alerts = [];
    let total = 0;

    // Mode 1: Geospatial Search
    if (latitude && longitude) {
      const lat = parseFloat(latitude);
      const lng = parseFloat(longitude);
      const rad = parseInt(radius);

      // Using Number() to safely handle BigInt from PostgreSQL
      const results = await prisma.$queryRaw`
        SELECT *, ST_Distance(ST_Point(longitude, latitude)::geography, ST_Point(${lng}, ${lat})::geography) as distance
        FROM "alerts"
        WHERE ST_DWithin(ST_Point(longitude, latitude)::geography, ST_Point(${lng}, ${lat})::geography, ${rad})
        ORDER BY distance ASC
        LIMIT ${limitNum} OFFSET ${skip}
      `;

      const countRes = await prisma.$queryRaw`
        SELECT COUNT(*) as count FROM "alerts"
        WHERE ST_DWithin(ST_Point(longitude, latitude)::geography, ST_Point(${lng}, ${lat})::geography, ${rad})
      `;

      alerts = results;
      total = Number(countRes[0].count);
    }
    // Mode 2: Standard Search
    else {
      const where = {
        ...(status && { status }),
        ...(type && { type }),
        ...(priority && { priority }),
        ...((startDate || endDate) && {
          createdAt: {
            ...(startDate && { gte: new Date(startDate) }),
            ...(endDate && { lte: new Date(endDate) }),
          },
        }),
      };

      [alerts, total] = await Promise.all([
        prisma.alert.findMany({
          where,
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                phone: true,
              },
            },
            media: true,
            responses: true,
            assignments: true,
          },
          skip,
          take: limitNum,
          orderBy: { createdAt: "desc" },
        }),
        prisma.alert.count({ where }),
      ]);
    }

    res.json({
      alerts,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    console.error("Error fetching alerts:", error);
    res.status(error.status || error.statusCode || 500).json({
      error: error.message || "Internal Server Error",
      code: "INTERNAL_ERROR",
    });
  }
});

/**
 * @route GET /api/alerts/:id
 * @desc Récupération d'une alerte par ID
 * @access Private
 */
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const alert = await prisma.alert.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
          },
        },
        media: true,
        responses: true,
        assignments: true,
      },
    });

    if (!alert) {
      return res.status(404).json({
        error: "Alerte non trouvée",
        code: "ALERT_NOT_FOUND",
      });
    }

    // Vérification des permissions
    if (req.user.role === "USER" && alert.userId !== req.user.id) {
      return res.status(403).json({
        error: "Accès non autorisé à cette alerte",
        code: "ALERT_ACCESS_DENIED",
      });
    }

    res.json({ alert });
  } catch (error) {
    console.error("Erreur lors de la récupération de l'alerte:", error);
    res.status(500).json({
      error: "Erreur interne du serveur",
      code: "INTERNAL_ERROR",
    });
  }
});

/**
 * @route GET /api/alerts/user/:id
 * @desc Récupération d'une alerte d'utilisateur
 * @access Private
 */
router.get("/user/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const alert = await prisma.alert.findMany({
      where: { userId: id },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
          },
        },
        media: true,
        responses: true,
        assignments: true,
      },
      orderBy: { createdAt: "desc" },
    });

    if (alert.length === 0) {
      return res.status(404).json({
        error: "Aucune alerte trouvée pour cet utilisateur",
        code: "ALERT_NOT_FOUND",
      });
    }

    res.json({ alert });
  } catch (error) {
    console.error("Erreur lors de la récupération de l'alerte:", error);
    res.status(500).json({
      error: "Erreur interne du serveur",
      code: "INTERNAL_ERROR",
    });
  }
});

/**
 * @route POST /api/alerts
 * @desc Création d'une nouvelle alerte avec support de fichiers
 * @access Private
 */
router.post(
  "/",
  upload.array("photos", 5),
  [
    body("title").trim().notEmpty().withMessage("Le titre est requis"),
    body("description")
      .trim()
      .notEmpty()
      .withMessage("La description est requise"),
    body("type").custom(async (value) => {
      const type = await prisma.alertType.findFirst({
        where: { name: value, isActive: true },
      });
      if (!type) {
        throw new Error("Type d'alerte invalide");
      }
      return true;
    }),
    body("priority")
      .optional()
      .isIn(["LOW", "MEDIUM", "HIGH", "CRITICAL"])
      .withMessage("Priorité invalide"),
    body("latitude")
      .isFloat({ min: -90, max: 90 })
      .withMessage("Latitude invalide"),
    body("longitude")
      .isFloat({ min: -180, max: 180 })
      .withMessage("Longitude invalide"),
    body("address").optional().trim(),
    body("city").optional().trim(),
    body("country").optional().trim(),
    body("isAnonymous").optional().toBoolean(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        // Supprimer les fichiers uploadés en cas d'erreur de validation
        if (req.files) {
          req.files.forEach((file) => fs.unlinkSync(file.path));
        }
        return res.status(400).json({
          error: "Données invalides",
          details: errors.array(),
        });
      }

      const {
        title,
        description,
        type,
        priority = "MEDIUM",
        latitude,
        longitude,
        address,
        city,
        country,
        isAnonymous = false,
      } = req.body;

      // Préparation des médias
      const mediaData = req.files
        ? req.files.map((file) => ({
            filename: file.filename,
            originalName: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
            path: file.path,
            url: `/uploads/${file.filename}`, // URL relative pour l'accès
          }))
        : [];

      // Récupération de l'ID du type d'alerte
      const alertTypeObj = await prisma.alertType.findFirst({
        where: { name: type },
      });

      // Création de l'alerte
      const alert = await prisma.alert.create({
        data: {
          title,
          description,
          type,
          alertTypeId: alertTypeObj ? alertTypeObj.id : undefined,
          priority,
          latitude: parseFloat(latitude),
          longitude: parseFloat(longitude),
          address,
          city,
          country,
          isAnonymous: isAnonymous === "true" || isAnonymous === true, // Gestion du boolean dans FormData
          userId: req.user.id,
          media: {
            create: mediaData,
          },
        },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
            },
          },
          media: true,
          responses: true,
          assignments: true,
        },
      });

      // Émission d'un événement Socket.IO pour les gestionnaires
      const io = req.app.get("io");
      if (io) {
        io.to("managers").emit("new-alert", alert);
      }

      res.status(201).json({
        message: "Alerte créée avec succès",
        alert,
      });
    } catch (error) {
      // Nettoyage des fichiers en cas d'erreur
      if (req.files) {
        req.files.forEach((file) => {
          try {
            if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
          } catch (e) {
            console.error("Erreur lors de la suppression du fichier:", e);
          }
        });
      }

      console.error("Erreur lors de la création de l'alerte:", error);
      res.status(500).json({
        error: "Erreur interne du serveur",
        code: "INTERNAL_ERROR",
      });
    }
  },
);

/**
 * @route PUT /api/alerts/:id
 * @desc Mise à jour d'une alerte
 * @access Private
 */
router.put(
  "/:id",
  [
    body("title")
      .optional()
      .trim()
      .notEmpty()
      .withMessage("Le titre ne peut pas être vide"),
    body("description")
      .optional()
      .trim()
      .notEmpty()
      .withMessage("La description ne peut pas être vide"),
    body("status")
      .optional()
      .isIn(["PENDING", "IN_PROGRESS", "RESOLVED", "CANCELLED"])
      .withMessage("Statut invalide"),
    body("priority")
      .optional()
      .isIn(["LOW", "MEDIUM", "HIGH", "CRITICAL"])
      .withMessage("Priorité invalide"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: "Données invalides",
          details: errors.array(),
        });
      }

      const { id } = req.params;
      const { title, description, status, priority } = req.body;

      // Vérification que l'alerte existe
      const existingAlert = await prisma.alert.findUnique({
        where: { id },
        select: { id: true, userId: true, status: true },
      });

      if (!existingAlert) {
        return res.status(404).json({
          error: "Alerte non trouvée",
          code: "ALERT_NOT_FOUND",
        });
      }

      // Vérification des permissions
      if (req.user.role === "USER" && existingAlert.userId !== req.user.id) {
        return res.status(403).json({
          error: "Accès non autorisé à cette alerte",
          code: "ALERT_ACCESS_DENIED",
        });
      }

      // Mise à jour de l'alerte
      const updatedAlert = await prisma.alert.update({
        where: { id },
        data: {
          ...(title && { title }),
          ...(description && { description }),
          ...(status && { status }),
          ...(priority && { priority }),
          ...(status === "RESOLVED" && { resolvedAt: new Date() }),
        },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
            },
          },
          media: true,
          responses: true,
          assignments: true,
        },
      });

      // Émission d'un événement Socket.IO pour la mise à jour
      const io = req.app.get("io");
      if (io) {
        io.to("managers").emit("alert-updated", updatedAlert);
        io.to(`user-${updatedAlert.userId}`).emit(
          "alert-updated",
          updatedAlert,
        );
      }

      res.json({
        message: "Alerte mise à jour avec succès",
        alert: updatedAlert,
      });
    } catch (error) {
      console.error("Erreur lors de la mise à jour de l'alerte:", error);
      res.status(500).json({
        error: "Erreur interne du serveur",
        code: "INTERNAL_ERROR",
      });
    }
  },
);

/**
 * @route POST /api/alerts/:id/assign
 * @desc Attribution d'une alerte à un gestionnaire
 * @access Private (Manager/Admin)
 */
router.post(
  "/:id/assign",
  [
    body("assignedTo")
      .notEmpty()
      .withMessage("Le gestionnaire assigné est requis"),
    body("notes").optional().trim(),
  ],
  requireManager,
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: "Données invalides",
          details: errors.array(),
        });
      }

      const { id } = req.params;
      const { assignedTo, notes } = req.body;

      // Vérification que l'alerte existe
      const alert = await prisma.alert.findUnique({
        where: { id },
        select: { id: true, status: true },
      });

      if (!alert) {
        return res.status(404).json({
          error: "Alerte non trouvée",
          code: "ALERT_NOT_FOUND",
        });
      }

      // Création de l'attribution
      const assignment = await prisma.alertAssignment.create({
        data: {
          alertId: id,
          assignedTo,
          notes,
          status: "ASSIGNED",
        },
      });

      // Mise à jour du statut de l'alerte
      await prisma.alert.update({
        where: { id },
        data: { status: "IN_PROGRESS" },
      });

      // Émission d'un événement Socket.IO
      const io = req.app.get("io");
      if (io) {
        io.to(`manager-${assignedTo}`).emit("alert-assigned", {
          alertId: id,
          assignment,
        });
      }

      res.status(201).json({
        message: "Alerte attribuée avec succès",
        assignment,
      });
    } catch (error) {
      console.error("Erreur lors de l'attribution de l'alerte:", error);
      res.status(500).json({
        error: "Erreur interne du serveur",
        code: "INTERNAL_ERROR",
      });
    }
  },
);

/**
 * @route DELETE /api/alerts/:id
 * @desc Suppression d'une alerte
 * @access Private
 */
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Vérification que l'alerte existe
    const alert = await prisma.alert.findUnique({
      where: { id },
      select: { id: true, userId: true },
    });

    if (!alert) {
      return res.status(404).json({
        error: "Alerte non trouvée",
        code: "ALERT_NOT_FOUND",
      });
    }

    // Vérification des permissions
    if (req.user.role === "USER" && alert.userId !== req.user.id) {
      return res.status(403).json({
        error: "Accès non autorisé à cette alerte",
        code: "ALERT_ACCESS_DENIED",
      });
    }

    // Suppression de l'alerte (cascade sur les médias, réponses et attributions)
    await prisma.alert.delete({
      where: { id },
    });

    res.json({
      message: "Alerte supprimée avec succès",
    });
  } catch (error) {
    console.error("Erreur lors de la suppression de l'alerte:", error);
    res.status(500).json({
      error: "Erreur interne du serveur",
      code: "INTERNAL_ERROR",
    });
  }
});

/**
 * @route GET /api/alerts/stats/summary
 * @desc Statistiques des alertes
 * @access Private (Manager/Admin)
 */
router.get("/stats/summary", requireManager, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const where = {};
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [
      totalAlerts,
      pendingAlerts,
      inProgressAlerts,
      resolvedAlerts,
      alertsByType,
      alertsByPriority,
    ] = await Promise.all([
      prisma.alert.count({ where }),
      prisma.alert.count({ where: { ...where, status: "PENDING" } }),
      prisma.alert.count({ where: { ...where, status: "IN_PROGRESS" } }),
      prisma.alert.count({ where: { ...where, status: "RESOLVED" } }),
      prisma.alert.groupBy({
        by: ["type"],
        where,
        _count: { type: true },
      }),
      prisma.alert.groupBy({
        by: ["priority"],
        where,
        _count: { priority: true },
      }),
    ]);

    res.json({
      summary: {
        total: totalAlerts,
        pending: pendingAlerts,
        inProgress: inProgressAlerts,
        resolved: resolvedAlerts,
      },
      byType: alertsByType,
      byPriority: alertsByPriority,
    });
  } catch (error) {
    console.error("Erreur lors de la récupération des statistiques:", error);
    res.status(500).json({
      error: "Erreur interne du serveur",
      code: "INTERNAL_ERROR",
    });
  }
});

module.exports = router;
