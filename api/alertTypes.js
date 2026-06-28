const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

/**
 * @route GET /api/alert-types
 * @desc Récupérer tous les types d'alerte
 * @access Private
 */
router.get('/', async (req, res) => {
  try {
    const types = await prisma.alertType.findMany({
      where: { isActive: true },
      include: { 
        services: {
            select: {
                id: true,
                name: true,
                type: true
            }
        }
      },
      orderBy: { name: 'asc' }
    });
    res.json(types);
  } catch (error) {
    console.error('Erreur récupération types alerte:', error);
    res.status(500).json({ error: 'Erreur serveur', details: error.message });
  }
});

/**
 * @route POST /api/alert-types
 * @desc Créer un nouveau type d'alerte
 * @access Private (SuperAdmin)
 */
router.post('/', requireSuperAdmin, [
  body('name').trim().notEmpty().withMessage('Le nom est requis'),
  body('severity').optional().isIn(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  body('serviceIds').optional().isArray()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { name, description, icon, severity, serviceIds, isActive = true } = req.body;
    
    // Check uniqueness
    const existing = await prisma.alertType.findUnique({ where: { name } });
    if (existing) {
      return res.status(409).json({ error: 'Ce type existe déjà' });
    }

    const data = {
      name, description, icon, severity, isActive
    };

    if (serviceIds && serviceIds.length > 0) {
      data.services = {
        connect: serviceIds.map(id => ({ id }))
      };
    }

    const type = await prisma.alertType.create({
      data,
      include: { services: true }
    });
    res.status(201).json(type);
  } catch (error) {
    console.error('Erreur création type alerte:', error);
    res.status(500).json({ error: 'Erreur serveur', details: error.message });
  }
});

/**
 * @route PUT /api/alert-types/:id
 * @desc Modifier un type d'alerte
 * @access Private (SuperAdmin)
 */
router.put('/:id', requireSuperAdmin, async (req, res) => {
  const { id } = req.params;
  const { name, description, icon, severity, serviceIds, isActive } = req.body;
  
  try {
    const data = {};
    if (name) data.name = name;
    if (description !== undefined) data.description = description;
    if (icon !== undefined) data.icon = icon;
    if (severity) data.severity = severity;
    if (isActive !== undefined) data.isActive = isActive;
    
    if (serviceIds && Array.isArray(serviceIds)) {
      data.services = {
        set: serviceIds.map(sid => ({ id: sid }))
      };
    }

    const type = await prisma.alertType.update({
      where: { id },
      data,
      include: { services: true }
    });
    res.json(type);
  } catch (error) {
    console.error('Erreur modification type alerte:', error);
    res.status(500).json({ error: 'Erreur serveur', details: error.message });
  }
});

/**
 * @route DELETE /api/alert-types/:id
 * @desc Supprimer un type d'alerte
 * @access Private (SuperAdmin)
 */
router.delete('/:id', requireSuperAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    // Check if used in alerts
    const usageCount = await prisma.alert.count({ where: { alertTypeId: id } });
    if (usageCount > 0) {
      return res.status(400).json({ error: 'Impossible de supprimer un type utilisé par des alertes existantes.' });
    }

    await prisma.alertType.delete({ where: { id } });
    res.json({ message: 'Type supprimé avec succès' });
  } catch (error) {
    console.error('Erreur suppression type alerte:', error);
    res.status(500).json({ error: 'Erreur serveur', details: error.message });
  }
});

module.exports = router;
