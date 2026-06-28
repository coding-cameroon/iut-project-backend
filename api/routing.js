const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../lib/prisma');
const { requireRoutingPermission } = require('../middleware/auth');
const IntelligentRoutingService = require('../services/intelligentRoutingService');
const AIService = require('../services/aiService');
const MonitoringService = require('../services/monitoringService');

const router = express.Router();
const monitoringService = new MonitoringService();

/**
 * @route POST /api/routing/route-alert/:alertId
 * @desc Route une alerte vers les services d'urgence appropriés
 * @access Private (Manager/Admin/SuperAdmin)
 */
router.post('/route-alert/:alertId', requireRoutingPermission, async (req, res) => {
  try {
    const { alertId } = req.params;
    const { forceRouting = false } = req.body;

    // Récupération de l'alerte avec toutes ses données
    const alert = await prisma.alert.findUnique({
      where: { id: alertId },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            role: true
          }
        },
        media: true,
        responses: true,
        assignments: true
      }
    });

    if (!alert) {
      return res.status(404).json({
        error: 'Alerte non trouvée',
        code: 'ALERT_NOT_FOUND'
      });
    }

    // Vérification si l'alerte a déjà été routée
    if (alert.assignments.length > 0 && !forceRouting) {
      return res.status(409).json({
        error: 'Cette alerte a déjà été routée',
        code: 'ALERT_ALREADY_ROUTED',
        existingAssignments: alert.assignments
      });
    }

    // Analyse IA de l'alerte si pas encore faite
    let analysis;
    if (!alert.isVerified || forceRouting) {
      const alertWithContext = {
        ...alert,
        userAlertHistory: await getAlertHistory(alert.userId),
        nearbyAlerts: await getNearbyAlerts(alert)
      };
      
      analysis = await AIService.analyzeAlert(alertWithContext);
    } else {
      // Utilisation de l'analyse existante
      analysis = {
        classification: {
          predictedType: alert.type,
          confidence: 0.8
        },
        priority: {
          level: alert.priority
        },
        recommendations: {
          suggestedServices: getDefaultServices(alert.type)
        }
      };
    }

    // Routage intelligent
    const routingResult = await IntelligentRoutingService.routeAlert(alert, analysis);

    if (!routingResult.success) {
      return res.status(500).json({
        error: 'Erreur lors du routage de l\'alerte',
        code: 'ROUTING_FAILED',
        details: routingResult.error
      });
    }

    // Mise à jour du statut de l'alerte
    await prisma.alert.update({
      where: { id: alertId },
      data: { status: 'IN_PROGRESS' }
    });

    res.json({
      message: 'Alerte routée avec succès',
      alertId,
      routingResult
    });

  } catch (error) {
    console.error('Erreur lors du routage de l\'alerte:', error);
    res.status(500).json({
      error: 'Erreur interne du serveur',
      code: 'ROUTING_ERROR'
    });
  }
});

/**
 * @route POST /api/routing/batch-route
 * @desc Route plusieurs alertes en lot
 * @access Private (Manager/Admin/SuperAdmin)
 */
router.post('/batch-route', [
  body('alertIds').isArray().withMessage('Liste d\'IDs d\'alertes requise'),
  body('alertIds.*').isString().withMessage('ID d\'alerte invalide'),
  body('forceRouting').optional().isBoolean().withMessage('forceRouting doit être un booléen')
], requireRoutingPermission, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Données invalides',
        details: errors.array()
      });
    }

    const { alertIds, forceRouting = false } = req.body;
    const results = [];

    for (const alertId of alertIds) {
      try {
        // Récupération de l'alerte
        const alert = await prisma.alert.findUnique({
          where: { id: alertId },
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                phone: true
              }
            },
            media: true,
            assignments: true
          }
        });

        if (!alert) {
          results.push({
            alertId,
            success: false,
            error: 'Alerte non trouvée'
          });
          continue;
        }

        // Vérification si déjà routée
        if (alert.assignments.length > 0 && !forceRouting) {
          results.push({
            alertId,
            success: false,
            error: 'Alerte déjà routée',
            existingAssignments: alert.assignments.length
          });
          continue;
        }

        // Analyse IA
        const alertWithContext = {
          ...alert,
          userAlertHistory: await getAlertHistory(alert.userId),
          nearbyAlerts: await getNearbyAlerts(alert)
        };
        
        const analysis = await AIService.analyzeAlert(alertWithContext);

        // Routage
        const routingResult = await IntelligentRoutingService.routeAlert(alert, analysis);

        if (routingResult.success) {
          await prisma.alert.update({
            where: { id: alertId },
            data: { status: 'IN_PROGRESS' }
          });
        }

        results.push({
          alertId,
          success: routingResult.success,
          ...routingResult
        });

      } catch (error) {
        console.error(`Erreur lors du routage de l'alerte ${alertId}:`, error);
        results.push({
          alertId,
          success: false,
          error: error.message
        });
      }
    }

    res.json({
      message: 'Routage en lot terminé',
      results,
      summary: {
        total: alertIds.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length
      }
    });

  } catch (error) {
    console.error('Erreur lors du routage en lot:', error);
    res.status(500).json({
      error: 'Erreur interne du serveur',
      code: 'BATCH_ROUTING_ERROR'
    });
  }
});

/**
 * @route GET /api/routing/statistics
 * @desc Statistiques de routage
 * @access Private (Manager/Admin/SuperAdmin)
 */
router.get('/statistics', requireRoutingPermission, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    const filters = {};
    if (startDate || endDate) {
      filters.startDate = startDate;
      filters.endDate = endDate;
    }

    const statistics = await IntelligentRoutingService.getRoutingStatistics(filters);
    
    res.json(statistics);

  } catch (error) {
    console.error('Erreur lors de la récupération des statistiques de routage:', error);
    res.status(500).json({
      error: 'Erreur interne du serveur',
      code: 'ROUTING_STATISTICS_ERROR'
    });
  }
});

/**
 * @route GET /api/routing/services/:serviceId/performance
 * @desc Performance d'un service d'urgence
 * @access Private (Manager/Admin/SuperAdmin)
 */
router.get('/services/:serviceId/performance', requireRoutingPermission, async (req, res) => {
  try {
    const { serviceId } = req.params;
    const { startDate, endDate } = req.query;

    // Vérification de l'existence du service
    const service = await prisma.emergencyService.findUnique({
      where: { id: serviceId }
    });

    if (!service) {
      return res.status(404).json({
        error: 'Service d\'urgence non trouvé',
        code: 'SERVICE_NOT_FOUND'
      });
    }

    // Construction des filtres
    const where = { assignedTo: serviceId };
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    // Statistiques de performance
    const [
      totalAssignments,
      completedAssignments,
      averageResponseTime,
      assignmentsByType,
      assignmentsByPriority,
      recentAssignments
    ] = await Promise.all([
      prisma.alertAssignment.count({ where }),
      prisma.alertAssignment.count({
        where: { ...where, status: 'COMPLETED' }
      }),
      calculateServiceResponseTime(serviceId, where),
      getAssignmentsByType(serviceId, where),
      getAssignmentsByPriority(serviceId, where),
      prisma.alertAssignment.findMany({
        where,
        include: {
          alert: {
            select: {
              id: true,
              title: true,
              type: true,
              priority: true,
              status: true,
              createdAt: true
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        take: 10
      })
    ]);

    const successRate = totalAssignments > 0 ? (completedAssignments / totalAssignments) * 100 : 0;

    res.json({
      serviceId,
      serviceName: service.name,
      performance: {
        totalAssignments,
        completedAssignments,
        successRate: Math.round(successRate * 100) / 100,
        averageResponseTime,
        assignmentsByType,
        assignmentsByPriority
      },
      recentAssignments,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Erreur lors de la récupération de la performance du service:', error);
    res.status(500).json({
      error: 'Erreur interne du serveur',
      code: 'SERVICE_PERFORMANCE_ERROR'
    });
  }
});

/**
 * @route POST /api/routing/optimize
 * @desc Optimise le routage des alertes
 * @access Private (Admin/SuperAdmin)
 */
router.post('/optimize', requireRoutingPermission, async (req, res) => {
  try {
    const { alertIds, optimizationType = 'balanced' } = req.body;

    if (!alertIds || !Array.isArray(alertIds)) {
      return res.status(400).json({
        error: 'Liste d\'IDs d\'alertes requise',
        code: 'ALERT_IDS_REQUIRED'
      });
    }

    const results = [];

    for (const alertId of alertIds) {
      try {
        const alert = await prisma.alert.findUnique({
          where: { id: alertId },
          include: {
            user: true,
            media: true,
            assignments: true
          }
        });

        if (!alert) {
          results.push({
            alertId,
            success: false,
            error: 'Alerte non trouvée'
          });
          continue;
        }

        // Analyse IA avec optimisation
        const alertWithContext = {
          ...alert,
          userAlertHistory: await getAlertHistory(alert.userId),
          nearbyAlerts: await getNearbyAlerts(alert)
        };
        
        const analysis = await AIService.analyzeAlert(alertWithContext);

        // Routage optimisé
        const routingResult = await IntelligentRoutingService.routeAlert(alert, analysis);

        results.push({
          alertId,
          success: routingResult.success,
          optimizationType,
          ...routingResult
        });

      } catch (error) {
        console.error(`Erreur lors de l'optimisation de l'alerte ${alertId}:`, error);
        results.push({
          alertId,
          success: false,
          error: error.message
        });
      }
    }

    res.json({
      message: 'Optimisation du routage terminée',
      results,
      summary: {
        total: alertIds.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length
      }
    });

  } catch (error) {
    console.error('Erreur lors de l\'optimisation du routage:', error);
    res.status(500).json({
      error: 'Erreur interne du serveur',
      code: 'ROUTING_OPTIMIZATION_ERROR'
    });
  }
});

/**
 * Fonctions utilitaires
 */

async function getAlertHistory(userId) {
  try {
    return await prisma.alert.findMany({
      where: { userId },
      select: {
        id: true,
        type: true,
        priority: true,
        status: true,
        createdAt: true
      },
      orderBy: { createdAt: 'desc' },
      take: 10
    });
  } catch (error) {
    console.error('Erreur lors de la récupération de l\'historique:', error);
    return [];
  }
}

async function getNearbyAlerts(alert) {
  try {
    return await prisma.$queryRaw`
      SELECT id, type, priority, status, latitude, longitude,
      ST_Distance(
        ST_Point(longitude, latitude)::geography,
        ST_Point(${alert.longitude}, ${alert.latitude})::geography
      ) as distance
      FROM "alerts"
      WHERE id != ${alert.id}
      AND ST_DWithin(
        ST_Point(longitude, latitude)::geography,
        ST_Point(${alert.longitude}, ${alert.latitude})::geography,
        5000
      )
      ORDER BY distance ASC
      LIMIT 5
    `;
  } catch (error) {
    console.error('Erreur lors de la récupération des alertes proches:', error);
    return [];
  }
}

function getDefaultServices(alertType) {
  const serviceMap = {
    'ACCIDENT': ['POLICE', 'AMBULANCE'],
    'FIRE': ['FIRE_DEPARTMENT', 'AMBULANCE'],
    'MEDICAL_EMERGENCY': ['AMBULANCE', 'HOSPITAL'],
    'SECURITY_INCIDENT': ['POLICE'],
    'NATURAL_DISASTER': ['CIVIL_PROTECTION', 'FIRE_DEPARTMENT'],
    'OTHER': ['POLICE']
  };
  
  return serviceMap[alertType] || ['POLICE'];
}

async function calculateServiceResponseTime(serviceId, where) {
  try {
    const assignments = await prisma.alertAssignment.findMany({
      where: {
        ...where,
        assignedTo: serviceId,
        status: 'COMPLETED'
      },
      select: {
        createdAt: true,
        updatedAt: true
      }
    });

    if (assignments.length === 0) return 0;

    const totalMinutes = assignments.reduce((total, assignment) => {
      const responseTime = assignment.updatedAt.getTime() - assignment.createdAt.getTime();
      return total + (responseTime / (1000 * 60));
    }, 0);

    return Math.round((totalMinutes / assignments.length) * 100) / 100;
  } catch (error) {
    console.error('Erreur lors du calcul du temps de réponse:', error);
    return 0;
  }
}

async function getAssignmentsByType(serviceId, where) {
  try {
    return await prisma.alertAssignment.groupBy({
      by: ['alert'],
      where: {
        ...where,
        assignedTo: serviceId
      },
      _count: { alert: true }
    });
  } catch (error) {
    console.error('Erreur lors de la récupération des assignations par type:', error);
    return [];
  }
}

async function getAssignmentsByPriority(serviceId, where) {
  try {
    return await prisma.alertAssignment.groupBy({
      by: ['alert'],
      where: {
        ...where,
        assignedTo: serviceId
      },
      _count: { alert: true }
    });
  } catch (error) {
    console.error('Erreur lors de la récupération des assignations par priorité:', error);
    return [];
  }
}

module.exports = router;











