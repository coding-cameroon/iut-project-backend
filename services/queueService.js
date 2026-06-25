const Queue = require('bull');
const Redis = require('ioredis');
const AIService = require('./aiService');
const { PrismaClient } = require('@prisma/client');
const config = require('../config/config');

const prisma = new PrismaClient();

// Redis disabled - running without queues
const redis = null;
console.log('Redis disabled in queue service - running without background jobs');

// Queues disabled - running without background jobs
const aiAnalysisQueue = null;
const emergencyNotificationQueue = null;

class QueueService {
  /**
   * Ajoute une tâche d'analyse IA à la queue
   * @param {string} alertId - ID de l'alerte à analyser
   * @param {Object} options - Options de la tâche
   * @returns {Promise<Object>} Job créé
   */
  static async addAnalysisJob(alertId, options = {}) {
    try {
      if (!aiAnalysisQueue) {
        console.log('Queue service disabled - skipping analysis job');
        return null;
      }
      const job = await aiAnalysisQueue.add('analyze-alert', {
        alertId,
        priority: options.priority || 'normal',
        retryCount: 0,
        metadata: {
          timestamp: new Date().toISOString(),
          source: 'api',
          ...options.metadata
        }
      }, {
        priority: this.getJobPriority(options.priority),
        delay: options.delay || 0,
        jobId: `analysis-${alertId}-${Date.now()}`
      });

      console.log(`Tâche d'analyse ajoutée à la queue: ${job.id}`);
      return {
        success: true,
        jobId: job.id,
        status: 'queued'
      };

    } catch (error) {
      console.error('Erreur lors de l\'ajout de la tâche d\'analyse:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Ajoute une tâche de notification d'urgence
   * @param {string} alertId - ID de l'alerte
   * @param {Object} analysis - Résultats de l'analyse
   * @param {Object} options - Options de la tâche
   * @returns {Promise<Object>} Job créé
   */
  static async addEmergencyNotificationJob(alertId, analysis, options = {}) {
    try {
      const job = await emergencyNotificationQueue.add('notify-emergency', {
        alertId,
        analysis,
        priority: analysis.priority.level,
        services: analysis.recommendations.suggestedServices,
        metadata: {
          timestamp: new Date().toISOString(),
          riskLevel: analysis.recommendations.riskLevel,
          ...options.metadata
        }
      }, {
        priority: this.getEmergencyPriority(analysis.priority.level),
        delay: options.delay || 0,
        jobId: `emergency-${alertId}-${Date.now()}`
      });

      console.log(`Tâche de notification d'urgence ajoutée: ${job.id}`);
      return {
        success: true,
        jobId: job.id,
        status: 'queued'
      };

    } catch (error) {
      console.error('Erreur lors de l\'ajout de la tâche de notification:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Traite une tâche d'analyse IA
   * @param {Object} job - Tâche à traiter
   * @returns {Promise<Object>} Résultat du traitement
   */
  static async processAnalysisJob(job) {
    const { alertId, priority, retryCount } = job.data;
    const startTime = Date.now();

    try {
      console.log(`Début de l'analyse IA pour l'alerte ${alertId}`);

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
        throw new Error(`Alerte ${alertId} non trouvée`);
      }

      // Récupération du contexte historique
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

      // Récupération des alertes proches
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

      // Mise à jour de l'alerte avec les résultats
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

      const processingTime = Date.now() - startTime;

      // Envoi aux services d'urgence si priorité élevée
      if (analysis.priority.level === 'HIGH' || analysis.priority.level === 'CRITICAL') {
        await this.addEmergencyNotificationJob(alertId, analysis, {
          priority: analysis.priority.level
        });
      }

      // Mise à jour des métriques
      await this.updateMetrics('analysis', {
        processingTime,
        success: true,
        confidence: analysis.classification.confidence,
        priority: analysis.priority.level
      });

      console.log(`Analyse IA terminée pour l'alerte ${alertId} en ${processingTime}ms`);

      return {
        success: true,
        alert: updatedAlert,
        analysis: analysis,
        processingTime,
        jobId: job.id
      };

    } catch (error) {
      const processingTime = Date.now() - startTime;
      
      console.error(`Erreur lors de l'analyse de l'alerte ${alertId}:`, error);

      // Mise à jour des métriques d'erreur
      await this.updateMetrics('analysis', {
        processingTime,
        success: false,
        error: error.message,
        retryCount
      });

      throw error;
    }
  }

  /**
   * Traite une tâche de notification d'urgence
   * @param {Object} job - Tâche à traiter
   * @returns {Promise<Object>} Résultat du traitement
   */
  static async processEmergencyNotificationJob(job) {
    const { alertId, analysis, services } = job.data;
    const startTime = Date.now();

    try {
      console.log(`Début de la notification d'urgence pour l'alerte ${alertId}`);

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
          media: true
        }
      });

      if (!alert) {
        throw new Error(`Alerte ${alertId} non trouvée`);
      }

      // Envoi aux services d'urgence
      const emergencyResult = await AIService.sendToEmergencyServices(alert, analysis);

      const processingTime = Date.now() - startTime;

      // Mise à jour des métriques
      await this.updateMetrics('emergency_notification', {
        processingTime,
        success: emergencyResult.success,
        servicesNotified: emergencyResult.servicesNotified || 0
      });

      console.log(`Notification d'urgence terminée pour l'alerte ${alertId} en ${processingTime}ms`);

      return {
        success: true,
        emergencyResult,
        processingTime,
        jobId: job.id
      };

    } catch (error) {
      const processingTime = Date.now() - startTime;
      
      console.error(`Erreur lors de la notification d'urgence pour l'alerte ${alertId}:`, error);

      // Mise à jour des métriques d'erreur
      await this.updateMetrics('emergency_notification', {
        processingTime,
        success: false,
        error: error.message
      });

      throw error;
    }
  }

  /**
   * Obtient la priorité d'une tâche
   * @param {string} priority - Priorité de l'alerte
   * @returns {number} Priorité de la tâche
   */
  static getJobPriority(priority) {
    const priorities = {
      'LOW': 1,
      'MEDIUM': 2,
      'HIGH': 3,
      'CRITICAL': 4
    };
    return priorities[priority] || 2;
  }

  /**
   * Obtient la priorité d'urgence
   * @param {string} priority - Priorité de l'alerte
   * @returns {number} Priorité d'urgence
   */
  static getEmergencyPriority(priority) {
    const priorities = {
      'LOW': 1,
      'MEDIUM': 2,
      'HIGH': 3,
      'CRITICAL': 4
    };
    return priorities[priority] || 2;
  }

  /**
   * Met à jour les métriques
   * @param {string} type - Type de métrique
   * @param {Object} data - Données de la métrique
   */
  static async updateMetrics(type, data) {
    try {
      const metrics = {
        type,
        timestamp: new Date().toISOString(),
        ...data
      };

      // Stockage dans Redis
      await redis.lpush(`metrics:${type}`, JSON.stringify(metrics));
      await redis.expire(`metrics:${type}`, 86400); // 24 heures

      // Limitation du nombre de métriques stockées
      await redis.ltrim(`metrics:${type}`, 0, 999);

    } catch (error) {
      console.error('Erreur lors de la mise à jour des métriques:', error);
    }
  }

  /**
   * Récupère les métriques
   * @param {string} type - Type de métrique
   * @param {number} limit - Nombre de métriques à récupérer
   * @returns {Promise<Array>} Métriques
   */
  static async getMetrics(type, limit = 100) {
    try {
      const metrics = await redis.lrange(`metrics:${type}`, 0, limit - 1);
      return metrics.map(metric => JSON.parse(metric));
    } catch (error) {
      console.error('Erreur lors de la récupération des métriques:', error);
      return [];
    }
  }

  /**
   * Obtient le statut des queues
   * @returns {Promise<Object>} Statut des queues
   */
  static async getQueueStatus() {
    try {
      const [aiQueueStats, emergencyQueueStats] = await Promise.all([
        aiAnalysisQueue.getJobCounts(),
        emergencyNotificationQueue.getJobCounts()
      ]);

      return {
        aiAnalysis: {
          waiting: aiQueueStats.waiting,
          active: aiQueueStats.active,
          completed: aiQueueStats.completed,
          failed: aiQueueStats.failed,
          delayed: aiQueueStats.delayed
        },
        emergencyNotification: {
          waiting: emergencyQueueStats.waiting,
          active: emergencyQueueStats.active,
          completed: emergencyQueueStats.completed,
          failed: emergencyQueueStats.failed,
          delayed: emergencyQueueStats.delayed
        }
      };
    } catch (error) {
      console.error('Erreur lors de la récupération du statut des queues:', error);
      return null;
    }
  }

  /**
   * Nettoie les queues
   * @param {string} queueName - Nom de la queue à nettoyer
   * @param {number} age - Âge des jobs à supprimer (en heures)
   */
  static async cleanQueues(queueName = 'all', age = 24) {
    try {
      if (queueName === 'all' || queueName === 'ai') {
        await aiAnalysisQueue.clean(age * 60 * 60 * 1000, 'completed');
        await aiAnalysisQueue.clean(age * 60 * 60 * 1000, 'failed');
      }

      if (queueName === 'all' || queueName === 'emergency') {
        await emergencyNotificationQueue.clean(age * 60 * 60 * 1000, 'completed');
        await emergencyNotificationQueue.clean(age * 60 * 60 * 1000, 'failed');
      }

      console.log(`Nettoyage des queues terminé (${queueName}, ${age}h)`);
    } catch (error) {
      console.error('Erreur lors du nettoyage des queues:', error);
    }
  }

  /**
   * Initialise les processeurs de queues
   */
  static initializeProcessors() {
    // Skip processor initialization since queues are disabled
    if (!aiAnalysisQueue && !emergencyNotificationQueue) {
      console.log('Queue processors disabled - skipping initialization');
      return;
    }

    // Processeur pour l'analyse IA
    if (aiAnalysisQueue) {
      aiAnalysisQueue.process('analyze-alert', 5, async (job) => {
        return await this.processAnalysisJob(job);
      });
    }

    // Processeur pour les notifications d'urgence
    if (emergencyNotificationQueue) {
      emergencyNotificationQueue.process('notify-emergency', 3, async (job) => {
        return await this.processEmergencyNotificationJob(job);
      });
    }

    // Gestion des événements
    if (aiAnalysisQueue) {
      aiAnalysisQueue.on('completed', (job, result) => {
        console.log(`Analyse IA terminée: ${job.id}`);
      });

      aiAnalysisQueue.on('failed', (job, err) => {
        console.error(`Analyse IA échouée: ${job.id}`, err);
      });
    }

    if (emergencyNotificationQueue) {
      emergencyNotificationQueue.on('completed', (job, result) => {
        console.log(`Notification d'urgence terminée: ${job.id}`);
      });

      emergencyNotificationQueue.on('failed', (job, err) => {
        console.error(`Notification d'urgence échouée: ${job.id}`, err);
      });
    }

    console.log('Processeurs de queues initialisés (ou désactivés)');
  }

  /**
   * Arrête les queues
   */
  static async shutdown() {
    try {
      if (aiAnalysisQueue) {
        await aiAnalysisQueue.close();
      }
      if (emergencyNotificationQueue) {
        await emergencyNotificationQueue.close();
      }
      if (redis) {
        await redis.quit();
      }
      console.log('Queues arrêtées (ou désactivées)');
    } catch (error) {
      console.error('Erreur lors de l\'arrêt des queues:', error);
    }
  }
}

module.exports = QueueService;











