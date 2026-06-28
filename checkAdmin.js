const prisma = require("./lib/prisma");

async function checkAdminUser() {
  try {
    console.log("Checking admin user...");

    const user = await prisma.user.findUnique({
      where: { email: "admin@securite.com" },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });

    if (user) {
      console.log("Admin user found:");
      console.log("ID:", user.id);
      console.log("Email:", user.email);
      console.log("Name:", user.firstName, user.lastName);
      console.log("Role:", user.role);
      console.log("Active:", user.isActive);
      console.log("Created:", user.createdAt);
    } else {
      console.log("Admin user NOT found in database");
      console.log("Creating new admin user...");

      const bcrypt = require("bcryptjs");
      const hashedPassword = await bcrypt.hash("admin123", 10);

      const admin = await prisma.user.create({
        data: {
          email: "admin@securite.com",
          password: hashedPassword,
          firstName: "Admin",
          lastName: "User",
          role: "ADMIN",
          isActive: true,
        },
      });

      console.log("New admin user created:");
      console.log("Email: admin@securite.com");
      console.log("Password: admin123");
      console.log("Role: ADMIN");
    }
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await prisma.$disconnect();
  }
}

checkAdminUser();
