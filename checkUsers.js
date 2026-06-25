const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function checkAndCreateAdmin() {
  try {
    console.log('Checking for existing users...');
    
    const users = await prisma.user.findMany({
      select: {
        email: true,
        role: true,
        firstName: true,
        lastName: true
      }
    });
    
    console.log(`Found ${users.length} existing users:`);
    users.forEach(user => {
      console.log(`- ${user.email} (${user.role}) - ${user.firstName} ${user.lastName}`);
    });
    
    if (users.length === 0) {
      console.log('\nNo users found. Creating default admin user...');
      
      const hashedPassword = await bcrypt.hash('admin123', 10);
      
      const admin = await prisma.user.create({
        data: {
          email: 'admin@securite.com',
          password: hashedPassword,
          firstName: 'Admin',
          lastName: 'User',
          role: 'ADMIN'
        }
      });
      
      console.log('\n=== ADMIN USER CREATED ===');
      console.log('Email: admin@securite.com');
      console.log('Password: admin123');
      console.log('Role: ADMIN');
      console.log('========================');
    } else {
      console.log('\n=== EXISTING USERS ===');
      console.log('You can use any existing user to login.');
      console.log('If you need to reset a password, let me know.');
      console.log('====================');
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkAndCreateAdmin();
