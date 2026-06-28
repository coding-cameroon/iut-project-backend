const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const prisma = require('../lib/prisma');
const { requireAdmin, requireOwnershipOrRole } = require('../middleware/auth');

const router = express.Router();

/**
 * @route GET /api/users
 * @desc Récupération de la liste des utilisateurs
 * @access Private (Admin/Manager)
 */
router.get('/', requireAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 10, search, role, isActive } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Construction des filtres
    const where = {};
    
    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } }
      ];
    }
    
    if (role) {
      where.role = role;
    }
    
    if (isActive !== undefined) {
      where.isActive = isActive === 'true';
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          phone: true,
          role: true,
          isActive: true,
          createdAt: true,
          updatedAt: true
        },
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' }
      }),
      prisma.user.count({ where })
    ]);

    res.json({
      users,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Erreur lors de la récupération des utilisateurs:', error);
    res.status(500).json({
      error: 'Erreur interne du serveur',
      code: 'INTERNAL_ERROR'
    });
  }
});

/**
 * @route POST /api/users
 * @desc Création d'un nouvel utilisateur (Admin/Manager/User) par un Super Admin
 * @access Private (Super Admin)
 */
router.post('/', [
  body('email').isEmail().normalizeEmail().withMessage('Email invalide'),
  body('password').isLength({ min: 6 }).withMessage('Le mot de passe doit contenir au moins 6 caractères'),
  body('firstName').trim().notEmpty().withMessage('Le prénom est requis'),
  body('lastName').trim().notEmpty().withMessage('Le nom est requis'),
  body('phone').optional().isMobilePhone().withMessage('Numéro de téléphone invalide'),
  body('role').optional().isIn(['USER', 'MANAGER', 'ADMIN', 'SUPER_ADMIN']).withMessage('Rôle invalide'),
  body('isActive').optional().isBoolean().withMessage('isActive doit être un booléen'),
  body('emergencyServiceId').optional().isString()
], requireAdmin, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Données invalides',
        details: errors.array()
      });
    }

    // Seul un Super Admin peut créer des admins ou managers
    const { role } = req.body;
    if ((role === 'ADMIN' || role === 'SUPER_ADMIN' || role === 'MANAGER') && req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({
        error: 'Permissions insuffisantes pour créer ce type d\'utilisateur',
        code: 'INSUFFICIENT_PERMISSIONS'
      });
    }

    const { email, password, firstName, lastName, phone, isActive = true, emergencyServiceId } = req.body;

    // Vérification unicité email
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(409).json({
        error: 'Cet email est déjà utilisé',
        code: 'EMAIL_EXISTS'
      });
    }

    // Vérification unicité téléphone
    if (phone) {
      const existingPhone = await prisma.user.findUnique({ where: { phone } });
      if (existingPhone) {
        return res.status(409).json({
          error: 'Ce numéro de téléphone est déjà utilisé',
          code: 'PHONE_EXISTS'
        });
      }
    }

    // Vérification service d'urgence si fourni
    if (emergencyServiceId) {
      const service = await prisma.emergencyService.findUnique({ where: { id: emergencyServiceId } });
      if (!service) {
        return res.status(404).json({
          error: 'Service d\'urgence non trouvé',
          code: 'SERVICE_NOT_FOUND'
        });
      }
    }

    // Hachage du mot de passe
    const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Création de l'utilisateur
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        firstName,
        lastName,
        phone,
        role: role || 'USER',
        isActive,
        emergencyServiceId
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
        isActive: true,
        createdAt: true,
        emergencyServiceId: true
      }
    });

    res.status(201).json({
      message: 'Utilisateur créé avec succès',
      user
    });

  } catch (error) {
    console.error('Erreur lors de la création de l\'utilisateur:', error);
    res.status(500).json({
      error: 'Erreur interne du serveur',
      code: 'INTERNAL_ERROR'
    });
  }
});

/**
 * @route GET /api/users/:id
 * @desc Récupération d'un utilisateur par ID
 * @access Private
 */
router.get('/:id', requireOwnershipOrRole(['ADMIN', 'SUPER_ADMIN']), async (req, res) => {
  try {
    const { id } = req.params;

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true
      }
    });

    if (!user) {
      return res.status(404).json({
        error: 'Utilisateur non trouvé',
        code: 'USER_NOT_FOUND'
      });
    }

    res.json({ user });
  } catch (error) {
    console.error('Erreur lors de la récupération de l\'utilisateur:', error);
    res.status(500).json({
      error: 'Erreur interne du serveur',
      code: 'INTERNAL_ERROR'
    });
  }
});

/**
 * @route PUT /api/users/:id
 * @desc Mise à jour d'un utilisateur
 * @access Private
 */
router.put('/:id', [
  body('firstName').optional().trim().notEmpty().withMessage('Le prénom ne peut pas être vide'),
  body('lastName').optional().trim().notEmpty().withMessage('Le nom ne peut pas être vide'),
  body('phone').optional().isMobilePhone().withMessage('Numéro de téléphone invalide'),
  body('role').optional().isIn(['USER', 'MANAGER', 'ADMIN', 'SUPER_ADMIN']).withMessage('Rôle invalide'),
  body('isActive').optional().isBoolean().withMessage('isActive doit être un booléen')
], requireOwnershipOrRole(['ADMIN', 'SUPER_ADMIN']), async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Données invalides',
        details: errors.array()
      });
    }

    const { id } = req.params;
    const { firstName, lastName, phone, role, isActive, emergencyServiceId } = req.body;

    // Vérification que l'utilisateur existe
    const existingUser = await prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true }
    });

    if (!existingUser) {
      return res.status(404).json({
        error: 'Utilisateur non trouvé',
        code: 'USER_NOT_FOUND'
      });
    }

    // Vérification des droits pour l'assignation de service
    if (emergencyServiceId !== undefined) {
      if (req.user.role !== 'SUPER_ADMIN') {
        return res.status(403).json({
          error: 'Permissions insuffisantes pour assigner un service d\'urgence',
          code: 'INSUFFICIENT_PERMISSIONS'
        });
      }

      if (emergencyServiceId) {
        const service = await prisma.emergencyService.findUnique({
          where: { id: emergencyServiceId }
        });
        if (!service) {
          return res.status(404).json({
            error: 'Service d\'urgence non trouvé',
            code: 'SERVICE_NOT_FOUND'
          });
        }
      }
    }

    // Vérification des permissions pour changer le rôle
    if (role && req.user.role !== 'SUPER_ADMIN' && role === 'SUPER_ADMIN') {
      return res.status(403).json({
        error: 'Permissions insuffisantes pour attribuer ce rôle',
        code: 'INSUFFICIENT_PERMISSIONS'
      });
    }

    // Vérification de l'unicité du téléphone si fourni
    if (phone) {
      const phoneExists = await prisma.user.findFirst({
        where: {
          phone,
          id: { not: id }
        }
      });

      if (phoneExists) {
        return res.status(409).json({
          error: 'Ce numéro de téléphone est déjà utilisé',
          code: 'PHONE_EXISTS'
        });
      }
    }

    // Mise à jour de l'utilisateur
    const updatedUser = await prisma.user.update({
      where: { id },
      data: {
        ...(firstName && { firstName }),
        ...(lastName && { lastName }),
        ...(phone && { phone }),
        ...(role && { role }),
        ...(isActive !== undefined && { isActive })
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true
      }
    });

    res.json({
      message: 'Utilisateur mis à jour avec succès',
      user: updatedUser
    });
  } catch (error) {
    console.error('Erreur lors de la mise à jour de l\'utilisateur:', error);
    res.status(500).json({
      error: 'Erreur interne du serveur',
      code: 'INTERNAL_ERROR'
    });
  }
});

/**
 * @route PUT /api/users/:id/password
 * @desc Changement de mot de passe
 * @access Private
 */
router.put('/:id/password', [
  body('currentPassword').notEmpty().withMessage('Le mot de passe actuel est requis'),
  body('newPassword').isLength({ min: 6 }).withMessage('Le nouveau mot de passe doit contenir au moins 6 caractères')
], requireOwnershipOrRole(['ADMIN', 'SUPER_ADMIN']), async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Données invalides',
        details: errors.array()
      });
    }

    const { id } = req.params;
    const { currentPassword, newPassword } = req.body;

    // Récupération de l'utilisateur avec le mot de passe
    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, password: true }
    });

    if (!user) {
      return res.status(404).json({
        error: 'Utilisateur non trouvé',
        code: 'USER_NOT_FOUND'
      });
    }

    // Vérification du mot de passe actuel
    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isCurrentPasswordValid) {
      return res.status(400).json({
        error: 'Mot de passe actuel incorrect',
        code: 'INVALID_CURRENT_PASSWORD'
      });
    }

    // Hachage du nouveau mot de passe
    const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
    const hashedNewPassword = await bcrypt.hash(newPassword, saltRounds);

    // Mise à jour du mot de passe
    await prisma.user.update({
      where: { id },
      data: { password: hashedNewPassword }
    });

    res.json({
      message: 'Mot de passe mis à jour avec succès'
    });
  } catch (error) {
    console.error('Erreur lors du changement de mot de passe:', error);
    res.status(500).json({
      error: 'Erreur interne du serveur',
      code: 'INTERNAL_ERROR'
    });
  }
});

/**
 * @route DELETE /api/users/:id
 * @desc Suppression d'un utilisateur
 * @access Private (Admin/Super Admin)
 */
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Vérification que l'utilisateur existe
    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true }
    });

    if (!user) {
      return res.status(404).json({
        error: 'Utilisateur non trouvé',
        code: 'USER_NOT_FOUND'
      });
    }

    // Empêcher la suppression d'un super admin par un admin
    if (user.role === 'SUPER_ADMIN' && req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({
        error: 'Permissions insuffisantes pour supprimer ce utilisateur',
        code: 'INSUFFICIENT_PERMISSIONS'
      });
    }

    // Suppression de l'utilisateur (cascade sur les alertes)
    await prisma.user.delete({
      where: { id }
    });

    res.json({
      message: 'Utilisateur supprimé avec succès'
    });
  } catch (error) {
    console.error('Erreur lors de la suppression de l\'utilisateur:', error);
    res.status(500).json({
      error: 'Erreur interne du serveur',
      code: 'INTERNAL_ERROR'
    });
  }
});

/**
 * @route GET /api/users/:id/alerts
 * @desc Récupération des alertes d'un utilisateur
 * @access Private
 */
router.get('/:id/alerts', requireOwnershipOrRole(['ADMIN', 'SUPER_ADMIN']), async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 10, status, type } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Vérification que l'utilisateur existe
    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true }
    });

    if (!user) {
      return res.status(404).json({
        error: 'Utilisateur non trouvé',
        code: 'USER_NOT_FOUND'
      });
    }

    // Construction des filtres
    const where = { userId: id };
    
    if (status) {
      where.status = status;
    }
    
    if (type) {
      where.type = type;
    }

    const [alerts, total] = await Promise.all([
      prisma.alert.findMany({
        where,
        include: {
          media: true,
          responses: true,
          assignments: true
        },
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' }
      }),
      prisma.alert.count({ where })
    ]);

    res.json({
      alerts,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Erreur lors de la récupération des alertes de l\'utilisateur:', error);
    res.status(500).json({
      error: 'Erreur interne du serveur',
      code: 'INTERNAL_ERROR'
    });
  }
});

module.exports = router;


