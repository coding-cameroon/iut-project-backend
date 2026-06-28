const express = require("express");
const prisma = require("../lib/prisma");
const { requireManager } = require("../middleware/auth");

const router = express.Router();

/**
 * @route GET /api/dashboard/stats
 * @desc Statistiques générales du dashboard
 * @access Private (Manager/Admin)
 */
router.get("/stats", requireManager, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    // Construction des filtres de date
    const dateFilter = {};
    if (startDate || endDate) {
      dateFilter.createdAt = {};

      // Convertir les plages de temps en dates réelles
      if (startDate) {
        let date;
        if (startDate === "24h") {
          date = new Date(Date.now() - 24 * 60 * 60 * 1000);
        } else if (startDate === "7d") {
          date = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        } else if (startDate === "30d") {
          date = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        } else {
          date = new Date(startDate);
        }
        dateFilter.createdAt.gte = date;
      }

      if (endDate) {
        dateFilter.createdAt.lte = new Date(endDate);
      }
    }

    // Statistiques générales
    const [
      totalAlerts,
      pendingAlerts,
      inProgressAlerts,
      resolvedAlerts,
      cancelledAlerts,
      totalUsers,
      activeUsers,
      alertsByType,
      alertsByPriority,
      alertsByStatus,
      recentAlerts,
    ] = await Promise.all([
      // Total des alertes
      prisma.alert.count({ where: dateFilter }),

      // Alertes en attente
      prisma.alert.count({ where: { ...dateFilter, status: "PENDING" } }),

      // Alertes en cours
      prisma.alert.count({ where: { ...dateFilter, status: "IN_PROGRESS" } }),

      // Alertes résolues
      prisma.alert.count({ where: { ...dateFilter, status: "RESOLVED" } }),

      // Alertes annulées
      prisma.alert.count({ where: { ...dateFilter, status: "CANCELLED" } }),

      // Total des utilisateurs
      prisma.user.count(),

      // Utilisateurs actifs (ayant créé au moins une alerte)
      prisma.user.count({
        where: {
          alerts: {
            some: dateFilter,
          },
        },
      }),

      // Alertes par type
      prisma.alert.groupBy({
        by: ["type"],
        where: dateFilter,
        _count: { type: true },
      }),

      // Alertes par priorité
      prisma.alert.groupBy({
        by: ["priority"],
        where: dateFilter,
        _count: { priority: true },
      }),

      // Alertes par statut
      prisma.alert.groupBy({
        by: ["status"],
        where: dateFilter,
        _count: { status: true },
      }),

      // Alertes récentes (dernières 10)
      prisma.alert.findMany({
        where: dateFilter,
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          media: {
            select: {
              id: true,
              mimeType: true,
              url: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
    ]);

    // Calcul du taux de résolution
    const resolutionRate =
      totalAlerts > 0 ? (resolvedAlerts / totalAlerts) * 100 : 0;

    // Calcul du temps de réponse moyen (en heures) - simplifié pour éviter l'erreur Prisma
    const avgResponseTime = null; // Temporairement désactivé jusqu'à correction du schéma

    res.json({
      summary: {
        totalAlerts,
        pendingAlerts,
        inProgressAlerts,
        resolvedAlerts,
        cancelledAlerts,
        totalUsers,
        activeUsers,
        resolutionRate: Math.round(resolutionRate * 100) / 100,
      },
      breakdown: {
        byType: alertsByType,
        byPriority: alertsByPriority,
        byStatus: alertsByStatus,
      },
      recentAlerts,
    });
  } catch (error) {
    console.error("Erreur lors de la récupération des statistiques:", error);
    res.status(500).json({
      error: "Erreur interne du serveur",
      code: "INTERNAL_ERROR",
    });
  }
});

/**
 * @route GET /api/dashboard/alerts/map
 * @desc Alertes pour l'affichage sur carte
 * @access Private (Manager/Admin)
 */
router.get("/alerts/map", requireManager, async (req, res) => {
  try {
    const {
      status,
      type,
      priority,
      startDate,
      endDate,
      bounds, // Format: { north, south, east, west }
    } = req.query;

    // Construction des filtres
    const where = {};

    if (status) where.status = status;
    if (type) where.type = type;
    if (priority) where.priority = priority;

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    // Filtrage par bounds si fourni
    if (bounds) {
      const { north, south, east, west } = JSON.parse(bounds);
      where.latitude = {
        gte: parseFloat(south),
        lte: parseFloat(north),
      };
      where.longitude = {
        gte: parseFloat(west),
        lte: parseFloat(east),
      };
    }

    const alerts = await prisma.alert.findMany({
      where,
      select: {
        id: true,
        title: true,
        type: true,
        priority: true,
        status: true,
        latitude: true,
        longitude: true,
        address: true,
        city: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
        media: {
          select: {
            id: true,
            mimeType: true,
            url: true,
          },
          take: 1,
        },
      },
      orderBy: { createdAt: "desc" },
      take: 1000, // Limite pour éviter les surcharges
    });

    res.json({ alerts });
  } catch (error) {
    console.error(
      "Erreur lors de la récupération des alertes pour la carte:",
      error,
    );
    res.status(500).json({
      error: "Erreur interne du serveur",
      code: "INTERNAL_ERROR",
    });
  }
});

/**
 * @route GET /api/dashboard/alerts/timeline
 * @desc Timeline des alertes
 * @access Private (Manager/Admin)
 */
router.get("/alerts/timeline", requireManager, async (req, res) => {
  try {
    const { days = 7 } = req.query;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    const timeline = await prisma.alert.groupBy({
      by: ["createdAt"],
      where: {
        createdAt: {
          gte: startDate,
        },
      },
      _count: {
        id: true,
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    // Formatage pour le graphique
    const formattedTimeline = timeline.map((item) => ({
      date: item.createdAt.toISOString().split("T")[0],
      count: item._count.id,
    }));

    res.json({ timeline: formattedTimeline });
  } catch (error) {
    console.error("Erreur lors de la récupération de la timeline:", error);
    res.status(500).json({
      error: "Erreur interne du serveur",
      code: "INTERNAL_ERROR",
    });
  }
});

/**
 * @route GET /api/dashboard/heatmap
 * @desc Données pour la carte de chaleur
 * @access Private (Manager/Admin)
 */
router.get("/heatmap", requireManager, async (req, res) => {
  try {
    const { startDate, endDate, type } = req.query;

    const where = {};

    if (type) where.type = type;

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    // Récupération des coordonnées avec densité
    const heatmapData = await prisma.alert.findMany({
      where,
      select: {
        latitude: true,
        longitude: true,
        type: true,
        priority: true,
        createdAt: true,
      },
    });

    // Groupement par zones (arrondi à 3 décimales pour créer des zones)
    const zones = {};
    heatmapData.forEach((alert) => {
      const lat = Math.round(alert.latitude * 1000) / 1000;
      const lng = Math.round(alert.longitude * 1000) / 1000;
      const key = `${lat},${lng}`;

      if (!zones[key]) {
        zones[key] = {
          latitude: lat,
          longitude: lng,
          count: 0,
          types: {},
          priorities: {},
        };
      }

      zones[key].count++;
      zones[key].types[alert.type] = (zones[key].types[alert.type] || 0) + 1;
      zones[key].priorities[alert.priority] =
        (zones[key].priorities[alert.priority] || 0) + 1;
    });

    const heatmapPoints = Object.values(zones).map((zone) => ({
      latitude: zone.latitude,
      longitude: zone.longitude,
      intensity: zone.count,
      types: zone.types,
      priorities: zone.priorities,
    }));

    res.json({ heatmap: heatmapPoints });
  } catch (error) {
    console.error(
      "Erreur lors de la récupération des données de carte de chaleur:",
      error,
    );
    res.status(500).json({
      error: "Erreur interne du serveur",
      code: "INTERNAL_ERROR",
    });
  }
});

/**
 * @route GET /api/dashboard/performance
 * @desc Métriques de performance
 * @access Private (Manager/Admin)
 */
router.get("/performance", requireManager, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const where = {};
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    // Calcul des métriques de performance
    const [
      avgResponseTime,
      resolutionTimes,
      alertsByHour,
      topAlertTypes,
      topCities,
    ] = await Promise.all([
      // Temps de réponse moyen
      prisma.alert.aggregate({
        where: {
          ...where,
          status: "RESOLVED",
          resolvedAt: { not: null },
        },
        _avg: {
          // Calcul basé sur la différence entre createdAt et resolvedAt
        },
      }),

      // Temps de résolution par alerte
      prisma.alert.findMany({
        where: {
          ...where,
          status: "RESOLVED",
          resolvedAt: { not: null },
        },
        select: {
          createdAt: true,
          resolvedAt: true,
          type: true,
          priority: true,
        },
      }),

      // Alertes par heure de la journée
      prisma.alert.groupBy({
        by: ["createdAt"],
        where,
        _count: { id: true },
      }),

      // Types d'alertes les plus fréquents
      prisma.alert.groupBy({
        by: ["type"],
        where,
        _count: { type: true },
        orderBy: { _count: { type: "desc" } },
        take: 5,
      }),

      // Villes avec le plus d'alertes
      prisma.alert.groupBy({
        by: ["city"],
        where: {
          ...where,
          city: { not: null },
        },
        _count: { city: true },
        orderBy: { _count: { city: "desc" } },
        take: 10,
      }),
    ]);

    // Calcul du temps de résolution moyen en heures
    const resolutionTimesInHours = resolutionTimes.map((alert) => {
      const diffMs = new Date(alert.resolvedAt) - new Date(alert.createdAt);
      return diffMs / (1000 * 60 * 60); // Conversion en heures
    });

    const avgResolutionTime =
      resolutionTimesInHours.length > 0
        ? resolutionTimesInHours.reduce((a, b) => a + b, 0) /
          resolutionTimesInHours.length
        : 0;

    res.json({
      metrics: {
        avgResponseTime: Math.round(avgResolutionTime * 100) / 100,
        totalResolved: resolutionTimes.length,
      },
      insights: {
        topAlertTypes,
        topCities: topCities.filter((city) => city.city),
      },
    });
  } catch (error) {
    console.error(
      "Erreur lors de la récupération des métriques de performance:",
      error,
    );
    res.status(500).json({
      error: "Erreur interne du serveur",
      code: "INTERNAL_ERROR",
    });
  }
});

/**
 * @route GET /api/dashboard/notifications
 * @desc Notifications pour le dashboard
 * @access Private (Manager/Admin)
 */
router.get("/notifications", requireManager, async (req, res) => {
  try {
    const { limit = 20 } = req.query;

    // Alertes critiques récentes
    const criticalAlerts = await prisma.alert.findMany({
      where: {
        priority: "CRITICAL",
        status: { in: ["PENDING", "IN_PROGRESS"] },
      },
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: parseInt(limit),
    });

    // Alertes non assignées
    const unassignedAlerts = await prisma.alert.findMany({
      where: {
        status: "PENDING",
        assignments: {
          none: {},
        },
      },
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: parseInt(limit),
    });

    // Alertes en retard (plus de 1 heure sans mise à jour)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const overdueAlerts = await prisma.alert.findMany({
      where: {
        status: "IN_PROGRESS",
        updatedAt: { lt: oneHourAgo },
      },
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: { updatedAt: "asc" },
      take: parseInt(limit),
    });

    res.json({
      criticalAlerts,
      unassignedAlerts,
      overdueAlerts,
    });
  } catch (error) {
    console.error("Erreur lors de la récupération des notifications:", error);
    res.status(500).json({
      error: "Erreur interne du serveur",
      code: "INTERNAL_ERROR",
    });
  }
});

module.exports = router;
