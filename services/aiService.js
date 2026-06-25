const axios = require('axios');
const config = require('../config/config');

class AIService {
  /**
   * Analyse une alerte avec l'IA pour déterminer le type et la priorité
   * @param {Object} alertData - Données de l'alerte à analyser
   * @returns {Promise<Object>} Résultat de l'analyse IA
   */
  static async analyzeAlert(alertData) {
    try {
      if (!config.ai.enabled) {
        console.log('Service IA désactivé, utilisation des valeurs par défaut');
        return this.getDefaultAnalysis(alertData);
      }

      // Préparation des données pour l'IA
      const aiPayload = this.prepareAIPayload(alertData);
      
      console.log('Envoi des données à l\'IA:', JSON.stringify(aiPayload, null, 2));

      const response = await axios.post(
        `${config.ai.serviceUrl}/analyze`,
        aiPayload,
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.ai.apiKey}`,
            'X-API-Version': '1.0'
          },
          timeout: config.ai.timeout
        }
      );

      if (response.status === 200) {
        const analysis = this.processAIResponse(response.data);
        console.log('Analyse IA reçue:', analysis);
        return analysis;
      } else {
        throw new Error(`Erreur IA: ${response.status} - ${response.statusText}`);
      }

    } catch (error) {
      console.error('Erreur lors de l\'analyse IA:', error);
      
      // Fallback vers l'analyse par défaut en cas d'erreur
      return this.getDefaultAnalysis(alertData);
    }
  }

  /**
   * Prépare les données à envoyer à l'IA
   * @param {Object} alertData - Données de l'alerte
   * @returns {Object} Payload formaté pour l'IA
   */
  static prepareAIPayload(alertData) {
    return {
      // Informations de base de l'alerte
      alert: {
        id: alertData.id,
        title: alertData.title,
        description: alertData.description,
        currentType: alertData.type,
        currentPriority: alertData.priority,
        createdAt: alertData.createdAt,
        isAnonymous: alertData.isAnonymous
      },

      // Données géographiques
      location: {
        latitude: alertData.latitude,
        longitude: alertData.longitude,
        address: alertData.address,
        city: alertData.city,
        country: alertData.country,
        coordinates: {
          lat: alertData.latitude,
          lng: alertData.longitude
        }
      },

      // Informations sur l'utilisateur (si disponible)
      user: alertData.user ? {
        id: alertData.user.id,
        firstName: alertData.user.firstName,
        lastName: alertData.user.lastName,
        email: alertData.user.email,
        phone: alertData.user.phone,
        role: alertData.user.role
      } : null,

      // Médias associés
      media: alertData.media ? alertData.media.map(media => ({
        id: media.id,
        type: this.getMediaType(media.mimeType),
        mimeType: media.mimeType,
        size: media.size,
        url: media.url,
        filename: media.filename,
        originalName: media.originalName,
        createdAt: media.createdAt
      })) : [],

      // Contexte historique (si disponible)
      context: {
        userAlertHistory: alertData.userAlertHistory || [],
        nearbyAlerts: alertData.nearbyAlerts || [],
        timeOfDay: new Date().getHours(),
        dayOfWeek: new Date().getDay(),
        season: this.getSeason(new Date())
      },

      // Métadonnées de traitement
      metadata: {
        timestamp: new Date().toISOString(),
        version: '1.0',
        source: 'securite-temps-reel',
        language: 'fr',
        region: 'CM' // Cameroun
      }
    };
  }

  /**
   * Traite la réponse de l'IA
   * @param {Object} aiResponse - Réponse brute de l'IA
   * @returns {Object} Analyse structurée
   */
  static processAIResponse(aiResponse) {
    return {
      // Classification de l'alerte
      classification: {
        predictedType: aiResponse.predicted_type || 'OTHER',
        confidence: aiResponse.confidence || 0.5,
        alternativeTypes: aiResponse.alternative_types || []
      },

      // Priorité suggérée
      priority: {
        level: aiResponse.priority_level || 'MEDIUM',
        score: aiResponse.priority_score || 0.5,
        factors: aiResponse.priority_factors || []
      },

      // Analyse des médias
      mediaAnalysis: {
        hasImages: aiResponse.has_images || false,
        hasVideos: aiResponse.has_videos || false,
        hasAudio: aiResponse.has_audio || false,
        imageAnalysis: aiResponse.image_analysis || null,
        videoAnalysis: aiResponse.video_analysis || null,
        audioAnalysis: aiResponse.audio_analysis || null
      },

      // Analyse textuelle
      textAnalysis: {
        sentiment: aiResponse.sentiment || 'neutral',
        urgency: aiResponse.urgency || 'medium',
        keywords: aiResponse.keywords || [],
        entities: aiResponse.entities || [],
        language: aiResponse.language || 'fr'
      },

      // Recommandations
      recommendations: {
        suggestedServices: aiResponse.suggested_services || [],
        estimatedResponseTime: aiResponse.estimated_response_time || 30,
        requiredResources: aiResponse.required_resources || [],
        riskLevel: aiResponse.risk_level || 'medium'
      },

      // Métadonnées de l'analyse
      analysis: {
        processingTime: aiResponse.processing_time || 0,
        modelVersion: aiResponse.model_version || '1.0',
        accuracy: aiResponse.accuracy || 0.8,
        timestamp: new Date().toISOString()
      }
    };
  }

  /**
   * Analyse par défaut quand l'IA n'est pas disponible
   * @param {Object} alertData - Données de l'alerte
   * @returns {Object} Analyse par défaut
   */
  static getDefaultAnalysis(alertData) {
    const keywords = this.extractKeywords(alertData.description);
    const priority = this.calculateDefaultPriority(keywords, alertData.media);
    
    return {
      classification: {
        predictedType: alertData.type || 'OTHER',
        confidence: 0.6,
        alternativeTypes: []
      },
      priority: {
        level: priority,
        score: 0.6,
        factors: ['keyword_analysis', 'media_presence']
      },
      mediaAnalysis: {
        hasImages: alertData.media?.some(m => m.mimeType.startsWith('image/')) || false,
        hasVideos: alertData.media?.some(m => m.mimeType.startsWith('video/')) || false,
        hasAudio: alertData.media?.some(m => m.mimeType.startsWith('audio/')) || false,
        imageAnalysis: null,
        videoAnalysis: null,
        audioAnalysis: null
      },
      textAnalysis: {
        sentiment: 'neutral',
        urgency: priority === 'HIGH' || priority === 'CRITICAL' ? 'high' : 'medium',
        keywords: keywords,
        entities: [],
        language: 'fr'
      },
      recommendations: {
        suggestedServices: this.getDefaultServices(alertData.type),
        estimatedResponseTime: priority === 'CRITICAL' ? 5 : 30,
        requiredResources: [],
        riskLevel: priority.toLowerCase()
      },
      analysis: {
        processingTime: 0,
        modelVersion: 'default',
        accuracy: 0.6,
        timestamp: new Date().toISOString()
      }
    };
  }

  /**
   * Extrait les mots-clés d'un texte
   * @param {string} text - Texte à analyser
   * @returns {Array} Mots-clés extraits
   */
  static extractKeywords(text) {
    const keywords = [];
    const urgentWords = ['urgence', 'urgent', 'grave', 'critique', 'danger', 'accident', 'incendie', 'sang', 'blessé'];
    const emergencyWords = ['pompiers', 'ambulance', 'police', 'hôpital', 'médecin', 'secours'];
    
    const words = text.toLowerCase().split(/\s+/);
    
    words.forEach(word => {
      if (urgentWords.includes(word)) keywords.push({ word, type: 'urgency', weight: 0.9 });
      if (emergencyWords.includes(word)) keywords.push({ word, type: 'service', weight: 0.7 });
    });
    
    return keywords;
  }

  /**
   * Calcule la priorité par défaut
   * @param {Array} keywords - Mots-clés extraits
   * @param {Array} media - Médias associés
   * @returns {string} Niveau de priorité
   */
  static calculateDefaultPriority(keywords, media) {
    const urgencyKeywords = keywords.filter(k => k.type === 'urgency');
    const hasMedia = media && media.length > 0;
    
    if (urgencyKeywords.length > 0 && hasMedia) return 'CRITICAL';
    if (urgencyKeywords.length > 0) return 'HIGH';
    if (hasMedia) return 'MEDIUM';
    return 'LOW';
  }

  /**
   * Détermine les services par défaut selon le type
   * @param {string} type - Type d'alerte
   * @returns {Array} Services suggérés
   */
  static getDefaultServices(type) {
    const serviceMap = {
      'ACCIDENT': ['POLICE', 'AMBULANCE'],
      'FIRE': ['FIRE_DEPARTMENT', 'AMBULANCE'],
      'MEDICAL_EMERGENCY': ['AMBULANCE', 'HOSPITAL'],
      'SECURITY_INCIDENT': ['POLICE'],
      'NATURAL_DISASTER': ['CIVIL_PROTECTION', 'FIRE_DEPARTMENT'],
      'OTHER': ['POLICE']
    };
    
    return serviceMap[type] || ['POLICE'];
  }

  /**
   * Détermine le type de média
   * @param {string} mimeType - Type MIME
   * @returns {string} Type de média
   */
  static getMediaType(mimeType) {
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('video/')) return 'video';
    if (mimeType.startsWith('audio/')) return 'audio';
    return 'unknown';
  }

  /**
   * Détermine la saison
   * @param {Date} date - Date à analyser
   * @returns {string} Saison
   */
  static getSeason(date) {
    const month = date.getMonth();
    if (month >= 2 && month <= 4) return 'spring';
    if (month >= 5 && month <= 7) return 'summer';
    if (month >= 8 && month <= 10) return 'autumn';
    return 'winter';
  }

  /**
   * Envoie une alerte aux services d'urgence
   * @param {Object} alertData - Données de l'alerte
   * @param {Object} analysis - Analyse IA
   * @returns {Promise<Object>} Résultat de l'envoi
   */
  static async sendToEmergencyServices(alertData, analysis) {
    try {
      const services = analysis.recommendations.suggestedServices;
      const results = [];

      for (const serviceType of services) {
        const service = await this.getEmergencyService(serviceType);
        if (service) {
          const result = await this.notifyService(service, alertData, analysis);
          results.push(result);
        }
      }

      return {
        success: true,
        servicesNotified: results.length,
        results: results
      };

    } catch (error) {
      console.error('Erreur lors de l\'envoi aux services d\'urgence:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Récupère les informations d'un service d'urgence
   * @param {string} serviceType - Type de service
   * @returns {Object} Informations du service
   */
  static async getEmergencyService(serviceType) {
    // Cette méthode devrait interroger la base de données
    // Pour l'instant, on utilise des valeurs par défaut
    const defaultServices = {
      'POLICE': { phone: '117', email: 'police@cameroun.gov' },
      'FIRE_DEPARTMENT': { phone: '118', email: 'pompiers@cameroun.gov' },
      'AMBULANCE': { phone: '119', email: 'ambulance@cameroun.gov' },
      'HOSPITAL': { phone: '119', email: 'hopital@cameroun.gov' },
      'CIVIL_PROTECTION': { phone: '118', email: 'protection@cameroun.gov' }
    };

    return defaultServices[serviceType] || null;
  }

  /**
   * Notifie un service d'urgence
   * @param {Object} service - Service à notifier
   * @param {Object} alertData - Données de l'alerte
   * @param {Object} analysis - Analyse IA
   * @returns {Promise<Object>} Résultat de la notification
   */
  static async notifyService(service, alertData, analysis) {
    try {
      const message = this.formatEmergencyMessage(alertData, analysis);
      
      // Envoi SMS (simulé)
      if (service.phone) {
        console.log(`SMS envoyé à ${service.phone}: ${message}`);
      }

      // Envoi email (simulé)
      if (service.email) {
        console.log(`Email envoyé à ${service.email}: ${message}`);
      }

      return {
        service: service,
        method: 'sms_email',
        status: 'sent',
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error('Erreur lors de la notification:', error);
      return {
        service: service,
        method: 'sms_email',
        status: 'failed',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Formate le message d'urgence
   * @param {Object} alertData - Données de l'alerte
   * @param {Object} analysis - Analyse IA
   * @returns {string} Message formaté
   */
  static formatEmergencyMessage(alertData, analysis) {
    return `
🚨 ALERTE URGENCE - ${analysis.classification.predictedType}
📍 Localisation: ${alertData.address || 'Coordonnées: ' + alertData.latitude + ', ' + alertData.longitude}
📝 Description: ${alertData.description}
⏰ Heure: ${new Date(alertData.createdAt).toLocaleString('fr-FR')}
🎯 Priorité: ${analysis.priority.level}
📊 Confiance IA: ${Math.round(analysis.classification.confidence * 100)}%
👤 Signalé par: ${alertData.user ? alertData.user.firstName + ' ' + alertData.user.lastName : 'Anonyme'}
📱 Contact: ${alertData.user?.phone || 'Non disponible'}
    `.trim();
  }

  /**
   * Envoie du feedback à l'IA pour amélioration
   * @param {string} alertId - ID de l'alerte
   * @param {Object} feedback - Données de feedback
   * @returns {Promise<Object>} Résultat de l'envoi
   */
  static async sendFeedback(alertId, feedback) {
    try {
      if (!config.ai.enabled) {
        console.log('Service IA désactivé, feedback non envoyé');
        return { success: false, reason: 'IA disabled' };
      }

      const response = await axios.post(
        `${config.ai.serviceUrl}/feedback`,
        {
          alertId,
          feedback
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.ai.apiKey}`
          },
          timeout: config.ai.timeout
        }
      );

      return {
        success: response.status === 200,
        status: response.status
      };

    } catch (error) {
      console.error('Erreur lors de l\'envoi du feedback:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = AIService;