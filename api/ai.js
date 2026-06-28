const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../lib/prisma');
const AIService = require('../services/aiService');
const { requireManager } = require('../middleware/auth');

const router = express.Router();

/**
 * @route POST /api/ai/analyze/:alertId
 * @desc Analyse d'une alerte avec l'IA
 * @access Private (Manager/Admin)
 */
router.post('/analyze/:alertId', requireManager, async (req, res) => {
  try {
    const { alertId } = req.params;

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

    // Récupération du contexte historique de l'utilisateur
    const userAlertHistory = await prisma.alert.findMany({
      where: { userId: alert.userId },
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

    // Récupération des alertes proches géographiquement
    const nearbyAlerts = await prisma.$queryRaw`
      SELECT id, type, priority, status, latitude, longitude,
      ST_Distance(
        ST_Point(longitude, latitude)::geography,
        ST_Point(${alert.longitude}, ${alert.latitude})::geography
      ) as distance
      FROM "alerts"
      WHERE id != ${alertId}
      AND ST_DWithin(
        ST_Point(longitude, latitude)::geography,
        ST_Point(${alert.longitude}, ${alert.latitude})::geography,
        5000
      )
      ORDER BY distance ASC
      LIMIT 5
    `;

    // Ajout du contexte à l'alerte
    const alertWithContext = {
      ...alert,
      userAlertHistory,
      nearbyAlerts
    };

    // Analyse avec l'IA
    const analysis = await AIService.analyzeAlert(alertWithContext);

    // Mise à jour de l'alerte avec les résultats de l'IA
    const updatedAlert = await prisma.alert.update({
      where: { id: alertId },
      data: {
        type: analysis.classification.predictedType,
        priority: analysis.priority.level,
        isVerified: analysis.classification.confidence > 0.8
      },
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
        responses: true,
        assignments: true
      }
    });

    // Envoi aux services d'urgence si priorité élevée
    if (analysis.priority.level === 'HIGH' || analysis.priority.level === 'CRITICAL') {
      const emergencyResult = await AIService.sendToEmergencyServices(alertWithContext, analysis);
      analysis.emergencyNotification = emergencyResult;
    }

    res.json({
      message: 'Analyse IA terminée avec succès',
      alert: updatedAlert,
      analysis: analysis
    });

  } catch (error) {
    console.error('Erreur lors de l\'analyse IA:', error);
    res.status(500).json({
      error: 'Erreur interne du serveur',
      code: 'INTERNAL_ERROR'
    });
  }
});

/**
 * @route POST /api/ai/batch-analyze
 * @desc Analyse en lot d'alertes avec l'IA
 * @access Private (Manager/Admin)
 */
router.post('/batch-analyze', [
  body('alertIds').isArray().withMessage('Liste d\'IDs d\'alertes requise'),
  body('alertIds.*').isString().withMessage('ID d\'alerte invalide')
], requireManager, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Données invalides',
        details: errors.array()
      });
    }

    const { alertIds } = req.body;
    const results = [];

    for (const alertId of alertIds) {
      try {
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
            media: true
          }
        });

        if (alert) {
          const analysis = await AIService.analyzeAlert(alert);
          
          await prisma.alert.update({
            where: { id: alertId },
            data: {
              type: analysis.classification.predictedType,
              priority: analysis.priority.level,
              isVerified: analysis.classification.confidence > 0.8
            }
          });

          results.push({
            alertId,
            success: true,
            analysis: analysis
          });
        } else {
          results.push({
            alertId,
            success: false,
            error: 'Alerte non trouvée'
          });
        }
      } catch (error) {
        console.error(`Erreur lors de l'analyse de l'alerte ${alertId}:`, error);
        results.push({
          alertId,
          success: false,
          error: error.message
        });
      }
    }

    res.json({
      message: 'Analyse en lot terminée',
      results: results,
      summary: {
        total: alertIds.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length
      }
    });

  } catch (error) {
    console.error('Erreur lors de l\'analyse en lot:', error);
    res.status(500).json({
      error: 'Erreur interne du serveur',
      code: 'INTERNAL_ERROR'
    });
  }
});

/**
 * @route GET /api/ai/analysis/:alertId
 * @desc Récupération de l'analyse IA d'une alerte
 * @access Private (Manager/Admin)
 */
router.get('/analysis/:alertId', requireManager, async (req, res) => {
  try {
    const { alertId } = req.params;

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
        media: true
      }
    });

    if (!alert) {
      return res.status(404).json({
        error: 'Alerte non trouvée',
        code: 'ALERT_NOT_FOUND'
      });
    }

    // Re-analyse de l'alerte
    const analysis = await AIService.analyzeAlert(alert);

    res.json({
      alert: alert,
      analysis: analysis
    });

  } catch (error) {
    console.error('Erreur lors de la récupération de l\'analyse:', error);
    res.status(500).json({
      error: 'Erreur interne du serveur',
      code: 'INTERNAL_ERROR'
    });
  }
});

/**
 * @route POST /api/ai/feedback/:alertId
 * @desc Envoi de feedback sur l'analyse IA
 * @access Private (Manager/Admin)
 */
router.post('/feedback/:alertId', [
  body('correctType').isIn(['ACCIDENT', 'FIRE', 'MEDICAL_EMERGENCY', 'SECURITY_INCIDENT', 'NATURAL_DISASTER', 'OTHER']).withMessage('Type correct invalide'),
  body('correctPriority').isIn(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).withMessage('Priorité correcte invalide'),
  body('feedback').optional().trim()
], requireManager, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Données invalides',
        details: errors.array()
      });
    }

    const { alertId } = req.params;
    const { correctType, correctPriority, feedback } = req.body;

    // Récupération de l'alerte actuelle
    const alert = await prisma.alert.findUnique({
      where: { id: alertId },
      select: { type: true, priority: true }
    });

    if (!alert) {
      return res.status(404).json({
        error: 'Alerte non trouvée',
        code: 'ALERT_NOT_FOUND'
      });
    }

    // Mise à jour de l'alerte avec les corrections
    await prisma.alert.update({
      where: { id: alertId },
      data: {
        type: correctType,
        priority: correctPriority
      }
    });

    // Envoi du feedback à l'IA pour amélioration
    try {
      await AIService.sendFeedback(alertId, {
        originalType: alert.type,
        originalPriority: alert.priority,
        correctType,
        correctPriority,
        feedback,
        timestamp: new Date().toISOString()
      });
    } catch (feedbackError) {
      console.error('Erreur lors de l\'envoi du feedback:', feedbackError);
      // Ne pas faire échouer la requête si le feedback ne peut pas être envoyé
    }

    res.json({
      message: 'Feedback enregistré avec succès',
      corrections: {
        type: { from: alert.type, to: correctType },
        priority: { from: alert.priority, to: correctPriority }
      }
    });

  } catch (error) {
    console.error('Erreur lors de l\'enregistrement du feedback:', error);
    res.status(500).json({
      error: 'Erreur interne du serveur',
      code: 'INTERNAL_ERROR'
    });
  }
});

/**
 * @route GET /api/ai/stats
 * @desc Statistiques de l'IA
 * @access Private (Manager/Admin)
 */
router.get('/stats', requireManager, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const where = {};
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    // Statistiques des alertes analysées
    const totalAlerts = await prisma.alert.count({ where });
    const verifiedAlerts = await prisma.alert.count({ 
      where: { ...where, isVerified: true } 
    });

    // Répartition par type
    const alertsByType = await prisma.alert.groupBy({
      by: ['type'],
      where,
      _count: { type: true }
    });

    // Répartition par priorité
    const alertsByPriority = await prisma.alert.groupBy({
      by: ['priority'],
      where,
      _count: { priority: true }
    });

    // Taux de vérification par type
    const verificationRates = await Promise.all(
      alertsByType.map(async (typeGroup) => {
        const verified = await prisma.alert.count({
          where: {
            ...where,
            type: typeGroup.type,
            isVerified: true
          }
        });
        return {
          type: typeGroup.type,
          total: typeGroup._count.type,
          verified,
          rate: typeGroup._count.type > 0 ? (verified / typeGroup._count.type) * 100 : 0
        };
      })
    );

    res.json({
      summary: {
        totalAlerts,
        verifiedAlerts,
        verificationRate: totalAlerts > 0 ? (verifiedAlerts / totalAlerts) * 100 : 0
      },
      byType: alertsByType,
      byPriority: alertsByPriority,
      verificationRates
    });

  } catch (error) {
    console.error('Erreur lors de la récupération des statistiques IA:', error);
    res.status(500).json({
      error: 'Erreur interne du serveur',
      code: 'INTERNAL_ERROR'
    });
  }
});

module.exports = router;











