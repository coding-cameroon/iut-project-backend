const prisma = require("../lib/prisma");
const AIService = require("./aiService");
const CacheService = require("./cacheService");
const QueueService = require("./queueService");
const MonitoringService = require("./monitoringService");
const cacheService = new CacheService();
const monitoringService = new MonitoringService();

class AsyncProcessingService {
  /**
   * Traite une alerte de manière asynchrone
   * @param {string} alertId - ID de l'alerte
   * @param {Object} options - Options de traitement
   * @returns {Promise<Object>} Résultat du traitement
   */
  static async processAlertAsync(alertId, options = {}) {
    const startTime = Date.now();

    try {
      console.log(`Début du traitement asynchrone de l'alerte ${alertId}`);

      // Vérification du cache
      const cachedAnalysis = await cacheService.getAnalysis(alertId);
      if (cachedAnalysis && !options.forceRefresh) {
        console.log(`Analyse récupérée du cache pour l'alerte ${alertId}`);
        return {
          success: true,
          fromCache: true,
          analysis: cachedAnalysis,
          processingTime: Date.now() - startTime,
        };
      }

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
              role: true,
            },
          },
          media: true,
          responses: true,
          assignments: true,
        },
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
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 10,
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
        nearbyAlerts,
      };

      // Analyse avec l'IA
      const analysis = await AIService.analyzeAlert(alertWithContext);

      // Mise à jour de l'alerte avec les résultats
      const updatedAlert = await prisma.alert.update({
        where: { id: alertId },
        data: {
          type: analysis.classification.predictedType,
          priority: analysis.priority.level,
          isVerified: analysis.classification.confidence > 0.8,
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

      // Mise en cache de l'analyse
      await cacheService.cacheAnalysis(alertId, analysis);

      // Enregistrement des métriques
      const processingTime = Date.now() - startTime;
      await monitoringService.recordPerformance(
        "alert_analysis",
        processingTime,
        {
          alertId,
          confidence: analysis.classification.confidence,
          priority: analysis.priority.level,
        },
      );

      // Envoi aux services d'urgence si priorité élevée
      if (
        analysis.priority.level === "HIGH" ||
        analysis.priority.level === "CRITICAL"
      ) {
        await QueueService.addEmergencyNotificationJob(alertId, analysis, {
          priority: analysis.priority.level,
        });
      }

      console.log(
        `Traitement asynchrone terminé pour l'alerte ${alertId} en ${processingTime}ms`,
      );

      return {
        success: true,
        fromCache: false,
        alert: updatedAlert,
        analysis: analysis,
        processingTime,
      };
    } catch (error) {
      const processingTime = Date.now() - startTime;

      console.error(
        `Erreur lors du traitement asynchrone de l'alerte ${alertId}:`,
        error,
      );

      // Enregistrement de l'erreur
      await monitoringService.recordError("async_alert_processing", error, {
        alertId,
        processingTime,
      });

      return {
        success: false,
        error: error.message,
        processingTime,
      };
    }
  }

  /**
   * Traite plusieurs alertes en parallèle
   * @param {Array<string>} alertIds - IDs des alertes
   * @param {Object} options - Options de traitement
   * @returns {Promise<Array>} Résultats du traitement
   */
  static async processMultipleAlertsAsync(alertIds, options = {}) {
    const startTime = Date.now();
    const results = [];
    const concurrency = options.concurrency || 5;

    try {
      console.log(
        `Début du traitement parallèle de ${alertIds.length} alertes`,
      );

      // Traitement par lots pour éviter la surcharge
      for (let i = 0; i < alertIds.length; i += concurrency) {
        const batch = alertIds.slice(i, i + concurrency);
        const batchPromises = batch.map((alertId) =>
          this.processAlertAsync(alertId, options),
        );

        const batchResults = await Promise.allSettled(batchPromises);

        batchResults.forEach((result, index) => {
          if (result.status === "fulfilled") {
            results.push({
              alertId: batch[index],
              success: true,
              ...result.value,
            });
          } else {
            results.push({
              alertId: batch[index],
              success: false,
              error: result.reason.message,
            });
          }
        });

        // Pause entre les lots pour éviter la surcharge
        if (i + concurrency < alertIds.length) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }

      const processingTime = Date.now() - startTime;

      // Enregistrement des métriques
      await monitoringService.recordPerformance(
        "batch_alert_processing",
        processingTime,
        {
          totalAlerts: alertIds.length,
          successful: results.filter((r) => r.success).length,
          failed: results.filter((r) => !r.success).length,
        },
      );

      console.log(`Traitement parallèle terminé en ${processingTime}ms`);

      return {
        success: true,
        results,
        processingTime,
        summary: {
          total: alertIds.length,
          successful: results.filter((r) => r.success).length,
          failed: results.filter((r) => !r.success).length,
        },
      };
    } catch (error) {
      const processingTime = Date.now() - startTime;

      console.error("Erreur lors du traitement parallèle:", error);

      await monitoringService.recordError("batch_alert_processing", error, {
        alertIds,
        processingTime,
      });

      return {
        success: false,
        error: error.message,
        processingTime,
        results,
      };
    }
  }

  /**
   * Traite une alerte en arrière-plan via la queue
   * @param {string} alertId - ID de l'alerte
   * @param {Object} options - Options de traitement
   * @returns {Promise<Object>} Résultat de l'ajout à la queue
   */
  static async processAlertInBackground(alertId, options = {}) {
    try {
      console.log(`Ajout de l'alerte ${alertId} à la queue de traitement`);

      const result = await QueueService.addAnalysisJob(alertId, {
        priority: options.priority || "normal",
        delay: options.delay || 0,
        metadata: {
          source: "async_processing",
          ...options.metadata,
        },
      });

      if (result.success) {
        // Enregistrement de la métrique
        await monitoringService.recordAlertMetric(
          alertId,
          "queued_for_analysis",
          {
            jobId: result.jobId,
            priority: options.priority,
          },
        );
      }

      return result;
    } catch (error) {
      console.error(
        `Erreur lors de l'ajout de l'alerte ${alertId} à la queue:`,
        error,
      );

      await monitoringService.recordError("queue_alert_processing", error, {
        alertId,
        options,
      });

      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Traite les alertes en attente
   * @param {Object} options - Options de traitement
   * @returns {Promise<Object>} Résultat du traitement
   */
  static async processPendingAlerts(options = {}) {
    const startTime = Date.now();

    try {
      console.log("Début du traitement des alertes en attente");

      // Récupération des alertes en attente
      const pendingAlerts = await prisma.alert.findMany({
        where: {
          status: "PENDING",
          createdAt: {
            gte: new Date(Date.now() - (options.maxAge || 24 * 60 * 60 * 1000)), // 24h par défaut
          },
        },
        select: {
          id: true,
          type: true,
          priority: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
        take: options.limit || 100,
      });

      if (pendingAlerts.length === 0) {
        return {
          success: true,
          message: "Aucune alerte en attente",
          processed: 0,
        };
      }

      // Traitement des alertes
      const results = await this.processMultipleAlertsAsync(
        pendingAlerts.map((alert) => alert.id),
        {
          concurrency: options.concurrency || 5,
          ...options,
        },
      );

      const processingTime = Date.now() - startTime;

      // Enregistrement des métriques
      await monitoringService.recordPerformance(
        "pending_alerts_processing",
        processingTime,
        {
          totalAlerts: pendingAlerts.length,
          successful: results.summary.successful,
          failed: results.summary.failed,
        },
      );

      console.log(
        `Traitement des alertes en attente terminé en ${processingTime}ms`,
      );

      return {
        success: true,
        results,
        processingTime,
        summary: {
          total: pendingAlerts.length,
          successful: results.summary.successful,
          failed: results.summary.failed,
        },
      };
    } catch (error) {
      const processingTime = Date.now() - startTime;

      console.error("Erreur lors du traitement des alertes en attente:", error);

      await monitoringService.recordError("pending_alerts_processing", error, {
        options,
        processingTime,
      });

      return {
        success: false,
        error: error.message,
        processingTime,
      };
    }
  }

  /**
   * Optimise les performances du système
   * @returns {Promise<Object>} Résultat de l'optimisation
   */
  static async optimizePerformance() {
    const startTime = Date.now();

    try {
      console.log("Début de l'optimisation des performances");

      const optimizations = [];

      // Nettoyage du cache
      const cacheCleanup = await cacheService.cleanCache();
      optimizations.push({
        type: "cache_cleanup",
        result: `${cacheCleanup} clés supprimées du cache`,
      });

      // Nettoyage des queues
      await QueueService.cleanQueues("all", 24);
      optimizations.push({
        type: "queue_cleanup",
        result: "Queues nettoyées",
      });

      // Nettoyage des anciennes métriques
      await monitoringService.cleanOldMetrics(24);
      optimizations.push({
        type: "metrics_cleanup",
        result: "Métriques anciennes nettoyées",
      });

      // Optimisation de la base de données
      try {
        await prisma.$executeRaw`VACUUM ANALYZE`;
        optimizations.push({
          type: "database_optimization",
          result: "Base de données optimisée",
        });
      } catch (dbError) {
        console.warn(
          "Impossible d'optimiser la base de données:",
          dbError.message,
        );
      }

      const processingTime = Date.now() - startTime;

      // Enregistrement des métriques
      await monitoringService.recordPerformance(
        "system_optimization",
        processingTime,
        {
          optimizations: optimizations.length,
        },
      );

      console.log(
        `Optimisation des performances terminée en ${processingTime}ms`,
      );

      return {
        success: true,
        optimizations,
        processingTime,
      };
    } catch (error) {
      const processingTime = Date.now() - startTime;

      console.error("Erreur lors de l'optimisation des performances:", error);

      await monitoringService.recordError("system_optimization", error, {
        processingTime,
      });

      return {
        success: false,
        error: error.message,
        processingTime,
      };
    }
  }

  /**
   * Obtient le statut du traitement asynchrone
   * @returns {Promise<Object>} Statut du traitement
   */
  static async getProcessingStatus() {
    try {
      const [queueStatus, cacheStats, systemMetrics, databaseStats] =
        await Promise.all([
          QueueService.getQueueStatus(),
          cacheService.getCacheStats(),
          monitoringService.getSystemMetrics(),
          monitoringService.getDatabaseStats(),
        ]);

      return {
        queues: queueStatus,
        cache: cacheStats,
        system: systemMetrics,
        database: databaseStats,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error("Erreur lors de la récupération du statut:", error);
      return {
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }
}

module.exports = AsyncProcessingService;
