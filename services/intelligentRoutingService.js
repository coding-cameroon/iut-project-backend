const prisma = require("../lib/prisma");
const AIService = require("./aiService");
const CacheService = require("./cacheService");
const MonitoringService = require("./monitoringService");
const cacheService = new CacheService();
const monitoringService = new MonitoringService();

class IntelligentRoutingService {
  /**
   * Route une alerte vers les services d'urgence appropriés
   * @param {Object} alert - Alerte à router
   * @param {Object} analysis - Analyse IA de l'alerte
   * @returns {Promise<Object>} Résultat du routage
   */
  static async routeAlert(alert, analysis) {
    const startTime = Date.now();

    try {
      console.log(`Début du routage intelligent pour l'alerte ${alert.id}`);

      // Récupération des services d'urgence disponibles
      const emergencyServices = await this.getAvailableEmergencyServices();

      // Calcul du score de routage pour chaque service
      const routingScores = await this.calculateRoutingScores(
        alert,
        analysis,
        emergencyServices,
      );

      // Sélection des services les plus appropriés
      const selectedServices = this.selectOptimalServices(
        routingScores,
        analysis,
      );

      // Attribution des services
      const assignments = await this.assignServicesToAlert(
        alert.id,
        selectedServices,
      );

      // Envoi des notifications
      const notifications = await this.sendNotifications(
        alert,
        selectedServices,
        analysis,
      );

      const processingTime = Date.now() - startTime;

      // Enregistrement des métriques
      await monitoringService.recordPerformance(
        "intelligent_routing",
        processingTime,
        {
          alertId: alert.id,
          servicesSelected: selectedServices.length,
          confidence: analysis.classification.confidence,
        },
      );

      console.log(
        `Routage intelligent terminé pour l'alerte ${alert.id} en ${processingTime}ms`,
      );

      return {
        success: true,
        alertId: alert.id,
        selectedServices,
        assignments,
        notifications,
        routingScores,
        processingTime,
      };
    } catch (error) {
      const processingTime = Date.now() - startTime;

      console.error(
        `Erreur lors du routage intelligent de l'alerte ${alert.id}:`,
        error,
      );

      await monitoringService.recordError("intelligent_routing", error, {
        alertId: alert.id,
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
   * Récupère les services d'urgence disponibles
   * @returns {Promise<Array>} Services d'urgence disponibles
   */
  static async getAvailableEmergencyServices() {
    try {
      const services = await prisma.emergencyService.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
      });

      // Mise en cache des services
      await cacheService.set("emergency_services", services, 1800); // 30 minutes

      return services;
    } catch (error) {
      console.error(
        "Erreur lors de la récupération des services d'urgence:",
        error,
      );

      // Fallback vers le cache
      const cachedServices = await cacheService.get("emergency_services");
      return cachedServices || [];
    }
  }

  /**
   * Calcule les scores de routage pour chaque service
   * @param {Object} alert - Alerte à router
   * @param {Object} analysis - Analyse IA
   * @param {Array} services - Services d'urgence disponibles
   * @returns {Promise<Array>} Scores de routage
   */
  static async calculateRoutingScores(alert, analysis, services) {
    const routingScores = [];

    for (const service of services) {
      const score = await this.calculateServiceScore(alert, analysis, service);
      routingScores.push({
        service,
        score,
        factors: score.factors,
        confidence: score.confidence,
      });
    }

    // Tri par score décroissant
    return routingScores.sort((a, b) => b.score.total - a.score.total);
  }

  /**
   * Calcule le score de routage pour un service spécifique
   * @param {Object} alert - Alerte à router
   * @param {Object} analysis - Analyse IA
   * @param {Object} service - Service d'urgence
   * @returns {Promise<Object>} Score de routage
   */
  static async calculateServiceScore(
    alert,
    analysis,
    service,
    relevantServiceIds,
  ) {
    const factors = {
      typeMatch: 0,
      priorityMatch: 0,
      locationProximity: 0,
      availability: 0,
      workload: 0,
      expertise: 0,
      responseTime: 0,
    };

    // 1. Correspondance du type d'alerte (Basé sur les relations BDD)
    factors.typeMatch = this.calculateTypeMatch(service.id, relevantServiceIds);

    // 2. Correspondance de la priorité
    factors.priorityMatch = this.calculatePriorityMatch(
      analysis.priority.level,
      service.type,
    );

    // 3. Proximité géographique
    factors.locationProximity = await this.calculateLocationProximity(
      alert,
      service,
    );

    // 4. Disponibilité du service
    factors.availability = await this.calculateServiceAvailability(service);

    // 5. Charge de travail actuelle
    factors.workload = await this.calculateServiceWorkload(service);

    // 6. Expertise du service
    factors.expertise = await this.calculateServiceExpertise(
      service,
      alert.type,
    );

    // 7. Temps de réponse estimé
    factors.responseTime = await this.calculateResponseTime(alert, service);

    // Calcul du score total pondéré
    const weights = {
      typeMatch: 0.25,
      priorityMatch: 0.2,
      locationProximity: 0.15,
      availability: 0.15,
      workload: 0.1,
      expertise: 0.1,
      responseTime: 0.05,
    };

    const totalScore = Object.keys(factors).reduce((total, factor) => {
      return total + factors[factor] * weights[factor];
    }, 0);

    return {
      total: Math.min(Math.max(totalScore, 0), 1), // Score entre 0 et 1
      factors,
      confidence: this.calculateConfidence(factors),
    };
  }

  /**
   * Calcule la correspondance du type d'alerte avec le service
   * @param {string} serviceId - ID du service
   * @param {Array} relevantServiceIds - IDs des services pertinents
   * @returns {number} Score de correspondance
   */
  static calculateTypeMatch(serviceId, relevantServiceIds) {
    if (!relevantServiceIds || relevantServiceIds.length === 0) {
      // Si aucun service n'est spécifiquement lié, on donne un score neutre
      // ou on pourrait baser sur une logique de repli
      return 0.5;
    }
    return relevantServiceIds.includes(serviceId) ? 1.0 : 0.0;
  }

  /**
   * Calcule la correspondance de priorité
   * @param {string} priority - Priorité de l'alerte
   * @param {string} serviceType - Type de service
   * @returns {number} Score de correspondance
   */
  static calculatePriorityMatch(priority, serviceType) {
    const priorityWeights = {
      CRITICAL: 1.0,
      HIGH: 0.8,
      MEDIUM: 0.6,
      LOW: 0.4,
    };

    const servicePriority = {
      AMBULANCE: 0.9, // Priorité élevée pour les urgences médicales
      FIRE_DEPARTMENT: 0.8,
      POLICE: 0.7,
      HOSPITAL: 0.8,
      CIVIL_PROTECTION: 0.6,
    };

    return priorityWeights[priority] * (servicePriority[serviceType] || 0.5);
  }

  /**
   * Calcule la proximité géographique
   * @param {Object} alert - Alerte
   * @param {Object} service - Service d'urgence
   * @returns {Promise<number>} Score de proximité
   */
  static async calculateLocationProximity(alert, service) {
    try {
      // Calcul de la distance entre l'alerte et le service
      const distance = await prisma.$queryRaw`
        SELECT ST_Distance(
          ST_Point(${service.longitude}, ${service.latitude})::geography,
          ST_Point(${alert.longitude}, ${alert.latitude})::geography
        ) as distance
      `;

      const distanceKm = distance[0].distance / 1000; // Conversion en kilomètres

      // Score basé sur la distance (plus proche = score plus élevé)
      if (distanceKm <= 5) return 1.0;
      if (distanceKm <= 10) return 0.8;
      if (distanceKm <= 20) return 0.6;
      if (distanceKm <= 50) return 0.4;
      return 0.2;
    } catch (error) {
      console.error("Erreur lors du calcul de la proximité:", error);
      return 0.5; // Score neutre en cas d'erreur
    }
  }

  /**
   * Calcule la disponibilité du service
   * @param {Object} service - Service d'urgence
   * @returns {Promise<number>} Score de disponibilité
   */
  static async calculateServiceAvailability(service) {
    try {
      // Vérification des alertes actives assignées à ce service
      const activeAssignments = await prisma.alertAssignment.count({
        where: {
          assignedTo: service.id,
          status: {
            in: ["ASSIGNED", "IN_PROGRESS"],
          },
        },
      });

      // Score basé sur la charge actuelle
      if (activeAssignments === 0) return 1.0;
      if (activeAssignments <= 2) return 0.8;
      if (activeAssignments <= 5) return 0.6;
      return 0.4;
    } catch (error) {
      console.error("Erreur lors du calcul de la disponibilité:", error);
      return 0.7; // Score par défaut
    }
  }

  /**
   * Calcule la charge de travail du service
   * @param {Object} service - Service d'urgence
   * @returns {Promise<number>} Score de charge de travail
   */
  static async calculateServiceWorkload(service) {
    try {
      // Récupération des alertes des dernières 24h
      const recentAlerts = await prisma.alertAssignment.count({
        where: {
          assignedTo: service.id,
          createdAt: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
          },
        },
      });

      // Score inversement proportionnel à la charge
      if (recentAlerts === 0) return 1.0;
      if (recentAlerts <= 5) return 0.8;
      if (recentAlerts <= 10) return 0.6;
      if (recentAlerts <= 20) return 0.4;
      return 0.2;
    } catch (error) {
      console.error("Erreur lors du calcul de la charge de travail:", error);
      return 0.7;
    }
  }

  /**
   * Calcule l'expertise du service
   * @param {Object} service - Service d'urgence
   * @param {string} alertType - Type d'alerte
   * @returns {Promise<number>} Score d'expertise
   */
  static async calculateServiceExpertise(service, alertType) {
    try {
      // Récupération des statistiques de résolution par type
      const resolutionStats = await prisma.alertAssignment.groupBy({
        by: ["status"],
        where: {
          assignedTo: service.id,
          alert: {
            type: alertType,
          },
          createdAt: {
            gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 jours
          },
        },
        _count: { status: true },
      });

      const total = resolutionStats.reduce(
        (sum, stat) => sum + stat._count.status,
        0,
      );
      const completed =
        resolutionStats.find((stat) => stat.status === "COMPLETED")?._count
          .status || 0;

      if (total === 0) return 0.5; // Score neutre si pas d'historique

      return completed / total; // Taux de réussite
    } catch (error) {
      console.error("Erreur lors du calcul de l'expertise:", error);
      return 0.7;
    }
  }

  /**
   * Calcule le temps de réponse estimé
   * @param {Object} alert - Alerte
   * @param {Object} service - Service d'urgence
   * @returns {Promise<number>} Score de temps de réponse
   */
  static async calculateResponseTime(alert, service) {
    try {
      // Calcul de la distance pour estimation du temps
      const distance = await prisma.$queryRaw`
        SELECT ST_Distance(
          ST_Point(${service.longitude}, ${service.latitude})::geography,
          ST_Point(${alert.longitude}, ${alert.latitude})::geography
        ) as distance
      `;

      const distanceKm = distance[0].distance / 1000;

      // Estimation du temps de réponse (vitesse moyenne 60 km/h)
      const estimatedTime = (distanceKm / 60) * 60; // en minutes

      // Score basé sur le temps estimé
      if (estimatedTime <= 10) return 1.0;
      if (estimatedTime <= 20) return 0.8;
      if (estimatedTime <= 30) return 0.6;
      if (estimatedTime <= 60) return 0.4;
      return 0.2;
    } catch (error) {
      console.error("Erreur lors du calcul du temps de réponse:", error);
      return 0.5;
    }
  }

  /**
   * Calcule la confiance du score
   * @param {Object} factors - Facteurs de score
   * @returns {number} Niveau de confiance
   */
  static calculateConfidence(factors) {
    const nonZeroFactors = Object.values(factors).filter(
      (factor) => factor > 0,
    ).length;
    const totalFactors = Object.keys(factors).length;

    return nonZeroFactors / totalFactors;
  }

  /**
   * Sélectionne les services optimaux
   * @param {Array} routingScores - Scores de routage
   * @param {Object} analysis - Analyse IA
   * @returns {Array} Services sélectionnés
   */
  static selectOptimalServices(routingScores, analysis) {
    const selectedServices = [];
    const minScore = 0.6; // Score minimum pour sélection
    const maxServices = 3; // Nombre maximum de services par alerte

    // Filtrage des services avec score suffisant
    const qualifiedServices = routingScores.filter(
      (score) => score.score.total >= minScore && score.confidence >= 0.5,
    );

    // Sélection basée sur la priorité de l'alerte
    if (analysis.priority.level === "CRITICAL") {
      // Pour les alertes critiques, sélectionner les 2 meilleurs services
      selectedServices.push(...qualifiedServices.slice(0, 2));
    } else if (analysis.priority.level === "HIGH") {
      // Pour les alertes de haute priorité, sélectionner le meilleur service
      selectedServices.push(qualifiedServices[0]);
    } else {
      // Pour les autres alertes, sélectionner le meilleur service si disponible
      if (qualifiedServices.length > 0) {
        selectedServices.push(qualifiedServices[0]);
      }
    }

    // Limitation du nombre de services
    return selectedServices.slice(0, maxServices);
  }

  /**
   * Assigne les services à l'alerte
   * @param {string} alertId - ID de l'alerte
   * @param {Array} selectedServices - Services sélectionnés
   * @returns {Promise<Array>} Assignations créées
   */
  static async assignServicesToAlert(alertId, selectedServices) {
    const assignments = [];

    for (const serviceScore of selectedServices) {
      try {
        const assignment = await prisma.alertAssignment.create({
          data: {
            alertId,
            assignedTo: serviceScore.service.id,
            status: "ASSIGNED",
            notes: `Routage automatique - Score: ${Math.round(serviceScore.score.total * 100)}%`,
          },
        });

        assignments.push(assignment);
      } catch (error) {
        console.error(
          `Erreur lors de l'assignation du service ${serviceScore.service.id}:`,
          error,
        );
      }
    }

    return assignments;
  }

  /**
   * Envoie les notifications aux services
   * @param {Object} alert - Alerte
   * @param {Array} selectedServices - Services sélectionnés
   * @param {Object} analysis - Analyse IA
   * @returns {Promise<Array>} Résultats des notifications
   */
  static async sendNotifications(alert, selectedServices, analysis) {
    const notifications = [];

    for (const serviceScore of selectedServices) {
      try {
        const notification = await AIService.sendToEmergencyServices(
          alert,
          analysis,
        );
        notifications.push({
          serviceId: serviceScore.service.id,
          serviceName: serviceScore.service.name,
          success: notification.success,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        console.error(
          `Erreur lors de la notification du service ${serviceScore.service.id}:`,
          error,
        );
        notifications.push({
          serviceId: serviceScore.service.id,
          serviceName: serviceScore.service.name,
          success: false,
          error: error.message,
          timestamp: new Date().toISOString(),
        });
      }
    }

    return notifications;
  }

  /**
   * Obtient les statistiques de routage
   * @param {Object} filters - Filtres de recherche
   * @returns {Promise<Object>} Statistiques de routage
   */
  static async getRoutingStatistics(filters = {}) {
    try {
      const where = {};

      if (filters.startDate || filters.endDate) {
        where.createdAt = {};
        if (filters.startDate)
          where.createdAt.gte = new Date(filters.startDate);
        if (filters.endDate) where.createdAt.lte = new Date(filters.endDate);
      }

      const [
        totalAssignments,
        assignmentsByService,
        assignmentsByStatus,
        averageResponseTime,
        successRate,
      ] = await Promise.all([
        prisma.alertAssignment.count({ where }),
        prisma.alertAssignment.groupBy({
          by: ["assignedTo"],
          where,
          _count: { assignedTo: true },
        }),
        prisma.alertAssignment.groupBy({
          by: ["status"],
          where,
          _count: { status: true },
        }),
        this.calculateAverageResponseTime(where),
        this.calculateSuccessRate(where),
      ]);

      return {
        totalAssignments,
        assignmentsByService,
        assignmentsByStatus,
        averageResponseTime,
        successRate,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error(
        "Erreur lors de la récupération des statistiques de routage:",
        error,
      );
      return null;
    }
  }

  /**
   * Calcule le temps de réponse moyen
   * @param {Object} where - Conditions de filtrage
   * @returns {Promise<number>} Temps de réponse moyen en minutes
   */
  static async calculateAverageResponseTime(where) {
    try {
      const assignments = await prisma.alertAssignment.findMany({
        where: {
          ...where,
          status: "COMPLETED",
        },
        select: {
          createdAt: true,
          updatedAt: true,
        },
      });

      if (assignments.length === 0) return 0;

      const totalMinutes = assignments.reduce((total, assignment) => {
        const responseTime =
          assignment.updatedAt.getTime() - assignment.createdAt.getTime();
        return total + responseTime / (1000 * 60); // Conversion en minutes
      }, 0);

      return totalMinutes / assignments.length;
    } catch (error) {
      console.error("Erreur lors du calcul du temps de réponse moyen:", error);
      return 0;
    }
  }

  /**
   * Calcule le taux de réussite
   * @param {Object} where - Conditions de filtrage
   * @returns {Promise<number>} Taux de réussite (0-1)
   */
  static async calculateSuccessRate(where) {
    try {
      const [total, completed] = await Promise.all([
        prisma.alertAssignment.count({ where }),
        prisma.alertAssignment.count({
          where: {
            ...where,
            status: "COMPLETED",
          },
        }),
      ]);

      return total > 0 ? completed / total : 0;
    } catch (error) {
      console.error("Erreur lors du calcul du taux de réussite:", error);
      return 0;
    }
  }
}

module.exports = IntelligentRoutingService;
