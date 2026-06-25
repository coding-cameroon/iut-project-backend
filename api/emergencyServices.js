const express = require('express');
const { body, validationResult } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const { requireSuperAdmin } = require('../middleware/auth');
const CacheService = require('../services/cacheService');
const MonitoringService = require('../services/monitoringService');

const router = express.Router();
const prisma = new PrismaClient();
const cacheService = new CacheService();
const monitoringService = new MonitoringService();

/**
 * @route GET /api/emergency-services
 * @desc Récupération de tous les services d'urgence
 * @access Private (Manager/Admin/SuperAdmin)
 */
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 20, type, isActive, search } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Construction des filtres
    const where = {};
    
    if (type) {
      where.type = type;
    }
    
    if (isActive !== undefined) {
      where.isActive = isActive === 'true';
    }
    
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { address: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } }
      ];
    }

    const [services, total] = await Promise.all([
      prisma.emergencyService.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { name: 'asc' }
      }),
      prisma.emergencyService.count({ where })
    ]);

    res.json({
      services,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('Erreur lors de la récupération des services d\'urgence:', error);
    res.status(500).json({
      error: 'Erreur interne du serveur',
      code: 'EMERGENCY_SERVICES_FETCH_FAILED'
    });
  }
});

/**
 * @route GET /api/emergency-services/:id
 * @desc Récupération d'un service d'urgence spécifique
 * @access Private (Manager/Admin/SuperAdmin)
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const service = await prisma.emergencyService.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            assignments: true
          }
        }
      }
    });

    if (!service) {
      return res.status(404).json({
        error: 'Service d\'urgence non trouvé',
        code: 'EMERGENCY_SERVICE_NOT_FOUND'
      });
    }

    // Récupération des statistiques du service
    const stats = await getServiceStatistics(id);

    res.json({
      service: {
        ...service,
        statistics: stats
      }
    });

  } catch (error) {
    console.error('Erreur lors de la récupération du service d\'urgence:', error);
    res.status(500).json({
      error: 'Erreur interne du serveur',
      code: 'EMERGENCY_SERVICE_FETCH_FAILED'
    });
  }
});

/**
 * @route POST /api/emergency-services
 * @desc Création d'un nouveau service d'urgence
 * @access Private (SuperAdmin)
 */
router.post('/', [
  body('name').trim().notEmpty().withMessage('Le nom du service est requis'),
  body('type').trim().notEmpty().withMessage('Le type de service est requis'),
  body('phone').trim().notEmpty().withMessage('Le numéro de téléphone est requis'),
  body('email').optional().isEmail().withMessage('Email invalide'),
  body('address').trim().notEmpty().withMessage('L\'adresse est requise'),
  body('latitude').isFloat({ min: -90, max: 90 }).withMessage('Latitude invalide'),
  body('longitude').isFloat({ min: -180, max: 180 }).withMessage('Longitude invalide'),
  body('isActive').optional().isBoolean().withMessage('isActive doit être un booléen')
], requireSuperAdmin, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Données invalides',
        details: errors.array()
      });
    }

    const {
      name,
      type,
      phone,
      email,
      address,
      latitude,
      longitude,
      isActive = true
    } = req.body;

    // Vérification de l'unicité du nom
    const existingService = await prisma.emergencyService.findFirst({
      where: { name }
    });

    if (existingService) {
      return res.status(409).json({
        error: 'Un service avec ce nom existe déjà',
        code: 'SERVICE_NAME_EXISTS'
      });
    }

    const service = await prisma.emergencyService.create({
      data: {
        name,
        type,
        phone,
        email,
        address,
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude),
        isActive,
        alertTypes: alertTypeIds && alertTypeIds.length > 0 ? {
          connect: alertTypeIds.map(id => ({ id }))
        } : undefined
      }
    });

    // Invalidation du cache
    await cacheService.invalidatePattern('emergency_services*');

    // Enregistrement de la métrique
    await monitoringService.recordPerformance('emergency_service_creation', 0, {
      serviceId: service.id,
      serviceType: service.type
    });

    res.status(201).json({
      message: 'Service d\'urgence créé avec succès',
      service
    });

  } catch (error) {
    console.error('Erreur lors de la création du service d\'urgence:', error);
    res.status(500).json({
      error: 'Erreur interne du serveur',
      code: 'EMERGENCY_SERVICE_CREATION_FAILED'
    });
  }
});

/**
 * @route PUT /api/emergency-services/:id
 * @desc Mise à jour d'un service d'urgence
 * @access Private (SuperAdmin)
 */
router.put('/:id', [
  body('name').optional().trim().notEmpty().withMessage('Le nom ne peut pas être vide'),
  body('type').optional().isIn(['POLICE', 'FIRE_DEPARTMENT', 'AMBULANCE', 'CIVIL_PROTECTION', 'HOSPITAL', 'SECURITY_COMPANY']).withMessage('Type de service invalide'),
  body('phone').optional().trim().notEmpty().withMessage('Le numéro de téléphone ne peut pas être vide'),
  body('email').optional().isEmail().withMessage('Email invalide'),
  body('address').optional().trim().notEmpty().withMessage('L\'adresse ne peut pas être vide'),
  body('latitude').optional().isFloat({ min: -90, max: 90 }).withMessage('Latitude invalide'),
  body('longitude').optional().isFloat({ min: -180, max: 180 }).withMessage('Longitude invalide'),
  body('isActive').optional().isBoolean().withMessage('isActive doit être un booléen')
], requireSuperAdmin, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Données invalides',
        details: errors.array()
      });
    }

    const { id } = req.params;
    const updateData = req.body;

    // Vérification de l'existence du service
    const existingService = await prisma.emergencyService.findUnique({
      where: { id }
    });

    if (!existingService) {
      return res.status(404).json({
        error: 'Service d\'urgence non trouvé',
        code: 'EMERGENCY_SERVICE_NOT_FOUND'
      });
    }

    // Vérification de l'unicité du nom si modifié
    if (updateData.name && updateData.name !== existingService.name) {
      const nameExists = await prisma.emergencyService.findFirst({
        where: { 
          name: updateData.name,
          id: { not: id }
        }
      });

      if (nameExists) {
        return res.status(409).json({
          error: 'Un service avec ce nom existe déjà',
          code: 'SERVICE_NAME_EXISTS'
        });
      }
    }

    // Conversion des coordonnées si fournies
    if (updateData.latitude) {
      updateData.latitude = parseFloat(updateData.latitude);
    }
    if (updateData.longitude) {
      updateData.longitude = parseFloat(updateData.longitude);
    }

    // Handle alertTypes update if provided
    if (updateData.alertTypeIds && Array.isArray(updateData.alertTypeIds)) {
      updateData.alertTypes = {
        set: updateData.alertTypeIds.map(id => ({ id }))
      };
      delete updateData.alertTypeIds;
    }

    const updatedService = await prisma.emergencyService.update({
      where: { id },
      data: updateData,
      include: {
        alertTypes: true
      }
    });

    // Invalidation du cache
    await cacheService.invalidatePattern('emergency_services*');

    // Enregistrement de la métrique
    await monitoringService.recordPerformance('emergency_service_update', 0, {
      serviceId: id,
      changes: Object.keys(updateData)
    });

    res.json({
      message: 'Service d\'urgence mis à jour avec succès',
      service: updatedService
    });

  } catch (error) {
    console.error('Erreur lors de la mise à jour du service d\'urgence:', error);
    res.status(500).json({
      error: 'Erreur interne du serveur',
      code: 'EMERGENCY_SERVICE_UPDATE_FAILED'
    });
  }
});

/**
 * @route DELETE /api/emergency-services/:id
 * @desc Suppression d'un service d'urgence
 * @access Private (SuperAdmin)
 */
router.delete('/:id', requireSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Vérification de l'existence du service
    const existingService = await prisma.emergencyService.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            assignments: true
          }
        }
      }
    });

    if (!existingService) {
      return res.status(404).json({
        error: 'Service d\'urgence non trouvé',
        code: 'EMERGENCY_SERVICE_NOT_FOUND'
      });
    }

    // Vérification des assignations actives
    if (existingService._count.assignments > 0) {
      return res.status(409).json({
        error: 'Impossible de supprimer un service avec des assignations actives',
        code: 'SERVICE_HAS_ACTIVE_ASSIGNMENTS'
      });
    }

    await prisma.emergencyService.delete({
      where: { id }
    });

    // Invalidation du cache
    await cacheService.invalidatePattern('emergency_services*');

    // Enregistrement de la métrique
    await monitoringService.recordPerformance('emergency_service_deletion', 0, {
      serviceId: id,
      serviceType: existingService.type
    });

    res.json({
      message: 'Service d\'urgence supprimé avec succès'
    });

  } catch (error) {
    console.error('Erreur lors de la suppression du service d\'urgence:', error);
    res.status(500).json({
      error: 'Erreur interne du serveur',
      code: 'EMERGENCY_SERVICE_DELETION_FAILED'
    });
  }
});

/**
 * @route GET /api/emergency-services/:id/statistics
 * @desc Statistiques détaillées d'un service d'urgence
 * @access Private (Manager/Admin/SuperAdmin)
 */
router.get('/:id/statistics', async (req, res) => {
  try {
    const { id } = req.params;
    const { startDate, endDate } = req.query;

    // Vérification de l'existence du service
    const service = await prisma.emergencyService.findUnique({
      where: { id }
    });

    if (!service) {
      return res.status(404).json({
        error: 'Service d\'urgence non trouvé',
        code: 'EMERGENCY_SERVICE_NOT_FOUND'
      });
    }

    const stats = await getServiceStatistics(id, { startDate, endDate });

    res.json({
      serviceId: id,
      serviceName: service.name,
      statistics: stats,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Erreur lors de la récupération des statistiques du service:', error);
    res.status(500).json({
      error: 'Erreur interne du serveur',
      code: 'SERVICE_STATISTICS_FAILED'
    });
  }
});

/**
 * @route GET /api/emergency-services/:id/assignments
 * @desc Assignations d'un service d'urgence
 * @access Private (Manager/Admin/SuperAdmin)
 */
router.get('/:id/assignments', async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 20, status, startDate, endDate } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Construction des filtres
    const where = {
      assignedTo: id
    };

    if (status) {
      where.status = status;
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [assignments, total] = await Promise.all([
      prisma.alertAssignment.findMany({
        where,
        include: {
          alert: {
            include: {
              user: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  email: true
                }
              }
            }
          }
        },
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' }
      }),
      prisma.alertAssignment.count({ where })
    ]);

    res.json({
      assignments,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('Erreur lors de la récupération des assignations:', error);
    res.status(500).json({
      error: 'Erreur interne du serveur',
      code: 'SERVICE_ASSIGNMENTS_FAILED'
    });
  }
});

/**
 * @route POST /api/emergency-services/:id/toggle-status
 * @desc Activation/désactivation d'un service d'urgence
 * @access Private (SuperAdmin)
 */
router.post('/:id/toggle-status', requireSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const service = await prisma.emergencyService.findUnique({
      where: { id }
    });

    if (!service) {
      return res.status(404).json({
        error: 'Service d\'urgence non trouvé',
        code: 'EMERGENCY_SERVICE_NOT_FOUND'
      });
    }

    const updatedService = await prisma.emergencyService.update({
      where: { id },
      data: { isActive: !service.isActive }
    });

    // Invalidation du cache
    await cacheService.invalidatePattern('emergency_services*');

    res.json({
      message: `Service ${updatedService.isActive ? 'activé' : 'désactivé'} avec succès`,
      service: updatedService
    });

  } catch (error) {
    console.error('Erreur lors du changement de statut du service:', error);
    res.status(500).json({
      error: 'Erreur interne du serveur',
      code: 'SERVICE_STATUS_TOGGLE_FAILED'
    });
  }
});

/**
 * Fonction utilitaire pour récupérer les statistiques d'un service
 * @param {string} serviceId - ID du service
 * @param {Object} filters - Filtres de date
 * @returns {Promise<Object>} Statistiques du service
 */
async function getServiceStatistics(serviceId, filters = {}) {
  try {
    const where = { assignedTo: serviceId };
    
    if (filters.startDate || filters.endDate) {
      where.createdAt = {};
      if (filters.startDate) where.createdAt.gte = new Date(filters.startDate);
      if (filters.endDate) where.createdAt.lte = new Date(filters.endDate);
    }

    const [
      totalAssignments,
      assignmentsByStatus,
      assignmentsByType,
      averageResponseTime,
      recentAssignments
    ] = await Promise.all([
      prisma.alertAssignment.count({ where }),
      prisma.alertAssignment.groupBy({
        by: ['status'],
        where,
        _count: { status: true }
      }),
      prisma.alertAssignment.groupBy({
        by: ['alert'],
        where,
        _count: { alert: true }
      }),
      calculateAverageResponseTime(serviceId, where),
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

    // Calcul du taux de réussite
    const completedAssignments = assignmentsByStatus.find(stat => stat.status === 'COMPLETED')?._count.status || 0;
    const successRate = totalAssignments > 0 ? (completedAssignments / totalAssignments) * 100 : 0;

    return {
      totalAssignments,
      assignmentsByStatus,
      successRate: Math.round(successRate * 100) / 100,
      averageResponseTime,
      recentAssignments,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error('Erreur lors du calcul des statistiques du service:', error);
    return null;
  }
}

/**
 * Calcule le temps de réponse moyen d'un service
 * @param {string} serviceId - ID du service
 * @param {Object} where - Conditions de filtrage
 * @returns {Promise<number>} Temps de réponse moyen en minutes
 */
async function calculateAverageResponseTime(serviceId, where) {
  try {
    const assignments = await prisma.alertAssignment.findMany({
      where: {
        ...where,
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
    console.error('Erreur lors du calcul du temps de réponse moyen:', error);
    return 0;
  }
}

module.exports = router;
