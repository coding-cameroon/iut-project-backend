const express = require('express');
const { body, validationResult } = require('express-validator');
const { requireManager } = require('../middleware/auth');
const MonitoringService = require('../services/monitoringService');
const AsyncProcessingService = require('../services/asyncProcessingService');
const QueueService = require('../services/queueService');
const CacheService = require('../services/cacheService');

const router = express.Router();
const monitoringService = new MonitoringService();
const cacheService = new CacheService();

/**
 * @route GET /api/monitoring/health
 * @desc Vérification de la santé du système
 * @access Private (Manager/Admin)
 */
router.get('/health', requireManager, async (req, res) => {
  try {
    const [
      systemMetrics,
      databaseStats,
      queueStats,
      cacheStats
    ] = await Promise.all([
      monitoringService.getSystemMetrics(),
      monitoringService.getDatabaseStats(),
      monitoringService.getQueueStats(),
      monitoringService.getCacheStats()
    ]);

    // Vérification de la santé du système
    const healthChecks = {
      database: databaseStats ? 'healthy' : 'unhealthy',
      queues: queueStats ? 'healthy' : 'unhealthy',
      cache: cacheStats ? 'healthy' : 'unhealthy',
      memory: systemMetrics && systemMetrics.memory ? 
        (systemMetrics.memory.heapUsed / systemMetrics.memory.heapTotal) < 0.9 ? 'healthy' : 'warning' : 'unknown'
    };

    const overallHealth = Object.values(healthChecks).every(status => 
      status === 'healthy' || status === 'warning'
    ) ? 'healthy' : 'unhealthy';

    res.json({
      status: overallHealth,
      checks: healthChecks,
      metrics: {
        system: systemMetrics,
        database: databaseStats,
        queues: queueStats,
        cache: cacheStats
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Erreur lors de la vérification de la santé:', error);
    res.status(500).json({
      error: 'Erreur interne du serveur',
      code: 'HEALTH_CHECK_FAILED'
    });
  }
});

/**
 * @route GET /api/monitoring/performance
 * @desc Métriques de performance
 * @access Private (Manager/Admin)
 */
router.get('/performance', requireManager, async (req, res) => {
  try {
    const { limit = 100, operation } = req.query;

    let performanceMetrics;
    if (operation) {
      performanceMetrics = await monitoringService.getPerformanceMetrics(parseInt(limit));
      performanceMetrics = performanceMetrics.filter(metric => 
        metric.operation === operation
      );
    } else {
      performanceMetrics = await monitoringService.getPerformanceMetrics(parseInt(limit));
    }

    // Calcul des statistiques
    const stats = {
      total: performanceMetrics.length,
      average: 0,
      min: 0,
      max: 0,
      p95: 0,
      p99: 0
    };

    if (performanceMetrics.length > 0) {
      const durations = performanceMetrics.map(m => m.duration).sort((a, b) => a - b);
      stats.average = durations.reduce((a, b) => a + b, 0) / durations.length;
      stats.min = durations[0];
      stats.max = durations[durations.length - 1];
      stats.p95 = durations[Math.floor(durations.length * 0.95)];
      stats.p99 = durations[Math.floor(durations.length * 0.99)];
    }

    res.json({
      metrics: performanceMetrics,
      statistics: stats,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Erreur lors de la récupération des métriques de performance:', error);
    res.status(500).json({
      error: 'Erreur interne du serveur',
      code: 'PERFORMANCE_METRICS_FAILED'
    });
  }
});

/**
 * @route GET /api/monitoring/errors
 * @desc Métriques d'erreurs
 * @access Private (Manager/Admin)
 */
router.get('/errors', requireManager, async (req, res) => {
  try {
    const { limit = 50, operation } = req.query;

    let errorMetrics = await monitoringService.getErrorMetrics(parseInt(limit));
    
    if (operation) {
      errorMetrics = errorMetrics.filter(metric => 
        metric.operation === operation
      );
    }

    // Calcul des statistiques
    const stats = {
      total: errorMetrics.length,
      byOperation: {},
      byError: {},
      recent: errorMetrics.slice(0, 10)
    };

    errorMetrics.forEach(metric => {
      // Statistiques par opération
      if (!stats.byOperation[metric.operation]) {
        stats.byOperation[metric.operation] = 0;
      }
      stats.byOperation[metric.operation]++;

      // Statistiques par type d'erreur
      const errorType = metric.error.name || 'Unknown';
      if (!stats.byError[errorType]) {
        stats.byError[errorType] = 0;
      }
      stats.byError[errorType]++;
    });

    res.json({
      metrics: errorMetrics,
      statistics: stats,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Erreur lors de la récupération des métriques d\'erreurs:', error);
    res.status(500).json({
      error: 'Erreur interne du serveur',
      code: 'ERROR_METRICS_FAILED'
    });
  }
});

/**
 * @route GET /api/monitoring/alerts
 * @desc Métriques d'alertes
 * @access Private (Manager/Admin)
 */
router.get('/alerts', requireManager, async (req, res) => {
  try {
    const { limit = 100, action } = req.query;

    let alertMetrics = await monitoringService.getAlertMetrics(parseInt(limit));
    
    if (action) {
      alertMetrics = alertMetrics.filter(metric => 
        metric.action === action
      );
    }

    // Calcul des statistiques
    const stats = {
      total: alertMetrics.length,
      byAction: {},
      byHour: {},
      recent: alertMetrics.slice(0, 20)
    };

    alertMetrics.forEach(metric => {
      // Statistiques par action
      if (!stats.byAction[metric.action]) {
        stats.byAction[metric.action] = 0;
      }
      stats.byAction[metric.action]++;

      // Statistiques par heure
      const hour = new Date(metric.timestamp).getHours();
      if (!stats.byHour[hour]) {
        stats.byHour[hour] = 0;
      }
      stats.byHour[hour]++;
    });

    res.json({
      metrics: alertMetrics,
      statistics: stats,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Erreur lors de la récupération des métriques d\'alertes:', error);
    res.status(500).json({
      error: 'Erreur interne du serveur',
      code: 'ALERT_METRICS_FAILED'
    });
  }
});

/**
 * @route GET /api/monitoring/users
 * @desc Métriques utilisateurs
 * @access Private (Manager/Admin)
 */
router.get('/users', requireManager, async (req, res) => {
  try {
    const { limit = 100, action } = req.query;

    let userMetrics = await monitoringService.getUserMetrics(parseInt(limit));
    
    if (action) {
      userMetrics = userMetrics.filter(metric => 
        metric.action === action
      );
    }

    // Calcul des statistiques
    const stats = {
      total: userMetrics.length,
      byAction: {},
      byHour: {},
      recent: userMetrics.slice(0, 20)
    };

    userMetrics.forEach(metric => {
      // Statistiques par action
      if (!stats.byAction[metric.action]) {
        stats.byAction[metric.action] = 0;
      }
      stats.byAction[metric.action]++;

      // Statistiques par heure
      const hour = new Date(metric.timestamp).getHours();
      if (!stats.byHour[hour]) {
        stats.byHour[hour] = 0;
      }
      stats.byHour[hour]++;
    });

    res.json({
      metrics: userMetrics,
      statistics: stats,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Erreur lors de la récupération des métriques utilisateurs:', error);
    res.status(500).json({
      error: 'Erreur interne du serveur',
      code: 'USER_METRICS_FAILED'
    });
  }
});

/**
 * @route GET /api/monitoring/system
 * @desc Métriques système
 * @access Private (Manager/Admin)
 */
router.get('/system', requireManager, async (req, res) => {
  try {
    const systemMetrics = await monitoringService.getSystemMetrics();
    
    res.json({
      metrics: systemMetrics,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Erreur lors de la récupération des métriques système:', error);
    res.status(500).json({
      error: 'Erreur interne du serveur',
      code: 'SYSTEM_METRICS_FAILED'
    });
  }
});

/**
 * @route GET /api/monitoring/queues
 * @desc Statut des queues
 * @access Private (Manager/Admin)
 */
router.get('/queues', requireManager, async (req, res) => {
  try {
    const queueStats = await monitoringService.getQueueStats();
    
    res.json({
      queues: queueStats,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Erreur lors de la récupération du statut des queues:', error);
    res.status(500).json({
      error: 'Erreur interne du serveur',
      code: 'QUEUE_STATS_FAILED'
    });
  }
});

/**
 * @route GET /api/monitoring/cache
 * @desc Statistiques du cache
 * @access Private (Manager/Admin)
 */
router.get('/cache', requireManager, async (req, res) => {
  try {
    const cacheStats = await monitoringService.getCacheStats();
    
    res.json({
      cache: cacheStats,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Erreur lors de la récupération des statistiques du cache:', error);
    res.status(500).json({
      error: 'Erreur interne du serveur',
      code: 'CACHE_STATS_FAILED'
    });
  }
});

/**
 * @route GET /api/monitoring/report
 * @desc Rapport complet de monitoring
 * @access Private (Manager/Admin)
 */
router.get('/report', requireManager, async (req, res) => {
  try {
    const report = await monitoringService.getFullReport();
    
    res.json(report);

  } catch (error) {
    console.error('Erreur lors de la génération du rapport:', error);
    res.status(500).json({
      error: 'Erreur interne du serveur',
      code: 'REPORT_GENERATION_FAILED'
    });
  }
});

/**
 * @route POST /api/monitoring/optimize
 * @desc Optimisation du système
 * @access Private (Manager/Admin)
 */
router.post('/optimize', requireManager, async (req, res) => {
  try {
    const result = await AsyncProcessingService.optimizePerformance();
    
    res.json({
      message: 'Optimisation terminée',
      result: result
    });

  } catch (error) {
    console.error('Erreur lors de l\'optimisation:', error);
    res.status(500).json({
      error: 'Erreur interne du serveur',
      code: 'OPTIMIZATION_FAILED'
    });
  }
});

/**
 * @route POST /api/monitoring/process-pending
 * @desc Traitement des alertes en attente
 * @access Private (Manager/Admin)
 */
router.post('/process-pending', [
  body('limit').optional().isInt({ min: 1, max: 1000 }).withMessage('Limite invalide'),
  body('concurrency').optional().isInt({ min: 1, max: 20 }).withMessage('Concurrence invalide'),
  body('maxAge').optional().isInt({ min: 1, max: 168 }).withMessage('Âge maximum invalide')
], requireManager, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Données invalides',
        details: errors.array()
      });
    }

    const { limit, concurrency, maxAge } = req.body;
    const result = await AsyncProcessingService.processPendingAlerts({
      limit,
      concurrency,
      maxAge: maxAge ? maxAge * 60 * 60 * 1000 : undefined
    });
    
    res.json({
      message: 'Traitement des alertes en attente terminé',
      result: result
    });

  } catch (error) {
    console.error('Erreur lors du traitement des alertes en attente:', error);
    res.status(500).json({
      error: 'Erreur interne du serveur',
      code: 'PENDING_ALERTS_PROCESSING_FAILED'
    });
  }
});

/**
 * @route GET /api/monitoring/status
 * @desc Statut du traitement asynchrone
 * @access Private (Manager/Admin)
 */
router.get('/status', requireManager, async (req, res) => {
  try {
    const status = await AsyncProcessingService.getProcessingStatus();
    
    res.json(status);

  } catch (error) {
    console.error('Erreur lors de la récupération du statut:', error);
    res.status(500).json({
      error: 'Erreur interne du serveur',
      code: 'STATUS_RETRIEVAL_FAILED'
    });
  }
});

/**
 * @route POST /api/monitoring/clean-cache
 * @desc Nettoyage du cache
 * @access Private (Manager/Admin)
 */
router.post('/clean-cache', requireManager, async (req, res) => {
  try {
    const { pattern = 'securite:*' } = req.body;
    const result = await cacheService.cleanCache(pattern);
    
    res.json({
      message: 'Cache nettoyé',
      keysRemoved: result
    });

  } catch (error) {
    console.error('Erreur lors du nettoyage du cache:', error);
    res.status(500).json({
      error: 'Erreur interne du serveur',
      code: 'CACHE_CLEANUP_FAILED'
    });
  }
});

/**
 * @route POST /api/monitoring/clean-queues
 * @desc Nettoyage des queues
 * @access Private (Manager/Admin)
 */
router.post('/clean-queues', [
  body('queueName').optional().isIn(['all', 'ai', 'emergency']).withMessage('Nom de queue invalide'),
  body('age').optional().isInt({ min: 1, max: 168 }).withMessage('Âge invalide')
], requireManager, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Données invalides',
        details: errors.array()
      });
    }

    const { queueName = 'all', age = 24 } = req.body;
    await QueueService.cleanQueues(queueName, age);
    
    res.json({
      message: 'Queues nettoyées',
      queueName,
      age
    });

  } catch (error) {
    console.error('Erreur lors du nettoyage des queues:', error);
    res.status(500).json({
      error: 'Erreur interne du serveur',
      code: 'QUEUE_CLEANUP_FAILED'
    });
  }
});

module.exports = router;











