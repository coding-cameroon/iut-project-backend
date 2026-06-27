const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const slowDown = require("express-slow-down");
const path = require("path");
require("dotenv").config();

const { createServer } = require("http");
const { Server } = require("socket.io");

// Import des routes
const authRoutes = require("./api/auth");
const userRoutes = require("./api/users");
const alertRoutes = require("./api/alerts");
const mediaRoutes = require("./api/media");
const dashboardRoutes = require("./api/dashboard");
const aiRoutes = require("./api/ai");
const monitoringRoutes = require("./api/monitoring");
const emergencyServicesRoutes = require("./api/emergencyServices");
const alertTypeRoutes = require("./api/alertTypes");
const routingRoutes = require("./api/routing");

// Import du middleware d'authentification
const { authMiddleware } = require("./middleware/auth");

// Import de la configuration de la base de données
const { PrismaClient } = require("@prisma/client");

// Import des services
const QueueService = require("./services/queueService");
const MonitoringService = require("./services/monitoringService");

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: function (origin, callback) {
      // Allow requests with no origin
      if (!origin) return callback(null, true);

      // Allow all localhost origins and development origins
      const allowedOrigins = [
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:3005",
        "http://localhost:5175",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001",
        "http://127.0.0.1:3005",
        "http://127.0.0.1:5175",
        "https://iut-project-backend.onrender.com",
      ];

      if (process.env.SOCKET_IO_CORS_ORIGIN) {
        const envOrigins = process.env.SOCKET_IO_CORS_ORIGIN.split(",");
        allowedOrigins.push(...envOrigins);
      }

      if (
        allowedOrigins.includes(origin) ||
        origin.startsWith("http://localhost") ||
        origin.startsWith("http://127.0.0.1")
      ) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST"],
    credentials: true,
  },
});

const prisma = new PrismaClient();

// Configuration du port
const PORT = process.env.PORT || 3000;

// Middleware de sécurité
app.use(helmet());
app.use(compression());

// Configuration CORS
app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);

      // Allow all localhost origins and development origins
      const allowedOrigins = [
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:3005",
        "http://localhost:5175",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001",
        "http://127.0.0.1:3005",
        "http://127.0.0.1:5175",
      ];

      if (process.env.CORS_ORIGIN) {
        const envOrigins = process.env.CORS_ORIGIN.split(",");
        allowedOrigins.push(...envOrigins);
      }

      if (
        allowedOrigins.includes(origin) ||
        origin.startsWith("http://localhost") ||
        origin.startsWith("http://127.0.0.1")
      ) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  }),
);

// Middleware de logging
app.use(morgan("combined"));

// Middleware de parsing
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Servir les fichiers statiques (uploads)
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100, // limite de 100 requêtes par fenêtre
  message: {
    error: "Trop de requêtes depuis cette IP, veuillez réessayer plus tard.",
  },
});

// Slow down pour les requêtes répétées
const speedLimiter = slowDown({
  windowMs: 15 * 60 * 1000, // 15 minutes
  delayAfter: 50, // commencer à ralentir après 50 requêtes
  delayMs: () => 500, // ralentir de 500ms par requête supplémentaire (v2 syntax)
});

app.use("/api/", limiter);
app.use("/api/", speedLimiter);

// Routes publiques
app.use("/api/auth", authRoutes);
app.use("/api/media", mediaRoutes);

// Routes protégées
app.use("/api/users", authMiddleware, userRoutes);
app.use("/api/alerts", authMiddleware, alertRoutes);
app.use("/api/dashboard", authMiddleware, dashboardRoutes);
app.use("/api/ai", authMiddleware, aiRoutes);
app.use("/api/monitoring", authMiddleware, monitoringRoutes);
app.use("/api/emergency-services", authMiddleware, emergencyServicesRoutes);
app.use("/api/alert-types", authMiddleware, alertTypeRoutes);
app.use("/api/routing", authMiddleware, routingRoutes);

// Route de santé
app.get("/api/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || "development",
  });
});

// Route racine
app.get("/", (req, res) => {
  res.json({
    message: "API Sécurité Temps Réel",
    version: "1.0.0",
    documentation: "/docs",
  });
});

// Gestion des erreurs 404
app.use("*", (req, res) => {
  res.status(404).json({
    error: "Route non trouvée",
    path: req.originalUrl,
    method: req.method,
  });
});

// Middleware de gestion d'erreurs global
app.use((err, req, res, next) => {
  console.error("Erreur:", err);

  // Erreur de validation
  if (err.name === "ValidationError") {
    return res.status(400).json({
      error: "Données invalides",
      details: err.message,
    });
  }

  // Erreur JWT
  if (err.name === "JsonWebTokenError") {
    return res.status(401).json({
      error: "Token invalide",
    });
  }

  // Erreur Prisma
  if (err.code && err.code.startsWith("P")) {
    return res.status(400).json({
      error: "Erreur de base de données",
      details:
        process.env.NODE_ENV === "development" ? err.message : "Erreur interne",
    });
  }

  // Erreur par défaut
  res.status(err.status || 500).json({
    error:
      process.env.NODE_ENV === "development"
        ? err.message
        : "Erreur interne du serveur",
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
});

// Configuration Socket.IO
io.on("connection", (socket) => {
  console.log("Nouvelle connexion Socket.IO:", socket.id);

  // Rejoindre une salle pour les alertes
  socket.on("join-alerts", (userId) => {
    socket.join(`user-${userId}`);
    console.log(`Utilisateur ${userId} a rejoint la salle des alertes`);
  });

  // Rejoindre une salle pour les gestionnaires
  socket.on("join-managers", (managerId) => {
    socket.join(`manager-${managerId}`);
    console.log(
      `Gestionnaire ${managerId} a rejoint la salle des gestionnaires`,
    );
  });

  // Déconnexion
  socket.on("disconnect", () => {
    console.log("Déconnexion Socket.IO:", socket.id);
  });
});

// Export de l'instance Socket.IO pour utilisation dans les routes
app.set("io", io);

// Fonction de démarrage du serveur
async function startServer() {
  try {
    // Test de connexion à la base de données
    await prisma.$connect();
    console.log("✅ Connexion à la base de données établie");

    // Initialisation des services
    QueueService.initializeProcessors();
    console.log("✅ Processeurs de queues initialisés");

    const monitoringService = new MonitoringService();
    monitoringService.startAutoMonitoring();
    console.log("✅ Monitoring automatique démarré");

    // Démarrage du serveur
    server.listen(PORT, "0.0.0.0", () => {
      console.log(`🚀 Serveur démarré sur le port ${PORT}`);
      console.log(`📊 Environnement: ${process.env.NODE_ENV || "development"}`);
      console.log(`🔗 API disponible sur: http://localhost:${PORT}`);
      console.log(
        `📈 Monitoring: http://localhost:${PORT}/api/monitoring/health`,
      );
    });
  } catch (error) {
    console.error("❌ Erreur lors du démarrage du serveur:", error);
    process.exit(1);
  }
}

// Gestion des signaux de fermeture
process.on("SIGTERM", async () => {
  console.log("🛑 Signal SIGTERM reçu, fermeture gracieuse...");
  await QueueService.shutdown();
  await prisma.$disconnect();
  server.close(() => {
    console.log("✅ Serveur fermé");
    process.exit(0);
  });
});

process.on("SIGINT", async () => {
  console.log("🛑 Signal SIGINT reçu, fermeture gracieuse...");
  await QueueService.shutdown();
  await prisma.$disconnect();
  server.close(() => {
    console.log("✅ Serveur fermé");
    process.exit(0);
  });
});

// Démarrage du serveur
startServer();

module.exports = { app, server, io };
