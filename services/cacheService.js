const Redis = require('ioredis');
const config = require('../config/config');

class CacheService {
  constructor() {
    // Disable Redis entirely to prevent connection issues
    this.redis = null;
    console.log('Redis disabled - running without cache');

    // Configuration des TTL par défaut
    this.defaultTTL = {
      analysis: 3600, // 1 heure
      user: 1800, // 30 minutes
      alert: 7200, // 2 heures
      media: 86400, // 24 heures
      stats: 300, // 5 minutes
      session: 86400 // 24 heures
    };
  }

  /**
   * Génère une clé de cache
   * @param {string} type - Type de données
   * @param {string} id - Identifiant
   * @param {Object} params - Paramètres additionnels
   * @returns {string} Clé de cache
   */
  generateKey(type, id, params = {}) {
    const paramString = Object.keys(params).length > 0 
      ? `:${Object.entries(params).map(([k, v]) => `${k}=${v}`).join(':')}`
      : '';
    return `${type}:${id}${paramString}`;
  }

  /**
   * Met en cache une analyse IA
   * @param {string} alertId - ID de l'alerte
   * @param {Object} analysis - Résultats de l'analyse
   * @param {number} ttl - TTL en secondes
   * @returns {Promise<boolean>} Succès de l'opération
   */
  async cacheAnalysis(alertId, analysis, ttl = this.defaultTTL.analysis) {
    try {
      if (!this.redis) {
        console.log('Redis not available - skipping cache');
        return false;
      }
      const key = this.generateKey('analysis', alertId);
      await this.redis.setex(key, ttl, JSON.stringify(analysis));
      console.log(`Analyse mise en cache: ${key}`);
      return true;
    } catch (error) {
      console.error('Erreur lors de la mise en cache de l\'analyse:', error);
      return false;
    }
  }

  /**
   * Récupère une analyse IA du cache
   * @param {string} alertId - ID de l'alerte
   * @returns {Promise<Object|null>} Analyse mise en cache
   */
  async getAnalysis(alertId) {
    try {
      if (!this.redis) {
        console.log('Redis not available - skipping cache retrieval');
        return null;
      }
      const key = this.generateKey('analysis', alertId);
      const cached = await this.redis.get(key);
      
      if (cached) {
        console.log(`Analyse récupérée du cache: ${key}`);
        return JSON.parse(cached);
      }
      
      return null;
    } catch (error) {
      console.error('Erreur lors de la récupération de l\'analyse:', error);
      return null;
    }
  }

  /**
   * Met en cache les données d'un utilisateur
   * @param {string} userId - ID de l'utilisateur
   * @param {Object} userData - Données de l'utilisateur
   * @param {number} ttl - TTL en secondes
   * @returns {Promise<boolean>} Succès de l'opération
   */
  async cacheUser(userId, userData, ttl = this.defaultTTL.user) {
    try {
      const key = this.generateKey('user', userId);
      await this.redis.setex(key, ttl, JSON.stringify(userData));
      console.log(`Utilisateur mis en cache: ${key}`);
      return true;
    } catch (error) {
      console.error('Erreur lors de la mise en cache de l\'utilisateur:', error);
      return false;
    }
  }

  /**
   * Récupère les données d'un utilisateur du cache
   * @param {string} userId - ID de l'utilisateur
   * @returns {Promise<Object|null>} Données utilisateur
   */
  async getUser(userId) {
    try {
      const key = this.generateKey('user', userId);
      const cached = await this.redis.get(key);
      
      if (cached) {
        console.log(`Utilisateur récupéré du cache: ${key}`);
        return JSON.parse(cached);
      }
      
      return null;
    } catch (error) {
      console.error('Erreur lors de la récupération de l\'utilisateur:', error);
      return null;
    }
  }

  /**
   * Met en cache une alerte
   * @param {string} alertId - ID de l'alerte
   * @param {Object} alertData - Données de l'alerte
   * @param {number} ttl - TTL en secondes
   * @returns {Promise<boolean>} Succès de l'opération
   */
  async cacheAlert(alertId, alertData, ttl = this.defaultTTL.alert) {
    try {
      const key = this.generateKey('alert', alertId);
      await this.redis.setex(key, ttl, JSON.stringify(alertData));
      console.log(`Alerte mise en cache: ${key}`);
      return true;
    } catch (error) {
      console.error('Erreur lors de la mise en cache de l\'alerte:', error);
      return false;
    }
  }

  /**
   * Récupère une alerte du cache
   * @param {string} alertId - ID de l'alerte
   * @returns {Promise<Object|null>} Données de l'alerte
   */
  async getAlert(alertId) {
    try {
      const key = this.generateKey('alert', alertId);
      const cached = await this.redis.get(key);
      
      if (cached) {
        console.log(`Alerte récupérée du cache: ${key}`);
        return JSON.parse(cached);
      }
      
      return null;
    } catch (error) {
      console.error('Erreur lors de la récupération de l\'alerte:', error);
      return null;
    }
  }

  /**
   * Met en cache les statistiques
   * @param {string} type - Type de statistiques
   * @param {Object} stats - Données statistiques
   * @param {number} ttl - TTL en secondes
   * @returns {Promise<boolean>} Succès de l'opération
   */
  async cacheStats(type, stats, ttl = this.defaultTTL.stats) {
    try {
      const key = this.generateKey('stats', type);
      await this.redis.setex(key, ttl, JSON.stringify(stats));
      console.log(`Statistiques mises en cache: ${key}`);
      return true;
    } catch (error) {
      console.error('Erreur lors de la mise en cache des statistiques:', error);
      return false;
    }
  }

  /**
   * Récupère les statistiques du cache
   * @param {string} type - Type de statistiques
   * @returns {Promise<Object|null>} Données statistiques
   */
  async getStats(type) {
    try {
      const key = this.generateKey('stats', type);
      const cached = await this.redis.get(key);
      
      if (cached) {
        console.log(`Statistiques récupérées du cache: ${key}`);
        return JSON.parse(cached);
      }
      
      return null;
    } catch (error) {
      console.error('Erreur lors de la récupération des statistiques:', error);
      return null;
    }
  }

  /**
   * Met en cache une session utilisateur
   * @param {string} sessionId - ID de la session
   * @param {Object} sessionData - Données de la session
   * @param {number} ttl - TTL en secondes
   * @returns {Promise<boolean>} Succès de l'opération
   */
  async cacheSession(sessionId, sessionData, ttl = this.defaultTTL.session) {
    try {
      const key = this.generateKey('session', sessionId);
      await this.redis.setex(key, ttl, JSON.stringify(sessionData));
      console.log(`Session mise en cache: ${key}`);
      return true;
    } catch (error) {
      console.error('Erreur lors de la mise en cache de la session:', error);
      return false;
    }
  }

  /**
   * Récupère une session du cache
   * @param {string} sessionId - ID de la session
   * @returns {Promise<Object|null>} Données de la session
   */
  async getSession(sessionId) {
    try {
      const key = this.generateKey('session', sessionId);
      const cached = await this.redis.get(key);
      
      if (cached) {
        console.log(`Session récupérée du cache: ${key}`);
        return JSON.parse(cached);
      }
      
      return null;
    } catch (error) {
      console.error('Erreur lors de la récupération de la session:', error);
      return null;
    }
  }

  /**
   * Invalide le cache pour un type et un ID
   * @param {string} type - Type de données
   * @param {string} id - Identifiant
   * @returns {Promise<boolean>} Succès de l'opération
   */
  async invalidate(type, id) {
    try {
      const key = this.generateKey(type, id);
      const result = await this.redis.del(key);
      console.log(`Cache invalidé: ${key}`);
      return result > 0;
    } catch (error) {
      console.error('Erreur lors de l\'invalidation du cache:', error);
      return false;
    }
  }

  /**
   * Invalide le cache pour un pattern
   * @param {string} pattern - Pattern de clés à invalider
   * @returns {Promise<number>} Nombre de clés supprimées
   */
  async invalidatePattern(pattern) {
    try {
      const keys = await this.redis.keys(pattern);
      if (keys.length > 0) {
        const result = await this.redis.del(...keys);
        console.log(`Cache invalidé pour le pattern ${pattern}: ${result} clés supprimées`);
        return result;
      }
      return 0;
    } catch (error) {
      console.error('Erreur lors de l\'invalidation du cache par pattern:', error);
      return 0;
    }
  }

  /**
   * Met en cache avec un TTL personnalisé
   * @param {string} key - Clé de cache
   * @param {Object} data - Données à mettre en cache
   * @param {number} ttl - TTL en secondes
   * @returns {Promise<boolean>} Succès de l'opération
   */
  async set(key, data, ttl = 3600) {
    try {
      if (!this.redis) {
        console.log('Redis not available - skipping cache set');
        return false;
      }
      await this.redis.setex(key, ttl, JSON.stringify(data));
      console.log(`Données mises en cache: ${key} (TTL: ${ttl}s)`);
      return true;
    } catch (error) {
      console.error('Erreur lors de la mise en cache:', error);
      return false;
    }
  }

  /**
   * Récupère des données du cache
   * @param {string} key - Clé de cache
   * @returns {Promise<Object|null>} Données mises en cache
   */
  async get(key) {
    try {
      const cached = await this.redis.get(key);
      if (cached) {
        console.log(`Données récupérées du cache: ${key}`);
        return JSON.parse(cached);
      }
      return null;
    } catch (error) {
      console.error('Erreur lors de la récupération du cache:', error);
      return null;
    }
  }

  /**
   * Vérifie si une clé existe dans le cache
   * @param {string} key - Clé de cache
   * @returns {Promise<boolean>} Existence de la clé
   */
  async exists(key) {
    try {
      const result = await this.redis.exists(key);
      return result === 1;
    } catch (error) {
      console.error('Erreur lors de la vérification de l\'existence de la clé:', error);
      return false;
    }
  }

  /**
   * Obtient le TTL d'une clé
   * @param {string} key - Clé de cache
   * @returns {Promise<number>} TTL en secondes
   */
  async getTTL(key) {
    try {
      return await this.redis.ttl(key);
    } catch (error) {
      console.error('Erreur lors de la récupération du TTL:', error);
      return -1;
    }
  }

  /**
   * Obtient les statistiques du cache
   * @returns {Promise<Object>} Statistiques du cache
   */
  async getCacheStats() {
    try {
      const info = await this.redis.info('memory');
      const keyspace = await this.redis.info('keyspace');
      
      return {
        memory: this.parseRedisInfo(info),
        keyspace: this.parseRedisInfo(keyspace),
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Erreur lors de la récupération des statistiques du cache:', error);
      return null;
    }
  }

  /**
   * Parse les informations Redis
   * @param {string} info - Informations Redis
   * @returns {Object} Informations parsées
   */
  parseRedisInfo(info) {
    const lines = info.split('\r\n');
    const result = {};
    
    lines.forEach(line => {
      if (line.includes(':')) {
        const [key, value] = line.split(':');
        result[key] = isNaN(value) ? value : Number(value);
      }
    });
    
    return result;
  }

  /**
   * Nettoie le cache
   * @param {string} pattern - Pattern de clés à nettoyer
   * @returns {Promise<number>} Nombre de clés supprimées
   */
  async cleanCache(pattern = 'securite:*') {
    try {
      const keys = await this.redis.keys(pattern);
      if (keys.length > 0) {
        const result = await this.redis.del(...keys);
        console.log(`Cache nettoyé: ${result} clés supprimées`);
        return result;
      }
      return 0;
    } catch (error) {
      console.error('Erreur lors du nettoyage du cache:', error);
      return 0;
    }
  }

  /**
   * Ferme la connexion Redis
   */
  async close() {
    try {
      await this.redis.quit();
      console.log('Connexion Redis fermée');
    } catch (error) {
      console.error('Erreur lors de la fermeture de Redis:', error);
    }
  }
}

module.exports = CacheService;











