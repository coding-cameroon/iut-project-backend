const dotenv = require('dotenv');

// Chargement des variables d'environnement
dotenv.config();

const config = {
  // Configuration du serveur
  server: {
    port: process.env.PORT || 3000,
    host: process.env.HOST || 'localhost',
    environment: process.env.NODE_ENV || 'development'
  },

  // Configuration de la base de données
  database: {
    url: process.env.DATABASE_URL,
    maxConnections: parseInt(process.env.DB_MAX_CONNECTIONS) || 10,
    connectionTimeout: parseInt(process.env.DB_CONNECTION_TIMEOUT) || 30000
  },

  // Configuration JWT
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d'
  },

  // Configuration CORS
  cors: {
    origin: process.env.CORS_ORIGIN?.split(',') || [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:19006' // Expo
    ],
    credentials: true
  },

  // Configuration Socket.IO
  socketio: {
    cors: {
      origin: process.env.SOCKET_IO_CORS_ORIGIN?.split(',') || [
        'http://localhost:3000',
        'http://localhost:3001',
        'http://localhost:19006'
      ],
      methods: ['GET', 'POST']
    }
  },

  // Configuration de l'upload de fichiers
  upload: {
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024, // 10MB
    uploadPath: process.env.UPLOAD_PATH || './uploads',
    allowedMimeTypes: [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'video/mp4',
      'video/quicktime',
      'video/x-msvideo',
      'audio/mpeg',
      'audio/wav',
      'audio/mp4'
    ],
    maxFiles: parseInt(process.env.MAX_FILES) || 5
  },

  // Configuration email
  email: {
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    },
    from: process.env.SMTP_FROM || 'noreply@securite-temps-reel.com'
  },

  // Configuration SMS
  sms: {
    apiKey: process.env.SMS_API_KEY,
    sender: process.env.SMS_SENDER || 'SecuriteTR',
    provider: process.env.SMS_PROVIDER || 'twilio'
  },

  // Configuration géolocalisation
  geolocation: {
    defaultLatitude: parseFloat(process.env.DEFAULT_LATITUDE) || 4.0511, // Douala
    defaultLongitude: parseFloat(process.env.DEFAULT_LONGITUDE) || 9.7679,
    defaultRadius: parseInt(process.env.DEFAULT_RADIUS) || 10000, // 10km
    maxRadius: parseInt(process.env.MAX_RADIUS) || 50000 // 50km
  },

  // Configuration de sécurité
  security: {
    bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS) || 12,
    rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
    rateLimitMaxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
    sessionTimeout: parseInt(process.env.SESSION_TIMEOUT) || 24 * 60 * 60 * 1000, // 24 heures
    maxLoginAttempts: parseInt(process.env.MAX_LOGIN_ATTEMPTS) || 5,
    lockoutDuration: parseInt(process.env.LOCKOUT_DURATION) || 15 * 60 * 1000 // 15 minutes
  },

  // Configuration IA (pour intégration future)
  ai: {
    serviceUrl: process.env.AI_SERVICE_URL || 'http://localhost:5000',
    apiKey: process.env.AI_API_KEY,
    timeout: parseInt(process.env.AI_TIMEOUT) || 30000,
    enabled: process.env.AI_ENABLED === 'true'
  },

  // Configuration des services d'urgence
  emergencyServices: {
    police: {
      phone: process.env.POLICE_PHONE || '117',
      email: process.env.POLICE_EMAIL
    },
    fire: {
      phone: process.env.FIRE_PHONE || '118',
      email: process.env.FIRE_EMAIL
    },
    medical: {
      phone: process.env.MEDICAL_PHONE || '119',
      email: process.env.MEDICAL_EMAIL
    }
  },

  // Configuration des logs
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    format: process.env.LOG_FORMAT || 'combined',
    file: process.env.LOG_FILE || './logs/app.log'
  },

  // Configuration de la base URL
  baseUrl: process.env.BASE_URL || 'http://localhost:3000',

  // Configuration des notifications push
  pushNotifications: {
    enabled: process.env.PUSH_NOTIFICATIONS_ENABLED === 'true',
    vapidKeys: {
      publicKey: process.env.VAPID_PUBLIC_KEY,
      privateKey: process.env.VAPID_PRIVATE_KEY
    }
  }
};

// Validation des configurations critiques
const validateConfig = () => {
  const required = [
    'DATABASE_URL',
    'JWT_SECRET'
  ];

  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(`Variables d'environnement manquantes: ${missing.join(', ')}`);
  }

  // Validation de la configuration de la base de données
  if (!config.database.url) {
    throw new Error('URL de base de données non configurée');
  }

  // Validation du secret JWT
  if (!config.jwt.secret || config.jwt.secret.length < 32) {
    throw new Error('JWT_SECRET doit contenir au moins 32 caractères');
  }
};

// Validation au démarrage
if (config.server.environment !== 'test') {
  validateConfig();
}

module.exports = config;


