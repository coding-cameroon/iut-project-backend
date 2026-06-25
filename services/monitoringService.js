const os = require('os');
const fs = require('fs').promises;
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const CacheService = require('./cacheService');
const QueueService = require('./queueService');

const prisma = new PrismaClient();
const cacheService = new CacheService();

class MonitoringService {
  constructor() {
    this.metrics = {
      performance: [],
      errors: [],
      alerts: [],
      users: [],
      system: []
    };
    
    this.startTime = Date.now();
    this.logFile = path.join(__dirname, '../logs/monitoring.log');
  }

  /**
   * Enregistre une métrique de performance
   * @param {string} operation - Nom de l'opération
   * @param {number} duration - Durée en millisecondes
   * @param {Object} metadata - Métadonnées additionnelles
   */
  async recordPerformance(operation, duration, metadata = {}) {
    try {
      const metric = {
        operation,
        duration,
        timestamp: new Date().toISOString(),
        metadata
      };

      // Stockage en mémoire
      this.metrics.performance.push(metric);
      
      // Limitation du nombre de métriques en mémoire
      if (this.metrics.performance.length > 1000) {
        this.metrics.performance = this.metrics.performance.slice(-500);
      }

      // Stockage dans Redis
      await cacheService.set(
        `performance:${Date.now()}`,
        metric,
        3600 // 1 heure
      );

      // Log si la durée est anormale
      if (duration > 5000) { // Plus de 5 secondes
        await this.logSlowOperation(operation, duration, metadata);
      }

    } catch (error) {
      console.error('Erreur lors de l\'enregistrement de la performance:', error);
    }
  }

  /**
   * Enregistre une erreur
   * @param {string} operation - Nom de l'opération
   * @param {Error} error - Erreur
   * @param {Object} context - Contexte de l'erreur
   */
  async recordError(operation, error, context = {}) {
    try {
      const errorMetric = {
        operation,
        error: {
          message: error.message,
          stack: error.stack,
          name: error.name
        },
        context,
        timestamp: new Date().toISOString()
      };

      // Stockage en mémoire
      this.metrics.errors.push(errorMetric);
      
      // Limitation du nombre d'erreurs en mémoire
      if (this.metrics.errors.length > 500) {
        this.metrics.errors = this.metrics.errors.slice(-250);
      }

      // Stockage dans Redis
      await cacheService.set(
        `error:${Date.now()}`,
        errorMetric,
        86400 // 24 heures
      );

      // Log de l'erreur
      await this.logError(operation, error, context);

    } catch (err) {
      console.error('Erreur lors de l\'enregistrement de l\'erreur:', err);
    }
  }

  /**
   * Enregistre une métrique d'alerte
   * @param {string} alertId - ID de l'alerte
   * @param {string} action - Action effectuée
   * @param {Object} metadata - Métadonnées
   */
  async recordAlertMetric(alertId, action, metadata = {}) {
    try {
      const metric = {
        alertId,
        action,
        timestamp: new Date().toISOString(),
        metadata
      };

      // Stockage en mémoire
      this.metrics.alerts.push(metric);
      
      // Limitation du nombre de métriques en mémoire
      if (this.metrics.alerts.length > 1000) {
        this.metrics.alerts = this.metrics.alerts.slice(-500);
      }

      // Stockage dans Redis
      await cacheService.set(
        `alert:${alertId}:${Date.now()}`,
        metric,
        7200 // 2 heures
      );

    } catch (error) {
      console.error('Erreur lors de l\'enregistrement de la métrique d\'alerte:', error);
    }
  }

  /**
   * Enregistre une métrique utilisateur
   * @param {string} userId - ID de l'utilisateur
   * @param {string} action - Action effectuée
   * @param {Object} metadata - Métadonnées
   */
  async recordUserMetric(userId, action, metadata = {}) {
    try {
      const metric = {
        userId,
        action,
        timestamp: new Date().toISOString(),
        metadata
      };

      // Stockage en mémoire
      this.metrics.users.push(metric);
      
      // Limitation du nombre de métriques en mémoire
      if (this.metrics.users.length > 1000) {
        this.metrics.users = this.metrics.users.slice(-500);
      }

      // Stockage dans Redis
      await cacheService.set(
        `user:${userId}:${Date.now()}`,
        metric,
        1800 // 30 minutes
      );

    } catch (error) {
      console.error('Erreur lors de l\'enregistrement de la métrique utilisateur:', error);
    }
  }

  /**
   * Obtient les métriques système
   * @returns {Promise<Object>} Métriques système
   */
  async getSystemMetrics() {
    try {
      const uptime = Date.now() - this.startTime;
      const memoryUsage = process.memoryUsage();
      const cpuUsage = process.cpuUsage();
      
      return {
        uptime: {
          process: uptime,
          system: process.uptime()
        },
        memory: {
          rss: memoryUsage.rss,
          heapTotal: memoryUsage.heapTotal,
          heapUsed: memoryUsage.heapUsed,
          external: memoryUsage.external,
          arrayBuffers: memoryUsage.arrayBuffers
        },
        cpu: {
          user: cpuUsage.user,
          system: cpuUsage.system
        },
        platform: {
          type: os.type(),
          platform: os.platform(),
          arch: os.arch(),
          release: os.release()
        },
        loadAverage: os.loadavg(),
        freeMemory: os.freemem(),
        totalMemory: os.totalmem(),
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Erreur lors de la récupération des métriques système:', error);
      return null;
    }
  }

  /**
   * Obtient les métriques de performance
   * @param {number} limit - Nombre de métriques à récupérer
   * @returns {Promise<Array>} Métriques de performance
   */
  async getPerformanceMetrics(limit = 100) {
    try {
      // Récupération depuis Redis
      const keys = await cacheService.redis.keys('securite:performance:*');
      const metrics = [];
      
      for (const key of keys.slice(-limit)) {
        const metric = await cacheService.get(key);
        if (metric) {
          metrics.push(metric);
        }
      }
      
      return metrics.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    } catch (error) {
      console.error('Erreur lors de la récupération des métriques de performance:', error);
      return this.metrics.performance.slice(-limit);
    }
  }

  /**
   * Obtient les métriques d'erreurs
   * @param {number} limit - Nombre d'erreurs à récupérer
   * @returns {Promise<Array>} Métriques d'erreurs
   */
  async getErrorMetrics(limit = 50) {
    try {
      // Récupération depuis Redis
      const keys = await cacheService.redis.keys('securite:error:*');
      const errors = [];
      
      for (const key of keys.slice(-limit)) {
        const error = await cacheService.get(key);
        if (error) {
          errors.push(error);
        }
      }
      
      return errors.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    } catch (error) {
      console.error('Erreur lors de la récupération des métriques d\'erreurs:', error);
      return this.metrics.errors.slice(-limit);
    }
  }

  /**
   * Obtient les métriques d'alertes
   * @param {number} limit - Nombre de métriques à récupérer
   * @returns {Promise<Array>} Métriques d'alertes
   */
  async getAlertMetrics(limit = 100) {
    try {
      // Récupération depuis Redis
      const keys = await cacheService.redis.keys('securite:alert:*');
      const metrics = [];
      
      for (const key of keys.slice(-limit)) {
        const metric = await cacheService.get(key);
        if (metric) {
          metrics.push(metric);
        }
      }
      
      return metrics.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    } catch (error) {
      console.error('Erreur lors de la récupération des métriques d\'alertes:', error);
      return this.metrics.alerts.slice(-limit);
    }
  }

  /**
   * Obtient les métriques utilisateurs
   * @param {number} limit - Nombre de métriques à récupérer
   * @returns {Promise<Array>} Métriques utilisateurs
   */
  async getUserMetrics(limit = 100) {
    try {
      // Récupération depuis Redis
      const keys = await cacheService.redis.keys('securite:user:*');
      const metrics = [];
      
      for (const key of keys.slice(-limit)) {
        const metric = await cacheService.get(key);
        if (metric) {
          metrics.push(metric);
        }
      }
      
      return metrics.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    } catch (error) {
      console.error('Erreur lors de la récupération des métriques utilisateurs:', error);
      return this.metrics.users.slice(-limit);
    }
  }

  /**
   * Obtient les statistiques de la base de données
   * @returns {Promise<Object>} Statistiques de la base de données
   */
  async getDatabaseStats() {
    try {
      const [
        totalUsers,
        activeUsers,
        totalAlerts,
        pendingAlerts,
        resolvedAlerts,
        alertsByType,
        alertsByPriority
      ] = await Promise.all([
        prisma.user.count(),
        prisma.user.count({ where: { isActive: true } }),
        prisma.alert.count(),
        prisma.alert.count({ where: { status: 'PENDING' } }),
        prisma.alert.count({ where: { status: 'RESOLVED' } }),
        prisma.alert.groupBy({
          by: ['type'],
          _count: { type: true }
        }),
        prisma.alert.groupBy({
          by: ['priority'],
          _count: { priority: true }
        })
      ]);

      return {
        users: {
          total: totalUsers,
          active: activeUsers,
          inactive: totalUsers - activeUsers
        },
        alerts: {
          total: totalAlerts,
          pending: pendingAlerts,
          resolved: resolvedAlerts,
          byType: alertsByType,
          byPriority: alertsByPriority
        },
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Erreur lors de la récupération des statistiques de la base de données:', error);
      return null;
    }
  }

  /**
   * Obtient les statistiques des queues
   * @returns {Promise<Object>} Statistiques des queues
   */
  async getQueueStats() {
    try {
      const queueStatus = await QueueService.getQueueStatus();
      return queueStatus;
    } catch (error) {
      console.error('Erreur lors de la récupération des statistiques des queues:', error);
      return null;
    }
  }

  /**
   * Obtient les statistiques du cache
   * @returns {Promise<Object>} Statistiques du cache
   */
  async getCacheStats() {
    try {
      const cacheStats = await cacheService.getCacheStats();
      return cacheStats;
    } catch (error) {
      console.error('Erreur lors de la récupération des statistiques du cache:', error);
      return null;
    }
  }

  /**
   * Obtient un rapport complet de monitoring
   * @returns {Promise<Object>} Rapport de monitoring
   */
  async getFullReport() {
    try {
      const [
        systemMetrics,
        performanceMetrics,
        errorMetrics,
        alertMetrics,
        userMetrics,
        databaseStats,
        queueStats,
        cacheStats
      ] = await Promise.all([
        this.getSystemMetrics(),
        this.getPerformanceMetrics(50),
        this.getErrorMetrics(20),
        this.getAlertMetrics(50),
        this.getUserMetrics(50),
        this.getDatabaseStats(),
        this.getQueueStats(),
        this.getCacheStats()
      ]);

      return {
        system: systemMetrics,
        performance: performanceMetrics,
        errors: errorMetrics,
        alerts: alertMetrics,
        users: userMetrics,
        database: databaseStats,
        queues: queueStats,
        cache: cacheStats,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Erreur lors de la génération du rapport de monitoring:', error);
      return null;
    }
  }

  /**
   * Log une opération lente
   * @param {string} operation - Nom de l'opération
   * @param {number} duration - Durée en millisecondes
   * @param {Object} metadata - Métadonnées
   */
  async logSlowOperation(operation, duration, metadata) {
    try {
      const logEntry = {
        level: 'WARN',
        message: `Opération lente détectée: ${operation}`,
        duration,
        metadata,
        timestamp: new Date().toISOString()
      };

      await this.writeLog(logEntry);
    } catch (error) {
      console.error('Erreur lors du log de l\'opération lente:', error);
    }
  }

  /**
   * Log une erreur
   * @param {string} operation - Nom de l'opération
   * @param {Error} error - Erreur
   * @param {Object} context - Contexte
   */
  async logError(operation, error, context) {
    try {
      const logEntry = {
        level: 'ERROR',
        message: `Erreur dans ${operation}: ${error.message}`,
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack
        },
        context,
        timestamp: new Date().toISOString()
      };

      await this.writeLog(logEntry);
    } catch (err) {
      console.error('Erreur lors du log de l\'erreur:', err);
    }
  }

  /**
   * Écrit dans le fichier de log
   * @param {Object} logEntry - Entrée de log
   */
  async writeLog(logEntry) {
    try {
      const logLine = JSON.stringify(logEntry) + '\n';
      await fs.appendFile(this.logFile, logLine);
    } catch (error) {
      console.error('Erreur lors de l\'écriture du log:', error);
    }
  }

  /**
   * Nettoie les anciennes métriques
   * @param {number} maxAge - Âge maximum en heures
   */
  async cleanOldMetrics(maxAge = 24) {
    try {
      const cutoffTime = Date.now() - (maxAge * 60 * 60 * 1000);
      
      // Nettoyage des métriques en mémoire
      this.metrics.performance = this.metrics.performance.filter(
        m => new Date(m.timestamp).getTime() > cutoffTime
      );
      this.metrics.errors = this.metrics.errors.filter(
        m => new Date(m.timestamp).getTime() > cutoffTime
      );
      this.metrics.alerts = this.metrics.alerts.filter(
        m => new Date(m.timestamp).getTime() > cutoffTime
      );
      this.metrics.users = this.metrics.users.filter(
        m => new Date(m.timestamp).getTime() > cutoffTime
      );

      console.log('Métriques anciennes nettoyées');
    } catch (error) {
      console.error('Erreur lors du nettoyage des métriques:', error);
    }
  }

  /**
   * Démarre le monitoring automatique
   * @param {number} interval - Intervalle en millisecondes
   */
  startAutoMonitoring(interval = 60000) { // 1 minute par défaut
    setInterval(async () => {
      try {
        // Nettoyage des anciennes métriques
        await this.cleanOldMetrics();
        
        // Vérification de la santé du système
        const systemMetrics = await this.getSystemMetrics();
        if (systemMetrics) {
          // Alerte si la mémoire utilisée dépasse 80%
          const memoryUsagePercent = (systemMetrics.memory.heapUsed / systemMetrics.memory.heapTotal) * 100;
          if (memoryUsagePercent > 80) {
            await this.recordError('memory_usage_high', new Error('Utilisation mémoire élevée'), {
              memoryUsagePercent,
              heapUsed: systemMetrics.memory.heapUsed,
              heapTotal: systemMetrics.memory.heapTotal
            });
          }
        }
      } catch (error) {
        console.error('Erreur lors du monitoring automatique:', error);
      }
    }, interval);

    console.log('Monitoring automatique démarré');
  }
}

module.exports = MonitoringService;











