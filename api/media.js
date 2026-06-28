const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;
const prisma = require('../lib/prisma');

const router = express.Router();

// Configuration du stockage Multer
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadPath = process.env.UPLOAD_PATH || './uploads';
    try {
      await fs.mkdir(uploadPath, { recursive: true });
      cb(null, uploadPath);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const extension = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + uniqueSuffix + extension);
  }
});

// Filtre des types de fichiers autorisés
const fileFilter = (req, file, cb) => {
  const allowedTypes = [
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
  ];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Type de fichier non autorisé'), false);
  }
};

// Configuration Multer
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024, // 10MB par défaut
    files: 5 // Maximum 5 fichiers par requête
  }
});

/**
 * @route POST /api/media/upload
 * @desc Upload de fichiers média
 * @access Public (pour les alertes anonymes)
 */
router.post('/upload', upload.array('media', 5), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        error: 'Aucun fichier fourni',
        code: 'NO_FILES'
      });
    }

    const uploadedFiles = [];

    for (const file of req.files) {
      try {
        // Traitement des images avec Sharp
        if (file.mimetype.startsWith('image/')) {
          const processedPath = path.join(
            path.dirname(file.path),
            'processed_' + path.basename(file.path)
          );

          await sharp(file.path)
            .resize(1920, 1080, { 
              fit: 'inside',
              withoutEnlargement: true 
            })
            .jpeg({ quality: 85 })
            .toFile(processedPath);

          // Suppression du fichier original
          await fs.unlink(file.path);
          
          // Renommage du fichier traité
          await fs.rename(processedPath, file.path);
        }

        // Génération de l'URL publique
        const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
        const publicUrl = `${baseUrl}/uploads/${path.basename(file.path)}`;

        uploadedFiles.push({
          filename: file.filename,
          originalName: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
          path: file.path,
          url: publicUrl
        });
      } catch (error) {
        console.error('Erreur lors du traitement du fichier:', error);
        // Suppression du fichier en cas d'erreur
        try {
          await fs.unlink(file.path);
        } catch (unlinkError) {
          console.error('Erreur lors de la suppression du fichier:', unlinkError);
        }
      }
    }

    res.status(201).json({
      message: 'Fichiers uploadés avec succès',
      files: uploadedFiles
    });
  } catch (error) {
    console.error('Erreur lors de l\'upload:', error);
    res.status(500).json({
      error: 'Erreur interne du serveur',
      code: 'INTERNAL_ERROR'
    });
  }
});

/**
 * @route POST /api/media/upload/:alertId
 * @desc Upload de fichiers média pour une alerte spécifique
 * @access Private
 */
router.post('/upload/:alertId', upload.array('media', 5), async (req, res) => {
  try {
    const { alertId } = req.params;

    // Vérification que l'alerte existe
    const alert = await prisma.alert.findUnique({
      where: { id: alertId },
      select: { id: true, userId: true }
    });

    if (!alert) {
      return res.status(404).json({
        error: 'Alerte non trouvée',
        code: 'ALERT_NOT_FOUND'
      });
    }

    // Vérification des permissions
    if (req.user.role === 'USER' && alert.userId !== req.user.id) {
      return res.status(403).json({
        error: 'Accès non autorisé à cette alerte',
        code: 'ALERT_ACCESS_DENIED'
      });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        error: 'Aucun fichier fourni',
        code: 'NO_FILES'
      });
    }

    const uploadedMedia = [];

    for (const file of req.files) {
      try {
        // Traitement des images avec Sharp
        if (file.mimetype.startsWith('image/')) {
          const processedPath = path.join(
            path.dirname(file.path),
            'processed_' + path.basename(file.path)
          );

          await sharp(file.path)
            .resize(1920, 1080, { 
              fit: 'inside',
              withoutEnlargement: true 
            })
            .jpeg({ quality: 85 })
            .toFile(processedPath);

          // Suppression du fichier original
          await fs.unlink(file.path);
          
          // Renommage du fichier traité
          await fs.rename(processedPath, file.path);
        }

        // Génération de l'URL publique
        const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
        const publicUrl = `${baseUrl}/uploads/${path.basename(file.path)}`;

        // Sauvegarde en base de données
        const media = await prisma.media.create({
          data: {
            filename: file.filename,
            originalName: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
            path: file.path,
            url: publicUrl,
            alertId
          }
        });

        uploadedMedia.push(media);
      } catch (error) {
        console.error('Erreur lors du traitement du fichier:', error);
        // Suppression du fichier en cas d'erreur
        try {
          await fs.unlink(file.path);
        } catch (unlinkError) {
          console.error('Erreur lors de la suppression du fichier:', unlinkError);
        }
      }
    }

    res.status(201).json({
      message: 'Fichiers uploadés avec succès',
      media: uploadedMedia
    });
  } catch (error) {
    console.error('Erreur lors de l\'upload:', error);
    res.status(500).json({
      error: 'Erreur interne du serveur',
      code: 'INTERNAL_ERROR'
    });
  }
});

/**
 * @route GET /api/media/:id
 * @desc Récupération d'un fichier média
 * @access Private
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const media = await prisma.media.findUnique({
      where: { id },
      include: {
        alert: {
          select: {
            id: true,
            userId: true,
            title: true
          }
        }
      }
    });

    if (!media) {
      return res.status(404).json({
        error: 'Fichier média non trouvé',
        code: 'MEDIA_NOT_FOUND'
      });
    }

    // Vérification des permissions
    if (req.user.role === 'USER' && media.alert.userId !== req.user.id) {
      return res.status(403).json({
        error: 'Accès non autorisé à ce fichier',
        code: 'MEDIA_ACCESS_DENIED'
      });
    }

    res.json({ media });
  } catch (error) {
    console.error('Erreur lors de la récupération du fichier:', error);
    res.status(500).json({
      error: 'Erreur interne du serveur',
      code: 'INTERNAL_ERROR'
    });
  }
});

/**
 * @route GET /api/media/file/:filename
 * @desc Servir un fichier média
 * @access Public
 */
router.get('/file/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const uploadPath = process.env.UPLOAD_PATH || './uploads';
    const filePath = path.join(uploadPath, filename);

    // Vérification que le fichier existe
    try {
      await fs.access(filePath);
    } catch (error) {
      return res.status(404).json({
        error: 'Fichier non trouvé',
        code: 'FILE_NOT_FOUND'
      });
    }

    // Détermination du type MIME
    const ext = path.extname(filename).toLowerCase();
    const mimeTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.mp4': 'video/mp4',
      '.mov': 'video/quicktime',
      '.avi': 'video/x-msvideo',
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.m4a': 'audio/mp4'
    };

    const mimeType = mimeTypes[ext] || 'application/octet-stream';

    // Configuration des headers
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache 1 an

    // Envoi du fichier
    res.sendFile(path.resolve(filePath));
  } catch (error) {
    console.error('Erreur lors du service du fichier:', error);
    res.status(500).json({
      error: 'Erreur interne du serveur',
      code: 'INTERNAL_ERROR'
    });
  }
});

/**
 * @route DELETE /api/media/:id
 * @desc Suppression d'un fichier média
 * @access Private
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const media = await prisma.media.findUnique({
      where: { id },
      include: {
        alert: {
          select: {
            id: true,
            userId: true
          }
        }
      }
    });

    if (!media) {
      return res.status(404).json({
        error: 'Fichier média non trouvé',
        code: 'MEDIA_NOT_FOUND'
      });
    }

    // Vérification des permissions
    if (req.user.role === 'USER' && media.alert.userId !== req.user.id) {
      return res.status(403).json({
        error: 'Accès non autorisé à ce fichier',
        code: 'MEDIA_ACCESS_DENIED'
      });
    }

    // Suppression du fichier physique
    try {
      await fs.unlink(media.path);
    } catch (error) {
      console.error('Erreur lors de la suppression du fichier physique:', error);
    }

    // Suppression de l'enregistrement en base de données
    await prisma.media.delete({
      where: { id }
    });

    res.json({
      message: 'Fichier supprimé avec succès'
    });
  } catch (error) {
    console.error('Erreur lors de la suppression du fichier:', error);
    res.status(500).json({
      error: 'Erreur interne du serveur',
      code: 'INTERNAL_ERROR'
    });
  }
});

/**
 * @route GET /api/media/alert/:alertId
 * @desc Récupération des fichiers média d'une alerte
 * @access Private
 */
router.get('/alert/:alertId', async (req, res) => {
  try {
    const { alertId } = req.params;

    // Vérification que l'alerte existe
    const alert = await prisma.alert.findUnique({
      where: { id: alertId },
      select: { id: true, userId: true }
    });

    if (!alert) {
      return res.status(404).json({
        error: 'Alerte non trouvée',
        code: 'ALERT_NOT_FOUND'
      });
    }

    // Vérification des permissions
    if (req.user.role === 'USER' && alert.userId !== req.user.id) {
      return res.status(403).json({
        error: 'Accès non autorisé à cette alerte',
        code: 'ALERT_ACCESS_DENIED'
      });
    }

    const media = await prisma.media.findMany({
      where: { alertId },
      orderBy: { createdAt: 'asc' }
    });

    res.json({ media });
  } catch (error) {
    console.error('Erreur lors de la récupération des fichiers:', error);
    res.status(500).json({
      error: 'Erreur interne du serveur',
      code: 'INTERNAL_ERROR'
    });
  }
});

module.exports = router;


