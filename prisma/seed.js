require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('Début du seeding...');

  // 1. Création du Super Admin par défaut
  const superAdminEmail = process.env.SUPER_ADMIN_EMAIL || 'admin@admin.com';
  const superAdminPassword = process.env.SUPER_ADMIN_PASSWORD || 'admin123';
  const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;

  const existingSuperAdmin = await prisma.user.findUnique({
    where: { email: superAdminEmail }
  });

  if (!existingSuperAdmin) {
    console.log('Création du Super Admin...');
    const hashedPassword = await bcrypt.hash(superAdminPassword, saltRounds);
    
    await prisma.user.create({
      data: {
        email: superAdminEmail,
        password: hashedPassword,
        firstName: 'Super',
        lastName: 'Admin',
        role: 'SUPER_ADMIN',
        phone: '0000000000',
        isActive: true
      }
    });
    console.log(`Super Admin créé avec l'email: ${superAdminEmail}`);
  } else {
    console.log('Le Super Admin existe déjà.');
  }

  // 2. Création des types d'alertes par défaut si aucun n'existe
  const existingTypes = await prisma.alertType.count();
  if (existingTypes === 0) {
    console.log('Création des types d\'alertes par défaut...');
    const defaultTypes = [
      { name: 'ACCIDENT', description: 'Accident de la route ou autre', severity: 'HIGH', icon: 'car-crash' },
      { name: 'FIRE', description: 'Incendie', severity: 'CRITICAL', icon: 'fire' },
      { name: 'MEDICAL_EMERGENCY', description: 'Urgence médicale', severity: 'HIGH', icon: 'medical-bag' },
      { name: 'SECURITY_INCIDENT', description: 'Incident de sécurité / Agression', severity: 'HIGH', icon: 'shield-alert' },
      { name: 'NATURAL_DISASTER', description: 'Catastrophe naturelle', severity: 'CRITICAL', icon: 'weather-lightning' },
      { name: 'OTHER', description: 'Autre type d\'incident', severity: 'MEDIUM', icon: 'alert-circle' }
    ];

    for (const type of defaultTypes) {
      await prisma.alertType.create({ data: type });
    }
    console.log(`${defaultTypes.length} types d'alertes créés.`);
  }

  console.log('Seeding terminé.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
